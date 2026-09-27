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

/** Secret-shaped literals that never enter Memory, Knowledge, Skill payloads or Academy content (Stage 14). */
export const SECRET_LITERALS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-(?:live|proj|ant|test)?-?[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\b(?:password|passwd|api[_-]?key|secret|bearer)\s*[:=]\s*\S{6,}/i,
];

export function containsSecretMaterial(s: string): boolean {
  return SECRET_LITERALS.some((re) => re.test(s));
}

/** Topic / claim keys: short dotted lower-case codes (e.g. `egypt.payments.preferred-method`). */
export const KEY_CODE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+){0,9}$/;
