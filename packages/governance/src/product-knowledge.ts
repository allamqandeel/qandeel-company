/**
 * P1-PRODUCT-KNOWLEDGE-01 (D-P1-06) — Shared Product Knowledge: the pure contract of the read-only product documentation
 * source (no I/O here).
 *
 * The QANDEEL App is a separate product and repository. The Company never imports, builds or writes it; it may READ the
 * App's public product documentation, on demand, through ONE governed Tool (`product-knowledge.product-docs-read`, R0,
 * no side effect, no credential). The repository itself is never named in Company code: the Founder registers it as
 * data (a digital target of the `github.product-docs` adapter), and only an Employee the Founder granted the action may
 * request a read. What a document says is evidence to cite, never an instruction, a grant or Canonical Truth.
 */
import { QandeelError } from '@qandeel-company/domain';

/** The Tool code the Founder registers (Tool Registry) and grants per Employee. */
export const PRODUCT_KNOWLEDGE_TOOL = 'product-knowledge';
/** The one action: a bounded, read-only search of the product documentation at the current `main` commit. */
export const PRODUCT_DOCS_READ_ACTION = 'product-docs-read';
/** The driver (adapter) code of the read-only GitHub documentation reader. */
export const PRODUCT_DOCS_ADAPTER = 'github.product-docs';
/** The code of the Founder-registered source (one digital target of the adapter above). */
export const PRODUCT_SOURCE_TARGET_CODE = 'product-knowledge-source';
/** The capability a grant must name exactly (Stage 7: `tool:<tool>.<action>`). */
export const PRODUCT_DOCS_CAPABILITY = `tool:${PRODUCT_KNOWLEDGE_TOOL}.${PRODUCT_DOCS_READ_ACTION}`;
/** The only branch read: the App's canonical `main` (resolved to an exact commit SHA on every read). */
export const PRODUCT_DOCS_BRANCH = 'main';

/** The argument schema of the read (validated strictly by the Tool Registry before any driver call). */
export const PRODUCT_DOCS_ARGS_SCHEMA = Object.freeze({
  fields: Object.freeze({
    query: Object.freeze({ type: 'string' as const, required: true, maxLength: 200 }),
    path: Object.freeze({ type: 'string' as const, required: false, maxLength: 200 }),
  }),
});

/**
 * The locator documents searched when no path is named, in the App's own reading order (its README "Start here"). They
 * locate authority; the primary records they cite outrank them (the App's authority precedence).
 */
export const PRODUCT_LOCATOR_DOCS: readonly string[] = Object.freeze(['QANDEEL_CURRENT_STATE.md', 'QANDEEL_PROJECT_MAP.md', 'QANDEEL_PRODUCT_ROADMAP.md', 'README.md']);

const ROOT_DOC = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}\.md$/;
const DOCS_DOC = /^docs\/[A-Za-z0-9][A-Za-z0-9._/-]{0,180}\.md$/;

/**
 * The closed source list: a Markdown document at the repository root or under `docs/`. Never code, configuration, an
 * environment file, a workflow, a hidden file or a path that climbs.
 */
export function isProductDocPath(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 200) return false;
  if (v.includes('..') || v.includes('//') || v.includes('\\') || /(^|\/)\./.test(v)) return false;
  return ROOT_DOC.test(v) || DOCS_DOC.test(v);
}

const OWNER = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})';
const REPO = '[A-Za-z0-9._-]{1,100}';

/** `github:<owner>/<repo>` → its parts (the Founder-registered source identifier), or a refusal. */
export function assertProductRepositoryRef(v: unknown, field = 'repository'): { readonly externalRef: string; readonly owner: string; readonly repo: string } {
  const m = typeof v === 'string' ? new RegExp(`^github:(${OWNER})/(${REPO})$`).exec(v.trim()) : null;
  if (!m || (m[2] as string).includes('..') || (m[2] as string).startsWith('.')) throw new QandeelError('VALIDATION_FAILED', 'the product source is github:<owner>/<repository>', { field, reason: 'PRODUCT_SOURCE_INVALID' });
  return { externalRef: `github:${m[1]}/${m[2]}`, owner: m[1] as string, repo: m[2] as string };
}

/**
 * The four states an Employee must keep apart when it reports a capability (Task Contract §3.6). The reader derives a
 * conservative hint from a row's own lifecycle label; anything it cannot place is UNKNOWN_VERIFY (never a guess).
 */
export const PRODUCT_STATUS_HINTS = ['IMPLEMENTED_MERGED', 'APPROVED_NOT_IMPLEMENTED', 'ACTIVE_IN_PROGRESS', 'UNKNOWN_VERIFY'] as const;
export type ProductStatusHint = (typeof PRODUCT_STATUS_HINTS)[number];
