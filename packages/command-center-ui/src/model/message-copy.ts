/**
 * P1-CEO-CONVERSATION-UX-01 (CHAT-COPY-01) — what one chat message copies: exactly the text the bubble shows, never the
 * sender, the time, the purpose pill or the reply status. A plain message copies its body verbatim (paragraphs, line breaks,
 * Arabic and English untouched); a Founder Communication Standard brief copies its four parts, each under the title it is
 * shown with. The copied text is never logged, sent or stored here: it goes to the clipboard and nowhere else.
 */

/** The four parts of a brief, in the order and with the titles the bubble shows them. */
export function briefRows(brief: Record<string, unknown>): readonly { readonly title: string; readonly text: string }[] {
  return [
    { title: 'What is happening', text: String(brief.happening) },
    { title: 'Why it matters', text: String(brief.matters) },
    { title: 'Recommendation', text: String(brief.recommendation) },
    { title: 'Decision needed', text: brief.decisionNeeded ? String(brief.decision ?? 'Yes') : 'No decision needed' },
  ];
}

/** The complete text of one displayed message. */
export function messageCopyText(m: { readonly body?: unknown; readonly brief?: unknown }): string {
  const brief = m.brief;
  if (typeof brief === 'object' && brief !== null) return briefRows(brief as Record<string, unknown>).map((r) => `${r.title}\n${r.text}`).join('\n\n');
  return typeof m.body === 'string' ? m.body : '';
}

export interface ClipboardLike {
  writeText(text: string): Promise<void>;
}

/**
 * Copies `text`: the asynchronous Clipboard API first, then the given synchronous fallback. True only when one of them
 * reported success; an empty text, a missing API, a refusal or a throw is false (never a claimed copy).
 */
export async function copyToClipboard(text: string, clipboard: ClipboardLike | null | undefined, fallback?: (text: string) => boolean): Promise<boolean> {
  if (text === '') return false;
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // refused (permission, focus, insecure context): the fallback may still work
    }
  }
  try {
    return fallback ? fallback(text) === true : false;
  } catch {
    return false;
  }
}
