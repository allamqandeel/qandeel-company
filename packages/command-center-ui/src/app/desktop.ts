/**
 * D2-CTRL-01 — the Command Center window while the Company is stopped (served by the stopped-state desktop controller on
 * its own loopback port, D-D2-01). It keeps the window usable: it shows the real lifecycle state (STOPPING, STOPPED,
 * STARTING, RESTARTING, ERROR, HELD — with the canonical STALE / UNHEALTHY / FOREIGN_RUNTIME / UPDATE_REQUIRED kept
 * distinct), offers Start Company, and returns the window to the Command Center only after the canonical READY.
 *
 * The single-use ticket arrives in the URL fragment (never sent to a server) and is removed from history before anything
 * else, exactly like the launch token on /launch. The control key it is exchanged for lives in this page's memory only.
 * This page reads no Company data and calls no Founder API.
 */
const KEY_HEADER = 'x-qandeel-desktop-key';

interface Snapshot {
  readonly phase: string;
  readonly state: string | null;
  readonly reason: string | null;
  readonly hold: string | null;
  readonly code: string | null;
  readonly busy: boolean;
}

const ticket = location.hash.slice(1);
history.replaceState(null, '', '/desktop');

const $ = (id: string): HTMLElement => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e;
};

let key: string | null = null;
let entering = false;
let lastAction: 'STOP' | 'START' | 'RESTART' = 'STOP';

const STARTABLE = new Set(['STOPPED', 'STALE', 'UPDATE_REQUIRED']);

/** Fixed, content-free explanations of a code (the code itself is shown for support). */
const EXPLAIN: Readonly<Record<string, string>> = {
  HOST_UNRESPONSIVE: 'The Company is running but did not answer the controlled stop. Use “QANDEEL COMPANY — Restart” from the Start menu.',
  HOST_UNHEALTHY: 'The Company is running but not responding. Use “QANDEEL COMPANY — Restart” from the Start menu.',
  HOST_STOP_TIMEOUT: 'The controlled stop did not finish in time. Check the status again in a minute.',
  HOST_START_TIMEOUT: 'The Company took longer than expected to start. Try again in a minute.',
  HOST_START_FAILED: 'The Company could not be started. Try again; if it repeats, use the Start menu shortcuts.',
  FOREIGN_RUNTIME: 'An engineering Company runtime is running without the Command Center. Stop it first.',
  RUNTIME_RELEASE_REFUSED: 'This build of the Company is not the activated production release, so nothing was started.',
  UPDATE_HOLD: 'The Company is held after a failed, rolled-back update. It needs operator review before it starts.',
  RESTORE_IN_PROGRESS: 'A backup restore is in progress or incomplete in this workspace. The Company stays held.',
  RESTORE_CHECK_COPY: 'This is an isolated backup verification copy; it never runs.',
  WORKSPACE_MISSING: 'The Company workspace was not found. Check that its drive is connected.',
  WORKSPACE_INVALID: 'The configured folder is not a valid Company workspace. Nothing new is created.',
  LAUNCH_MINT_FAILED: 'The Company is running, but the Command Center could not be reopened here. Open it from the Desktop shortcut.',
};

/** What the canonical host state adds while the Company is stopped. */
const STATE_NOTE: Readonly<Record<string, string>> = {
  STALE: 'The last stop was not clean; starting recovers automatically.',
  UPDATE_REQUIRED: 'A safe schema update runs when it starts.',
};

function render(s: Snapshot): void {
  const root = $('lifecycle');
  root.dataset.phase = s.phase;
  const title = $('lc-title');
  const text = $('lc-text');
  const start = $('lc-start') as HTMLButtonElement;
  const status = $('lc-status') as HTMLButtonElement;
  $('lc-progress').hidden = !(s.busy || s.phase === 'READY' || s.phase === 'ENTERED' || s.phase === 'ARMED');
  start.hidden = true;
  status.hidden = s.busy || s.phase === 'READY' || s.phase === 'ENTERED';
  start.textContent = 'Start Company';
  const note = s.state && STATE_NOTE[s.state] ? ` ${STATE_NOTE[s.state]}` : '';
  switch (s.phase) {
    case 'ARMED':
      title.textContent = 'Connecting…';
      text.textContent = 'Taking over the controls of this window.';
      break;
    case 'STOPPING':
      title.textContent = 'Stopping the Company';
      text.textContent = 'Work is pausing safely and every state is being kept. This window stays open.';
      break;
    case 'STOPPED':
      title.textContent = 'The Company is stopped';
      text.textContent = `All state is preserved. Nothing runs until you start it again.${note}`;
      start.hidden = false;
      break;
    case 'STARTING':
      title.textContent = 'Starting the Company';
      text.textContent = 'Waiting for the Company to confirm it is healthy.';
      break;
    case 'RESTARTING':
      title.textContent = 'Restarting the Company';
      text.textContent = 'Stopping safely, then starting again. The Command Center returns once the Company is healthy.';
      break;
    case 'READY':
    case 'ENTERED':
      title.textContent = 'The Company is running';
      text.textContent = 'Opening the Command Center…';
      break;
    case 'HELD':
      title.textContent = 'The Company is held';
      text.textContent = EXPLAIN[s.code ?? ''] ?? 'The Company is held and does not start until the hold is resolved.';
      break;
    default: {
      const verb = lastAction === 'STOP' ? 'stopped' : lastAction === 'RESTART' ? 'restarted' : 'started';
      title.textContent = `The Company could not be ${verb}`;
      text.textContent = `${EXPLAIN[s.code ?? ''] ?? EXPLAIN[s.state ?? ''] ?? 'The operation did not complete.'}${note}`;
      if (s.state !== null && STARTABLE.has(s.state)) start.hidden = false;
      if (s.state === 'RUNNING') {
        start.hidden = false;
        start.textContent = 'Back to the Command Center';
      }
    }
  }
  const detail = [s.code, s.state, s.state === 'HELD' ? s.hold : null].filter((x): x is string => typeof x === 'string' && x.length > 0);
  $('lc-code').textContent = detail.length > 0 ? `(${[...new Set(detail)].join(' · ')})` : '';
  if (s.phase === 'READY' && !entering) void enter();
}

function lost(message: string): void {
  key = null;
  $('lifecycle').dataset.phase = 'DISCONNECTED';
  $('lc-title').textContent = 'This window is no longer connected';
  $('lc-text').textContent = message;
  $('lc-progress').hidden = true;
  $('lc-start').hidden = true;
  $('lc-status').hidden = true;
}

const REOPEN = 'Reopen QANDEEL COMPANY from its Desktop shortcut. The Company itself is not changed by closing this window.';

async function post(path: string, body: Record<string, unknown> = {}): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (key !== null) headers[KEY_HEADER] = key;
  return fetch(path, { method: 'POST', headers, body: JSON.stringify(body), credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
}

async function watch(): Promise<void> {
  let res: Response;
  try {
    res = await post('/desktop/watch');
  } catch {
    return lost(REOPEN);
  }
  if (!res.ok || res.body === null) return lost(REOPEN);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    let chunk: ReadableStreamReadResult<string>;
    try {
      chunk = await reader.read();
    } catch {
      break;
    }
    if (chunk.done) break;
    buffer += chunk.value;
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      try {
        render(JSON.parse(line) as Snapshot);
      } catch {
        // a torn line is skipped; the next snapshot is complete
      }
      nl = buffer.indexOf('\n');
    }
  }
  if (!entering) lost(REOPEN);
}

async function act(action: 'START' | 'STOP' | 'RESTART'): Promise<void> {
  lastAction = action;
  const res = await post('/desktop/act', { action }).catch(() => null);
  if (res === null || (!res.ok && res.status !== 409)) lost(REOPEN);
}

async function refreshStatus(): Promise<void> {
  const res = await post('/desktop/status').catch(() => null);
  if (res === null || !res.ok) return lost(REOPEN);
  render((await res.json()) as Snapshot);
}

async function enter(): Promise<void> {
  entering = true;
  const res = await post('/desktop/enter').catch(() => null);
  const json = res === null ? null : ((await res.json().catch(() => null)) as { ok?: boolean; launchUrl?: unknown; code?: string } | null);
  const url = typeof json?.launchUrl === 'string' ? json.launchUrl : '';
  // Only ever the canonical loopback /launch page of the Company host.
  if (res !== null && res.ok && /^http:\/\/127\.0\.0\.1:\d{1,5}\/launch#[A-Za-z0-9_-]+$/.test(url)) {
    location.replace(url);
    return;
  }
  entering = false;
  render({ phase: 'ERROR', state: 'RUNNING', reason: null, hold: null, code: json?.code ?? 'LAUNCH_MINT_FAILED', busy: false });
}

async function boot(): Promise<void> {
  $('lc-start').addEventListener('click', () => void act('START'));
  $('lc-status').addEventListener('click', () => void refreshStatus());
  if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) return lost(`This control link is no longer valid. ${REOPEN}`);
  const res = await post('/desktop/redeem', { ticket }).catch(() => null);
  const json = res === null ? null : ((await res.json().catch(() => null)) as { ok?: boolean; key?: unknown; intent?: unknown } | null);
  if (res === null || !res.ok || typeof json?.key !== 'string') return lost(`This control link is no longer valid. ${REOPEN}`);
  key = json.key;
  lastAction = json.intent === 'RESTART' ? 'RESTART' : 'STOP';
  await watch();
}

void boot();
