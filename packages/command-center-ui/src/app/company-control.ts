/**
 * D2-CTRL-01 — the Company's lifecycle controls inside the Command Center (D-D2-01): Status, Stop Company and Restart
 * Company. Status is a content-free read of the running host. Stop and Restart are confirmed first, then asked of the host
 * with the Founder session and CSRF secret; the host answers with the stopped-state controller's loopback address and a
 * single-use ticket, and this window moves there (the ticket in the fragment, never sent to a server, never kept in
 * history), so the same window stays open while the Company is stopped and offers Start Company.
 */
import { api, ApiError } from './api.js';

interface DesktopStatus {
  readonly available: boolean;
  readonly state: string;
  readonly runtimeState: string | null;
  readonly instanceId: string | null;
  readonly release: { readonly pinned: boolean; readonly releaseId: string | null; readonly intact: boolean | null };
  readonly admitted: string;
}

type Intent = 'STOP' | 'RESTART';

const CONTROLLER = /^http:\/\/127\.0\.0\.1:\d{1,5}\/desktop$/;
const TICKET = /^[A-Za-z0-9_-]{43}$/;

const UNAVAILABLE = 'Lifecycle control works in the installed QANDEEL COMPANY app for its configured Company. Use the Start menu shortcuts here.';

const REFUSED: Readonly<Record<string, string>> = {
  DESKTOP_CONTROL_UNAVAILABLE: UNAVAILABLE,
  DESKTOP_CONTROL_BUSY: 'Another window is already controlling the Company.',
  DESKTOP_CONTROL_TIMEOUT: 'The control window could not be prepared in time. Nothing was stopped. Try again.',
};

const el = (tag: string, attrs: Record<string, string> = {}, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
};

export class CompanyControl {
  readonly #toggle: HTMLElement;
  readonly #panel: HTMLElement;
  #status: DesktopStatus | null = null;
  #confirm: Intent | null = null;
  #busy = false;
  #message: string | null = null;

  constructor(toggle: HTMLElement, panel: HTMLElement) {
    this.#toggle = toggle;
    this.#panel = panel;
    toggle.addEventListener('click', () => (panel.hidden ? void this.open() : this.close()));
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  get isOpen(): boolean {
    return !this.#panel.hidden;
  }

  async open(): Promise<void> {
    this.#panel.hidden = false;
    this.#toggle.setAttribute('aria-expanded', 'true');
    this.#confirm = null;
    this.#message = null;
    await this.refresh();
  }

  close(): void {
    if (this.#busy) return;
    this.#panel.hidden = true;
    this.#toggle.setAttribute('aria-expanded', 'false');
    this.#toggle.focus();
  }

  async refresh(): Promise<void> {
    this.#render(true);
    try {
      this.#status = await api.get<DesktopStatus>('/api/desktop/status');
      this.#message = null;
    } catch (e) {
      this.#status = null;
      this.#message = e instanceof ApiError && e.status === 404 ? UNAVAILABLE : `The status could not be read (${e instanceof ApiError ? e.code : 'error'}).`;
    }
    this.#render(false);
  }

  async #control(intent: Intent): Promise<void> {
    this.#busy = true;
    this.#message = null;
    this.#render(true);
    try {
      const out = await api.post<{ controller: string; ticket: string }>('/api/desktop/control', { intent });
      if (!CONTROLLER.test(out.controller) || !TICKET.test(out.ticket)) throw new ApiError(502, 'DESKTOP_CONTROL_INVALID');
      // The same window becomes the stopped-state controller (no new history entry; the ticket is redeemed once there).
      location.replace(`${out.controller}#${out.ticket}`);
      return;
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'DESKTOP_CONTROL_FAILED';
      this.#message = `${REFUSED[code] ?? 'The Company was not stopped.'} (${code})`;
      this.#busy = false;
      this.#confirm = null;
      this.#render(false);
    }
  }

  #render(loading: boolean): void {
    const p = this.#panel;
    p.replaceChildren();
    const head = el('div', { class: 'company-head' });
    head.append(el('h3', { class: 'section-title' }, 'Company'));
    const close = el('button', { type: 'button', class: 'btn btn-ghost', 'aria-label': 'Close' }, 'Close');
    close.addEventListener('click', () => this.close());
    head.append(close);
    p.append(head);
    const s = this.#status;
    if (s !== null) {
      const running = s.runtimeState === 'READY';
      const list = el('dl', { class: 'company-facts' });
      const row = (k: string, v: string): void => {
        list.append(el('dt', {}, k), el('dd', {}, v));
      };
      row('State', running ? 'Running — healthy' : `Running — ${s.runtimeState ?? 'unknown'}`);
      if (s.instanceId) row('Instance', s.instanceId.slice(0, 8));
      row('Release', s.release.releaseId ? `${s.release.releaseId.slice(0, 12)} · ${s.release.intact === true ? 'intact' : s.release.intact === false ? 'NOT intact' : 'unpinned'}` : 'development build (unpinned)');
      p.append(list);
    }
    if (this.#confirm !== null) {
      const stop = this.#confirm === 'STOP';
      const box = el('div', { class: 'company-confirm', role: 'alertdialog', 'aria-label': stop ? 'Stop the Company?' : 'Restart the Company?' });
      box.append(el('p', { class: 'company-confirm-title' }, stop ? 'Stop the Company?' : 'Restart the Company?'));
      box.append(el('p', {}, stop ? 'Work pauses safely and every state is kept. This window stays open and offers Start Company.' : 'The Company stops safely and starts again. The Command Center returns once it is healthy.'));
      const go = el('button', { type: 'button', class: 'btn btn-primary', id: stop ? 'company-stop-confirm' : 'company-restart-confirm' }, stop ? 'Stop Company' : 'Restart Company');
      const cancel = el('button', { type: 'button', class: 'btn btn-quiet' }, 'Cancel');
      if (this.#busy) {
        go.setAttribute('disabled', '');
        cancel.setAttribute('disabled', '');
        go.textContent = stop ? 'Stopping…' : 'Restarting…';
      }
      go.addEventListener('click', () => void this.#control(stop ? 'STOP' : 'RESTART'));
      cancel.addEventListener('click', () => {
        this.#confirm = null;
        this.#render(false);
      });
      const actions = el('div', { class: 'company-actions' });
      actions.append(go, cancel);
      box.append(actions);
      p.append(box);
      go.focus();
    } else {
      const actions = el('div', { class: 'company-actions' });
      const status = el('button', { type: 'button', class: 'btn btn-quiet', id: 'company-status' }, loading ? 'Checking…' : 'Check status');
      status.addEventListener('click', () => void this.refresh());
      actions.append(status);
      if (s?.available) {
        const restart = el('button', { type: 'button', class: 'btn btn-quiet', id: 'company-restart' }, 'Restart Company');
        const stop = el('button', { type: 'button', class: 'btn btn-quiet btn-stop', id: 'company-stop' }, 'Stop Company');
        restart.addEventListener('click', () => this.#ask('RESTART'));
        stop.addEventListener('click', () => this.#ask('STOP'));
        actions.append(restart, stop);
      }
      if (loading) for (const b of actions.querySelectorAll('button')) b.setAttribute('disabled', '');
      p.append(actions);
      if (s !== null && !s.available && this.#message === null) p.append(el('p', { class: 'company-note' }, UNAVAILABLE));
    }
    if (this.#message !== null) p.append(el('p', { class: 'company-note', role: 'status' }, this.#message));
  }

  #ask(intent: Intent): void {
    this.#confirm = intent;
    this.#message = null;
    this.#render(false);
  }
}
