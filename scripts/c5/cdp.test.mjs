// Harness proof: the CDP client can never wait forever. A WebSocket peer that accepts the connection and never
// answers stands in for a browser whose renderer stopped responding; every command must fail within its bound,
// name its method and context, leave nothing pending, and closing must reject whatever is still in flight.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { describe, test, after, before } from 'node:test';

import { CdpConnection, CdpTimeoutError, DEFAULT_TIMEOUT_MS } from './cdp.mjs';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
let server;
let url;
const sockets = new Set();

before(async () => {
  server = createServer((_req, res) => res.end());
  // The handshake only: frames the client sends are read and dropped, nothing is ever sent back.
  server.on('upgrade', (req, socket) => {
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}${GUID}`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on('data', () => undefined);
    socket.on('error', () => undefined);
    sockets.add(socket);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `ws://127.0.0.1:${server.address().port}/devtools/browser/test`;
});

after(async () => {
  for (const s of sockets) s.destroy();
  await new Promise((resolve) => server.close(resolve));
});

describe('CDP harness client', () => {
  test('HARNESS-PROOF: an unanswered command fails within its bound, names the method and the context, and leaves nothing pending', async () => {
    const c = new CdpConnection(url);
    await c.ready;
    const started = Date.now();
    await assert.rejects(
      c.send('Runtime.evaluate', { expression: '1' }, 'session-1', { timeoutMs: 120, context: 'helper click(".card") in step spike-selection-focus-return' }),
      (e) => e instanceof CdpTimeoutError && e.code === 'CDP_TIMEOUT' && e.method === 'Runtime.evaluate' && e.timeoutMs === 120 && /Runtime\.evaluate did not answer within 120 ms — helper click\(".card"\) in step spike-selection-focus-return/.test(e.message),
    );
    assert.ok(Date.now() - started < 2_000, 'the rejection arrives at the bound, not at some outer ceiling');
    assert.equal(c.pendingCount, 0, 'the request left the pending map');
    c.close();
  });

  test('HARNESS-PROOF: the default bound is finite and in the tens of seconds; a later command reports how many others were still pending', async () => {
    assert.ok(DEFAULT_TIMEOUT_MS >= 5_000 && DEFAULT_TIMEOUT_MS <= 60_000, `default bound ${DEFAULT_TIMEOUT_MS} ms`);
    const c = new CdpConnection(url);
    await c.ready;
    const slow = c.send('Page.captureScreenshot', {}, 's', { timeoutMs: 1_000 });
    slow.catch(() => undefined);
    await assert.rejects(c.send('Input.dispatchMouseEvent', {}, 's', { timeoutMs: 60 }), (e) => e.pending === 1 && /1 other request\(s\) still pending/.test(e.message));
    c.close();
    await assert.rejects(slow, /Page\.captureScreenshot unanswered: the CDP connection was closed by the harness/);
    assert.equal(c.pendingCount, 0);
  });

  test('HARNESS-PROOF: closing the connection rejects everything in flight instead of leaving promises hanging', async () => {
    const c = new CdpConnection(url);
    await c.ready;
    const a = c.send('Target.createTarget', { url: 'about:blank' }, undefined, { timeoutMs: 10_000 });
    const b = c.send('Runtime.enable', {}, 's', { timeoutMs: 10_000 });
    c.close();
    await assert.rejects(a, /Target\.createTarget unanswered/);
    await assert.rejects(b, /Runtime\.enable unanswered/);
    assert.equal(c.pendingCount, 0);
    await assert.rejects(c.send('Runtime.evaluate', {}, 's'), /not sent: the CDP connection is (closing|closed)/);
  });
});
