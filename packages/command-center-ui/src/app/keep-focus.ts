/**
 * D2-UX-01 (review): a live Company refresh rebuilds a region (the Academy overview, a person sheet). The control the
 * Founder was on is found again in the rebuilt region by its stable key (`data-keep`, else its id) and given focus back
 * without scrolling; in a text field the caret and selection come back too. Presentation only: nothing is read from or
 * written to the Company.
 */
export interface KeptFocus {
  readonly key: string | null;
  readonly start: number | null;
  readonly end: number | null;
  readonly direction: 'forward' | 'backward' | 'none' | null;
}

const keyOf = (el: Element): string | null => el.getAttribute('data-keep') ?? (el.id || null);

/** Where focus is inside `root` before it is rebuilt, or null when focus is elsewhere. */
export function keepFocus(root: Element): KeptFocus | null {
  const el = document.activeElement;
  if (!el || !root.contains(el)) return null;
  const text = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
  return { key: keyOf(el), start: text ? el.selectionStart : null, end: text ? el.selectionEnd : null, direction: text ? el.selectionDirection : null };
}

/**
 * Gives focus back to the same control in the rebuilt `root`. When that control is gone, `fallback` (a selector inside
 * `root`) keeps focus in the region instead. Returns whether focus was placed.
 */
export function restoreFocus(root: Element, kept: KeptFocus | null, fallback?: string): boolean {
  if (kept === null) return false;
  const match = kept.key === null ? null : [...root.querySelectorAll<HTMLElement>('[data-keep], [id]')].find((e) => keyOf(e) === kept.key);
  const target = match ?? (fallback ? root.querySelector<HTMLElement>(fallback) : null);
  if (!target) return false;
  target.focus({ preventScroll: true });
  if (match && kept.start !== null && kept.end !== null && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) target.setSelectionRange(kept.start, kept.end, kept.direction ?? 'none');
  return true;
}
