/**
 * D2-CTRL-01 — the Company's lifecycle controls inside the Command Center (D-D2-01): Status, Stop Company and Restart
 * Company. Status is a content-free read of the running host. Stop and Restart are confirmed first, then asked of the host
 * with the Founder session and CSRF secret; the host answers with the stopped-state controller's loopback address and a
 * single-use ticket, and this window moves there (the ticket in the fragment, never sent to a server, never kept in
 * history), so the same window stays open while the Company is stopped and offers Start Company.
 *
 * P1-UX-BUDGET-DARK-01 — the Company budget, in its own section beneath the lifecycle controls and never mixed with them:
 * the COMPANY envelope as recorded (ceiling, actually spent, currently reserved, available headroom, currency) and Change
 * Budget, which opens the same budget editor a person's sheet uses. A valid entry becomes the existing BUDGET_CEILING
 * governed preview (fingerprinted, confirmed by the Founder in the confirmation dialog); the panel then reads the
 * envelope again, so the new ceiling shows without a restart.
 */
import { fmtMoneyMicros } from '../model/format.js';
import { api, ApiError } from './api.js';
import { keepFocus, restoreFocus } from './keep-focus.js';
import { budgetEditor, budgetHeadroomMicros } from './panels.js';

type Json = Record<string, unknown>;

interface DesktopStatus {
  readonly available: boolean;
  readonly state: string;
  readonly runtimeState: string | null;
  readonly instanceId: string | null;
  readonly release: { readonly pinned: boolean; readonly releaseId: string | null; readonly intact: boolean | null };
  readonly admitted: string;
}

/** What the Company panel needs from the application: the governed preview, and the lock when the session is gone. */
export interface CompanyHost {
  previewAction(intent: string, payload: Json): Promise<string | null>;
  lock(code: string): void;
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
  readonly #host: CompanyHost;
  #status: DesktopStatus | null = null;
  #loading = false;
  #confirm: Intent | null = null;
  #busy = false;
  #message: string | null = null;
  /** The COMPANY envelope as last read: undefined before the first read, null when none is on record. */
  #budget: Json | null | undefined = undefined;
  #budgetMessage: string | null = null;
  #budgetRefused = false;
  #editing = false;

  constructor(toggle: HTMLElement, panel: HTMLElement, host: CompanyHost) {
    this.#toggle = toggle;
    this.#panel = panel;
    this.#host = host;
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
    this.#editing = false;
    this.#budgetMessage = null;
    await Promise.all([this.refresh(), this.refreshBudget()]);
  }

  close(): void {
    if (this.#busy) return;
    this.#panel.hidden = true;
    this.#toggle.setAttribute('aria-expanded', 'false');
    this.#editing = false;
    this.#toggle.focus();
  }

  async refresh(): Promise<void> {
    this.#loading = true;
    this.#render();
    try {
      this.#status = await api.get<DesktopStatus>('/api/desktop/status');
      this.#message = null;
    } catch (e) {
      this.#status = null;
      this.#message = e instanceof ApiError && e.status === 404 ? UNAVAILABLE : `The status could not be read (${e instanceof ApiError ? e.code : 'error'}).`;
    }
    this.#loading = false;
    this.#render();
  }

  /**
   * Reads the COMPANY envelope again (on open, and on every live refresh while the panel is open). A confirmed new
   * ceiling closes the editor and is named; the Founder's draft survives any other refresh.
   */
  async refreshBudget(): Promise<void> {
    const before = this.#budget;
    try {
      const r = await api.get<{ budget: Json | null }>('/api/company/budget');
      this.#budget = r.budget;
      if (before && r.budget && Number(before.capMoney) !== Number(r.budget.capMoney)) {
        this.#editing = false;
        this.#budgetRefused = false;
        this.#budgetMessage = `The Company ceiling is now ${fmtMoneyMicros(Number(r.budget.capMoney), String(r.budget.currency))}.`;
      } else if (this.#budgetMessage?.startsWith('The Company budget could not be read')) this.#budgetMessage = null;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        this.#host.lock(e.code);
        return;
      }
      this.#budgetMessage = `The Company budget could not be read (${e instanceof ApiError ? e.code : 'error'}).`;
    }
    if (this.isOpen) this.#render();
  }

  async #control(intent: Intent): Promise<void> {
    this.#busy = true;
    this.#message = null;
    this.#loading = true;
    this.#render();
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
      this.#loading = false;
      this.#render();
    }
  }

  #render(): void {
    const p = this.#panel;
    // A rebuild keeps the Founder's place: the amount being typed (with its caret) and the focused control.
    const draft = p.querySelector<HTMLInputElement>('#company-budget-amount')?.value ?? '';
    const kept = keepFocus(p);
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
        this.#render();
      });
      const actions = el('div', { class: 'company-actions' });
      actions.append(go, cancel);
      box.append(actions);
      p.append(box);
      go.focus();
    } else {
      const actions = el('div', { class: 'company-actions' });
      const status = el('button', { type: 'button', class: 'btn btn-quiet', id: 'company-status' }, this.#loading ? 'Checking…' : 'Check status');
      status.addEventListener('click', () => void this.refresh());
      actions.append(status);
      if (s?.available) {
        const restart = el('button', { type: 'button', class: 'btn btn-quiet', id: 'company-restart' }, 'Restart Company');
        const stop = el('button', { type: 'button', class: 'btn btn-quiet btn-stop', id: 'company-stop' }, 'Stop Company');
        restart.addEventListener('click', () => this.#ask('RESTART'));
        stop.addEventListener('click', () => this.#ask('STOP'));
        actions.append(restart, stop);
      }
      if (this.#loading) for (const b of actions.querySelectorAll('button')) b.setAttribute('disabled', '');
      p.append(actions);
      if (s !== null && !s.available && this.#message === null) p.append(el('p', { class: 'company-note' }, UNAVAILABLE));
    }
    if (this.#message !== null) p.append(el('p', { class: 'company-note', role: 'status' }, this.#message));
    p.append(this.#budgetSection(draft));
    if (this.#confirm === null) restoreFocus(p, kept);
  }

  /** The Company budget: the recorded envelope and Change Budget (the shared, governed budget editor). */
  #budgetSection(draft: string): HTMLElement {
    const section = el('section', { class: 'company-section company-budget', 'aria-labelledby': 'company-budget-title' });
    section.append(el('h4', { class: 'company-section-title', id: 'company-budget-title' }, 'Company Budget'));
    const b = this.#budget;
    if (b === undefined) {
      section.append(el('p', { class: 'company-note' }, this.#budgetMessage ?? 'Reading the Company budget…'));
      return section;
    }
    if (b === null) {
      section.append(el('p', { class: 'company-note' }, 'The Company has no budget envelope on record, so there is no ceiling to change here.'));
      if (this.#budgetMessage !== null) section.append(el('p', { class: 'company-note', role: 'status' }, this.#budgetMessage));
      return section;
    }
    const currency = String(b.currency);
    const money = (m: number): string => fmtMoneyMicros(m, currency);
    const headroom = budgetHeadroomMicros(b);
    const facts = el('dl', { class: 'company-facts company-budget-facts', id: 'company-budget-facts' });
    const row = (k: string, v: string, cls?: string): void => {
      facts.append(el('dt', {}, k), el('dd', cls ? { class: cls } : {}, v));
    };
    row('Current ceiling', money(Number(b.capMoney)));
    row('Actually spent', money(Number(b.spentMoney)));
    row('Currently reserved', money(Number(b.reservedMoney ?? 0)));
    row('Available headroom', money(headroom), headroom > 0 ? 'is-headroom' : 'is-exhausted');
    row('Currency', currency);
    section.append(facts);
    const change = el('button', { type: 'button', class: 'btn btn-quiet', id: 'company-budget-change', 'aria-expanded': this.#editing ? 'true' : 'false', 'aria-controls': 'company-budget-editor' }, 'Change Budget');
    if (this.#busy) change.setAttribute('disabled', '');
    change.addEventListener('click', () => {
      this.#editing = !this.#editing;
      this.#budgetMessage = null;
      this.#budgetRefused = false;
      this.#render();
      if (this.#editing) this.#panel.querySelector<HTMLElement>('#company-budget-amount')?.focus();
    });
    section.append(change);
    if (this.#editing) {
      // A refused preview is kept by the panel (a live refresh rebuilds the editor before the refusal arrives).
      const host = {
        previewAction: async (intent: string, payload: Json): Promise<string | null> => {
          this.#budgetMessage = null;
          this.#budgetRefused = false;
          const refused = await this.#host.previewAction(intent, payload);
          if (refused !== null && this.isOpen) {
            this.#budgetMessage = refused;
            this.#budgetRefused = true;
            this.#render();
          }
          return refused;
        },
      };
      section.append(budgetEditor('the Company', b, host, draft, () => {
        this.#editing = false;
        this.#render();
        this.#panel.querySelector<HTMLElement>('#company-budget-change')?.focus();
      }, 'company-budget'));
    }
    if (this.#budgetMessage !== null) section.append(el('p', this.#budgetRefused ? { class: 'company-note budget-error', role: 'alert', id: 'company-budget-refusal' } : { class: 'company-note', role: 'status' }, this.#budgetMessage));
    return section;
  }

  #ask(intent: Intent): void {
    this.#confirm = intent;
    this.#message = null;
    this.#render();
  }
}
