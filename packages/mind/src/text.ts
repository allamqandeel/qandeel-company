/**
 * Deterministic, provider-neutral text utilities for retrieval and integrity (C3).
 *
 * - Normalization is Unicode-aware (NFKC, case folding, Arabic diacritics removed, Alef / Yeh /
 *   Teh Marbuta variants unified) so Arabic and Latin text match the same way on every platform.
 * - Terms are the bounded, sorted set of normalized word tokens: retrieval relevance is lexical and
 *   inspectable (no embeddings, no LLM ranker, no external service).
 * - The token estimate is the same conservative UTF-8 byte bound C2 reserves budget with, so the
 *   context budget and the cost reservation see one number.
 */
import { sha256Hex } from '@qandeel-company/domain';

// Arabic tashkeel, tatweel and Quranic annotation marks carry no retrieval meaning.
const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

export function normalizeText(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(ARABIC_MARKS, '')
    .replace(/[آأإٱ]/g, 'ا') // آ أ إ ٱ → ا
    .replace(/ى/g, 'ي') // ى → ي
    .replace(/ة/g, 'ه') // ة → ه
    .replace(/\s+/g, ' ')
    .trim();
}

/** Very common words that carry no topic signal (English + Arabic), kept short and explicit. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'not', 'but', 'you', 'your', 'our', 'its', 'into', 'about', 'what', 'when', 'which', 'will', 'have', 'has', 'had', 'been', 'than', 'then', 'they', 'them', 'their', 'there', 'also', 'any', 'all', 'can', 'may', 'must', 'should', 'would', 'could',
  'في', 'من', 'على', 'الى', 'الي', 'عن', 'مع', 'هذا', 'هذه', 'ذلك', 'التي', 'الذي', 'او', 'ان', 'كان', 'لا', 'ما', 'هو', 'هي', 'كل', 'قد',
]);

export const MAX_TERMS = 48;

/** The bounded, sorted set of normalized word tokens of `s` (length ≥ 2, stopwords removed). */
export function terms(s: string, max = MAX_TERMS): string[] {
  const out = new Set<string>();
  for (const token of normalizeText(s).split(/[^\p{L}\p{N}]+/u)) {
    if (token.length < 2 || STOPWORDS.has(token)) continue;
    out.add(token.length > 40 ? token.slice(0, 40) : token);
  }
  return [...out].sort().slice(0, max);
}

/**
 * P1-CONTEXT-INTEL-01 (D-P1-14, TI-1): extra stopwords for salience only — Egyptian and Modern Standard Arabic function
 * words and short English function words. `terms()` (TI-0) and every stored `terms_json` are unchanged.
 */
const SALIENCE_STOPWORDS = new Set(
  ['اللي', 'ده', 'دي', 'دا', 'عشان', 'علشان', 'مش', 'ايه', 'ازاي', 'كده', 'بس', 'يعني', 'برضه', 'لسه', 'دلوقتي', 'احنا', 'انا', 'انت', 'انتو', 'عايز', 'عاوز', 'ممكن', 'لازم', 'كمان', 'حاجه', 'زي', 'بتاع', 'ولا', 'لو', 'لما', 'اي', 'فيه', 'فيها', 'منه', 'منها', 'عليه', 'عليها', 'ليه', 'بين', 'بعد', 'قبل', 'عند', 'غير', 'لحد', 'حتي', 'ثم', 'كما', 'لكن', 'اذا', 'هل', 'هناك', 'هنا', 'تلك', 'بعض', 'ايضا', 'جدا', 'وده', 'ودي', 'يا', 'we', 'me', 'my', 'is', 'be', 'it', 'to', 'of', 'in', 'on', 'an', 'or', 'if', 'so', 'as', 'at', 'by', 'do', 'how', 'why', 'who', 'please'].map((w) => normalizeText(w)),
);

/** The normalized word tokens of `s` in order (the `terms()` tokenizer, before selection). */
function tokensOf(s: string): string[] {
  return normalizeText(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2)
    .map((t) => (t.length > 40 ? t.slice(0, 40) : t));
}

/**
 * TI-1 salience terms: the same tokens and normal form as `terms()`, chosen by frequency (then first position) instead of
 * alphabetically, with the salience stopwords removed; output sorted. Written only as extra `~` index rows of new items
 * (DG-1n) and used on the query side; never stored in `terms_json`.
 */
export function salienceTerms(s: string, max = MAX_TERMS): string[] {
  const freq = new Map<string, number>();
  const first = new Map<string, number>();
  tokensOf(s).forEach((t, i) => {
    if (STOPWORDS.has(t) || SALIENCE_STOPWORDS.has(t)) return;
    freq.set(t, (freq.get(t) ?? 0) + 1);
    if (!first.has(t)) first.set(t, i);
  });
  return [...freq.keys()]
    .sort((a, b) => (freq.get(b) ?? 0) - (freq.get(a) ?? 0) || (first.get(a) ?? 0) - (first.get(b) ?? 0))
    .slice(0, max)
    .sort();
}

const ARABIC_START = /^[؀-ۿ]/u;
/** An Arabic token without its proclitic article (وال / بال / فال / كال / لل / ال), for query-side variants only. */
function withoutArticle(t: string): string {
  if (!ARABIC_START.test(t) || t.length < 5) return t;
  for (const p of ['وال', 'بال', 'فال', 'كال']) if (t.startsWith(p)) return t.slice(3);
  for (const p of ['لل', 'ال']) if (t.startsWith(p)) return t.slice(2);
  return t;
}

/** Query-side Arabic variants of each token: the stem and ال + stem (stored terms are never stemmed). */
function arabicVariants(ts: readonly string[]): string[] {
  return ts.flatMap((t) => {
    if (!ARABIC_START.test(t) || t.length < 4) return [t];
    const s = withoutArticle(t);
    return s === t ? [t, `ال${t}`] : [t, s, `ال${s}`];
  });
}

/**
 * The retrieval query of one task (P1-CONTEXT-INTEL-01, C3): topics ∪ TI-0(text) ∪ TI-1(text) with their Arabic proclitic
 * variants ∪ the extra terms (skill codes). No alphabetical cut: the size is bounded by construction (≤ 2 × 48 tokens,
 * ≤ 3 variants each, plus the topics and extras).
 */
export function queryTerms(text: string, topics: readonly string[] = [], extra: readonly string[] = []): string[] {
  return [...new Set([...topics, ...arabicVariants([...terms(text), ...salienceTerms(text)]), ...extra])].sort();
}

/** The `~` prefix of a TI-1 index row (DG-1n): the previous release's query terms are always `[\p{L}\p{N}]+`, so it never matches one. */
export const SALIENCE_INDEX_PREFIX = '~';

/**
 * G4-FINAL-CLOSURE-01 (D-P1-17): the language a Founder message is written in, deterministically, so a reply follows the
 * CURRENT message and never an earlier turn. Quoted text (« », “ ”, " " and lines starting with ">") does not decide; a
 * message is ARABIC or ENGLISH only when at least 70 % of its remaining letters (and at least 3) are of that script, and
 * null (mixed, or too little text) otherwise — the reply rule then decides from the request itself.
 */
export function messageLanguage(s: string): 'ARABIC' | 'ENGLISH' | null {
  const unquoted = s
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
    .replace(/«[^»]*»|“[^”]*”|"[^"\n]*"/g, ' ');
  const arabic = (unquoted.match(/[ء-ي]/g) ?? []).length;
  const latin = (unquoted.match(/[A-Za-z]/g) ?? []).length;
  const total = arabic + latin;
  if (total < 3) return null;
  if (arabic / total >= 0.7) return 'ARABIC';
  if (latin / total >= 0.7) return 'ENGLISH';
  return null;
}

/** Integrity fingerprint of text content (exact-duplicate identity after normalization). */
export function contentFingerprint(s: string): string {
  return sha256Hex(normalizeText(s));
}

/** Integrity hash of stored content bytes, exactly as stored (corruption detection). */
export function contentSha256(s: string): string {
  return sha256Hex(s);
}

/** Jaccard similarity of two term sets as an integer percentage (0..100), deterministic. */
export function similarityPct(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 100;
  const setB = new Set(b);
  let inter = 0;
  for (const t of new Set(a)) if (setB.has(t)) inter++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : Math.floor((inter * 100) / union);
}

/** Number of query terms present in an item's terms (relevance overlap). */
export function overlap(query: readonly string[], item: readonly string[]): number {
  const set = new Set(item);
  let n = 0;
  for (const t of new Set(query)) if (set.has(t)) n++;
  return n;
}

/** Conservative, provider-neutral token upper bound of one text (UTF-8 bytes; see C2 `utf8TokenUpperBound`). */
export function estimateTokens(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

/** The first sentence of a text, bounded (extractive compaction). */
export function firstSentence(s: string, maxChars: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  const end = flat.search(/[.!?؟。](\s|$)/u);
  const sentence = end >= 0 ? flat.slice(0, end + 1) : flat;
  return sentence.length > maxChars ? `${sentence.slice(0, Math.max(0, maxChars - 1))}…` : sentence;
}

/**
 * Secret-shaped material that never enters Memory, Knowledge, Skill payloads, Academy content, durable
 * step / tool results or a provider-bound instruction (Stage 12 §23, Stage 14 D14-A.4 / D-6).
 *
 * A denylist can never prove a value is not secret, so the rule stays "callers never put secrets in
 * Company state"; this is the deterministic defence in depth. R1-01 widened it after the review
 * showed common formats passing: provider keys whose body contains `-` (Anthropic), payment keys,
 * fine-grained GitHub tokens, JWTs, OAuth access tokens, `Bearer <token>`, URL credentials, JSON-quoted
 * key / value pairs, "password is …" and the Arabic equivalents.
 */
export const SECRET_LITERALS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/,
  /\bsk-(?:live|proj|ant|test)?-?[A-Za-z0-9_]{20,}/,
  /\bsk-ant-[A-Za-z0-9_-]{20,}/,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bya29\.[A-Za-z0-9_-]{20,}/,
  // Every pattern below can FAIL after reading a long run, so each run is bounded ({…,N}) and no two
  // unbounded quantifiers are adjacent: the scan is linear in the input (R1 re-review: catastrophic
  // backtracking on long whitespace / token runs).
  // JSON Web Token (header.payload.signature, base64url).
  /\beyJ[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{8,4096}\.[A-Za-z0-9_-]{8,}/,
  /\bbearer[ \t]{1,8}[A-Za-z0-9._~+/=-]{16,}/i,
  // HTTP Basic credentials: base64 carrying a digit or base64 punctuation (not the English "basic …").
  /\bbasic[ \t]{1,8}(?=[A-Za-z0-9+/]{0,512}[0-9+/=])(?:[A-Za-z0-9+/]{4}){3,128}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?(?![A-Za-z0-9+/=])/i,
  // Credentials inside a URL: scheme://user:password@host.
  /\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s:/@]{1,256}:[^\s@/]{1,256}@/i,
  /\bAccountKey=[A-Za-z0-9+/=]{20,}/,
  // Credential-named key + VALUE. The value must be credential-shaped — one token containing a digit —
  // so ordinary prose about passwords / keys / tokens ("Reset the password: follow the runbook",
  // "Secretary: …", "سياسة كلمة المرور") is never refused (R1 re-review: false positives made legitimate
  // work unrunnable). JSON quoting and `_`-joined names (aws_secret_access_key, password_hash) are
  // allowed, other suffixes (Secretary, Passwords) are not, and a quantity ("12-character") is no value.
  /(?<![A-Za-z])(?:password|passwd|passphrase|secret|api[_ -]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret)(?:_[A-Za-z0-9]{1,16}){0,3}["']?[ \t]{0,8}[:=][ \t]{0,8}["']?(?!\d{1,4}[- ]\p{L}{3,}(?=[\s,.;]|$))(?=[^\s"',}]{0,256}\d)[^\s"',}]{8,256}/iu,
  /\b(?:token|bearer)["']?[ \t]{0,8}[:=][ \t]{0,8}["']?(?=[^\s"',}]{0,256}\d)[^\s"',}]{12,256}/i,
  /\b(?:password|passwd|passphrase)[ \t]{1,8}(?:is|was|=)[ \t]{1,8}(?=\S{0,256}\d)\S{6,256}/i,
  // Arabic: the keyword, then ONE bounded separator run (spaces / ':' / '=' / هي / هو), then a token
  // containing a digit.
  /(?:كلمة[ \t]{0,4}(?:المرور|السر)|الرقم[ \t]{0,4}السري|مفتاح[ \t]{0,4}(?:الواجهة|API))(?:[ \t:=]|هي|هو){1,16}(?!\d{1,4}[- ]\p{L}{3,}(?=[\s,.;]|$))(?=\S{0,256}\d)\S{6,256}/iu,
];

/** A scan never needs more than this much text (the stored forms are all smaller): bounded work per call. */
export const SECRET_SCAN_MAX_CHARS = 16_384;

// Zero-width and invisible formatting characters used to split a secret past a pattern.
const INVISIBLE = /[\p{Cf}\u034f\u180e\u2800\u3164]/gu;

export function containsSecretMaterial(input: string): boolean {
  if (typeof input !== 'string' || input.length === 0) return false;
  // Bounded work: callers that store more than this (e.g. an oversize tool result) store only a digest.
  const s = input.length > SECRET_SCAN_MAX_CHARS ? input.slice(0, SECRET_SCAN_MAX_CHARS) : input;
  const folded = s.normalize('NFKC').replace(INVISIBLE, '');
  return SECRET_LITERALS.some((re) => re.test(s) || re.test(folded));
}

/** Topic / claim keys: short dotted lower-case codes (e.g. `egypt.payments.preferred-method`). */
export const KEY_CODE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+){0,9}$/;
