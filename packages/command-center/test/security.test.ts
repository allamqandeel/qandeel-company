/**
 * The request boundary of the loopback Founder surface (pure policy): DNS-rebinding Hosts, cross-site
 * origins, missing CSRF, wrong content types are refused; loopback same-origin requests pass.
 * C5-PROOF: founder-listener
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { CSRF_COOKIE, allowedHosts, allowedOrigins, gateRequest, parseCookies, securityHeaders, statusForCode, type RequestFacts } from '../src/index.js';

const facts = (over: Partial<RequestFacts> = {}): RequestFacts => ({ method: 'GET', host: '127.0.0.1:4173', origin: undefined, secFetchSite: 'same-origin', contentType: undefined, cookies: {}, csrfHeader: undefined, ...over });
const post = (over: Partial<RequestFacts> = {}): RequestFacts => facts({ method: 'POST', origin: 'http://127.0.0.1:4173', contentType: 'application/json', cookies: { [CSRF_COOKIE]: 'c'.repeat(43) }, csrfHeader: 'c'.repeat(43), ...over });

describe('Founder surface request gate', () => {
  test('C5-PROOF: only the exact loopback Host passes (DNS rebinding sends another Host)', () => {
    assert.deepEqual(gateRequest(facts(), 4173), { ok: true });
    assert.deepEqual(gateRequest(facts({ host: 'localhost:4173' }), 4173), { ok: true });
    for (const host of [undefined, 'evil.example:4173', '127.0.0.1:4174', '192.168.1.10:4173', '127.0.0.1.nip.io:4173', '0.0.0.0:4173']) {
      const g = gateRequest(facts({ host }), 4173);
      assert.equal(g.ok, false, String(host));
      if (!g.ok) assert.equal(g.code, 'HOST_NOT_LOOPBACK');
    }
    assert.deepEqual(allowedHosts(4173), ['127.0.0.1:4173', 'localhost:4173']);
    assert.deepEqual(allowedOrigins(4173), ['http://127.0.0.1:4173', 'http://localhost:4173']);
  });

  test('C5-PROOF: a state change needs the exact Origin, same-origin fetch metadata, JSON and the CSRF double submit', () => {
    assert.deepEqual(gateRequest(post(), 4173), { ok: true });
    const refused = (over: Partial<RequestFacts>, code: string): void => {
      const g = gateRequest(post(over), 4173);
      assert.equal(g.ok, false, code);
      if (!g.ok) assert.equal(g.code, code);
    };
    refused({ origin: undefined }, 'ORIGIN_NOT_LOOPBACK');
    refused({ origin: 'http://evil.example' }, 'ORIGIN_NOT_LOOPBACK');
    refused({ origin: 'null' }, 'ORIGIN_NOT_LOOPBACK');
    refused({ secFetchSite: 'cross-site' }, 'CROSS_SITE_REQUEST');
    refused({ secFetchSite: 'same-site' }, 'CROSS_SITE_REQUEST');
    refused({ contentType: 'text/plain' }, 'CONTENT_TYPE');
    refused({ contentType: 'application/x-www-form-urlencoded' }, 'CONTENT_TYPE');
    refused({ csrfHeader: undefined }, 'CSRF_MISMATCH');
    refused({ csrfHeader: 'x'.repeat(43) }, 'CSRF_MISMATCH');
    refused({ cookies: {} }, 'CSRF_MISMATCH');
    // The launch exchange is CSRF-exempt (no session yet) but still origin-bound.
    assert.deepEqual(gateRequest(post({ csrfHeader: undefined, cookies: {} }), 4173, { csrfExempt: true }), { ok: true });
    assert.equal(gateRequest(post({ origin: 'http://evil.example', csrfHeader: undefined, cookies: {} }), 4173, { csrfExempt: true }).ok, false);
  });

  test('C5-PROOF: cookies parse defensively; security headers keep the page self-contained', () => {
    assert.deepEqual(parseCookies('qandeel_founder=abc; qandeel_csrf=def; weird=<script>; =x'), { qandeel_founder: 'abc', qandeel_csrf: 'def' });
    assert.deepEqual(parseCookies(undefined), {});
    const h = securityHeaders('n0nce');
    assert.match(h['Content-Security-Policy'] ?? '', /default-src 'self'/);
    assert.match(h['Content-Security-Policy'] ?? '', /script-src 'self' 'nonce-n0nce'/);
    assert.match(h['Content-Security-Policy'] ?? '', /frame-ancestors 'none'/);
    assert.equal(h['X-Content-Type-Options'], 'nosniff');
    assert.equal(h['Referrer-Policy'], 'no-referrer');
  });

  test('C5-PROOF: refusals map to fail-closed statuses; unknown errors are 500 without content', () => {
    assert.equal(statusForCode('FOUNDER_SESSION_INVALID'), 401);
    assert.equal(statusForCode('FOUNDER_SURFACE_UNAVAILABLE'), 403);
    assert.equal(statusForCode('FOUNDER_ONLY'), 403);
    assert.equal(statusForCode('FOUNDER_CONFIRMATION_REQUIRED'), 409);
    assert.equal(statusForCode('NOT_FOUND'), 404);
    assert.equal(statusForCode('VALIDATION_FAILED'), 400);
    assert.equal(statusForCode('SOMETHING_ELSE'), 500);
  });
});
