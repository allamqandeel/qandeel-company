/**
 * C7-D SEO readiness lint (pure, deterministic, no I/O) over one website revision.
 *
 * It checks only what a static revision makes MECHANICALLY verifiable — titles, descriptions, canonical declarations,
 * robots / noindex contradictions, sitemap shape, crawlable links, image alternative text, language and viewport
 * metadata, structured-data syntax and route status intents. It never predicts search success: there is no aggregate
 * number, no likelihood, no keyword volume and no position. Quality of content needs human / Review Pool judgement, and
 * real search performance enters only later as governed external evidence (C7-A).
 */

export const SEO_SEVERITIES = ['BLOCKING', 'WARNING', 'NOTICE'] as const;
export type SeoSeverity = (typeof SEO_SEVERITIES)[number];

export type SeoCode =
  | 'TITLE_MISSING'
  | 'TITLE_DUPLICATE'
  | 'DESCRIPTION_MISSING'
  | 'DESCRIPTION_DUPLICATE'
  | 'CANONICAL_MULTIPLE'
  | 'CANONICAL_NOT_ABSOLUTE'
  | 'CANONICAL_HOST_INCONSISTENT'
  | 'CANONICAL_TO_NOINDEX'
  | 'CANONICAL_TARGET_MISSING'
  | 'NOINDEX_IN_SITEMAP'
  | 'ROBOTS_BLOCKS_NOINDEX'
  | 'ROBOTS_DISALLOWS_ALL'
  | 'SITEMAP_MISSING'
  | 'SITEMAP_INVALID'
  | 'SITEMAP_TOO_LARGE'
  | 'SITEMAP_URL_NOT_IN_REVISION'
  | 'SITEMAP_LISTS_NON_200'
  | 'LINK_NOT_CRAWLABLE'
  | 'LINK_BROKEN_INTERNAL'
  | 'IMAGE_ALT_MISSING'
  | 'LANG_MISSING'
  | 'HREFLANG_INVALID'
  | 'VIEWPORT_MISSING'
  | 'STRUCTURED_DATA_INVALID'
  | 'STRUCTURED_DATA_NO_CONTEXT'
  | 'ROUTE_STATUS_INVALID'
  | 'ROUTE_REDIRECT_TARGET_MISSING'
  | 'JS_RENDERED_CONTENT';

export interface SeoFinding {
  readonly code: SeoCode;
  readonly severity: SeoSeverity;
  /** The logical path the finding concerns (or `*` for the whole revision). */
  readonly path: string;
  readonly count: number;
}

export interface SeoReport {
  readonly pagesChecked: number;
  readonly findings: readonly SeoFinding[];
  /** Counts per severity — a tally of findings, not a measure of search success. */
  readonly bySeverity: Readonly<Record<SeoSeverity, number>>;
  /** What this report is: mechanical readiness checks only. */
  readonly basis: 'MECHANICAL_CHECKS_ONLY';
  /** Search performance is never inferred here; it needs governed external evidence (C7-A). */
  readonly searchPerformance: 'NOT_ASSESSED_REQUIRES_EXTERNAL_EVIDENCE';
}

export interface SeoInputFile {
  readonly path: string;
  readonly mediaType: string;
  /** UTF-8 text of text files the lint reads (HTML, sitemap, robots, route manifest); absent for binaries. */
  readonly text: string | null;
}

const SEVERITY: Readonly<Record<SeoCode, SeoSeverity>> = {
  TITLE_MISSING: 'BLOCKING',
  TITLE_DUPLICATE: 'WARNING',
  DESCRIPTION_MISSING: 'WARNING',
  DESCRIPTION_DUPLICATE: 'NOTICE',
  CANONICAL_MULTIPLE: 'BLOCKING',
  CANONICAL_NOT_ABSOLUTE: 'WARNING',
  CANONICAL_HOST_INCONSISTENT: 'WARNING',
  CANONICAL_TO_NOINDEX: 'BLOCKING',
  CANONICAL_TARGET_MISSING: 'WARNING',
  NOINDEX_IN_SITEMAP: 'BLOCKING',
  ROBOTS_BLOCKS_NOINDEX: 'WARNING',
  ROBOTS_DISALLOWS_ALL: 'BLOCKING',
  SITEMAP_MISSING: 'NOTICE',
  SITEMAP_INVALID: 'BLOCKING',
  SITEMAP_TOO_LARGE: 'BLOCKING',
  SITEMAP_URL_NOT_IN_REVISION: 'WARNING',
  SITEMAP_LISTS_NON_200: 'BLOCKING',
  LINK_NOT_CRAWLABLE: 'WARNING',
  LINK_BROKEN_INTERNAL: 'WARNING',
  IMAGE_ALT_MISSING: 'WARNING',
  LANG_MISSING: 'WARNING',
  HREFLANG_INVALID: 'WARNING',
  VIEWPORT_MISSING: 'WARNING',
  STRUCTURED_DATA_INVALID: 'BLOCKING',
  STRUCTURED_DATA_NO_CONTEXT: 'WARNING',
  ROUTE_STATUS_INVALID: 'BLOCKING',
  ROUTE_REDIRECT_TARGET_MISSING: 'BLOCKING',
  JS_RENDERED_CONTENT: 'NOTICE',
};

/** Sitemap protocol bound per file (sitemaps.org; Search Central). */
export const SITEMAP_MAX_URLS = 50_000;
export const ROUTE_MANIFEST_PATH = 'seo/routes.json';

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
};
const tags = (html: string, name: string): string[] => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => m[0]);
const stripComments = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, '');

/** The site route a page path is served at (`index.html` → `/`, `a/index.html` → `/a/`, `a.html` → `/a.html`). */
export function pageRoute(path: string): string {
  if (path === 'index.html') return '/';
  if (path.endsWith('/index.html')) return `/${path.slice(0, -'index.html'.length)}`;
  return `/${path}`;
}

interface Page {
  readonly path: string;
  readonly route: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly canonicals: readonly string[];
  readonly noindex: boolean;
  readonly html: string;
}

function readPage(f: SeoInputFile): Page {
  const html = stripComments(f.text ?? '');
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
  const metas = tags(html, 'meta');
  const metaNamed = (n: string): string | null => {
    const m = metas.find((t) => (attr(t, 'name') ?? '').toLowerCase() === n);
    return m === undefined ? null : (attr(m, 'content') ?? '').trim();
  };
  const robots = (metaNamed('robots') ?? '').toLowerCase();
  const canonicals = tags(html, 'link').filter((t) => (attr(t, 'rel') ?? '').toLowerCase().split(/\s+/).includes('canonical')).map((t) => (attr(t, 'href') ?? '').trim());
  return { path: f.path, route: pageRoute(f.path), title: title === null || title.length === 0 ? null : title, description: metaNamed('description') || null, canonicals, noindex: /\bnoindex\b|\bnone\b/.test(robots), html };
}

/** Disallowed path prefixes for `User-agent: *` (a minimal, deterministic reading of robots.txt). */
function robotsDisallows(text: string): string[] {
  const out: string[] = [];
  let applies = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = (m[1] ?? '').toLowerCase();
    const value = (m[2] ?? '').trim();
    if (key === 'user-agent') applies = value === '*';
    else if (key === 'disallow' && applies && value.length > 0) out.push(value);
  }
  return out;
}

const HREFLANG = /^(?:x-default|[a-zA-Z]{2,3}(?:-[a-zA-Z]{4})?(?:-(?:[a-zA-Z]{2}|\d{3}))?)$/;

/**
 * Runs the readiness lint. Deterministic: the same revision always yields the same findings in the same order.
 */
export function seoReadiness(files: readonly SeoInputFile[]): SeoReport {
  const counts = new Map<string, number>();
  const add = (code: SeoCode, path: string, n = 1): void => {
    if (n <= 0) return;
    const k = `${code}\u0000${path}`;
    counts.set(k, (counts.get(k) ?? 0) + n);
  };
  const paths = new Set(files.map((f) => f.path));
  const pages = files.filter((f) => f.mediaType === 'text/html').map(readPage);
  const routes = new Map(pages.map((p) => [p.route, p]));

  // Route manifest (optional): status intent per route.
  const status = new Map<string, number>();
  const manifest = files.find((f) => f.path === ROUTE_MANIFEST_PATH);
  if (manifest?.text) {
    try {
      const parsed = JSON.parse(manifest.text) as { routes?: { path?: unknown; status?: unknown; location?: unknown }[] };
      for (const r of parsed.routes ?? []) {
        if (typeof r.path !== 'string' || ![200, 301, 302, 307, 308, 404, 410].includes(Number(r.status))) {
          add('ROUTE_STATUS_INVALID', ROUTE_MANIFEST_PATH);
          continue;
        }
        status.set(r.path, Number(r.status));
        if ([301, 302, 307, 308].includes(Number(r.status)) && (typeof r.location !== 'string' || r.location.length === 0)) add('ROUTE_REDIRECT_TARGET_MISSING', ROUTE_MANIFEST_PATH);
      }
    } catch {
      add('ROUTE_STATUS_INVALID', ROUTE_MANIFEST_PATH);
    }
  }

  // Sitemap.
  const sitemap = files.find((f) => f.path === 'sitemap.xml');
  const sitemapRoutes = new Set<string>();
  if (!sitemap) {
    if (pages.length > 1) add('SITEMAP_MISSING', '*');
  } else {
    const xml = sitemap.text ?? '';
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1] ?? '');
    if (!/<urlset\b[^>]*xmlns\s*=\s*["']http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9["']/i.test(xml) || locs.length === 0) add('SITEMAP_INVALID', 'sitemap.xml');
    if (locs.length > SITEMAP_MAX_URLS) add('SITEMAP_TOO_LARGE', 'sitemap.xml');
    for (const loc of locs) {
      let route: string;
      try {
        route = new URL(loc).pathname;
      } catch {
        add('SITEMAP_INVALID', 'sitemap.xml');
        continue;
      }
      sitemapRoutes.add(route);
      const page = routes.get(route);
      if (!page) add('SITEMAP_URL_NOT_IN_REVISION', 'sitemap.xml');
      else if (page.noindex) add('NOINDEX_IN_SITEMAP', page.path);
      const s = status.get(route);
      if (s !== undefined && s !== 200) add('SITEMAP_LISTS_NON_200', 'sitemap.xml');
    }
  }

  // robots.txt.
  const robots = files.find((f) => f.path === 'robots.txt');
  const disallows = robots?.text ? robotsDisallows(robots.text) : [];
  if (disallows.includes('/')) add('ROBOTS_DISALLOWS_ALL', 'robots.txt');

  // Per page.
  const titles = new Map<string, string[]>();
  const descriptions = new Map<string, string[]>();
  const canonicalHosts = new Set<string>();
  for (const p of pages) {
    if (p.title === null) add('TITLE_MISSING', p.path);
    else titles.set(p.title, [...(titles.get(p.title) ?? []), p.path]);
    if (p.description === null) add('DESCRIPTION_MISSING', p.path);
    else descriptions.set(p.description, [...(descriptions.get(p.description) ?? []), p.path]);
    if (p.canonicals.length > 1) add('CANONICAL_MULTIPLE', p.path);
    for (const c of p.canonicals) {
      let u: URL;
      try {
        u = new URL(c);
      } catch {
        add('CANONICAL_NOT_ABSOLUTE', p.path);
        continue;
      }
      canonicalHosts.add(u.host);
      const target = routes.get(u.pathname);
      if (!target) add('CANONICAL_TARGET_MISSING', p.path);
      else if (target.noindex) add('CANONICAL_TO_NOINDEX', p.path);
    }
    if (p.noindex && disallows.some((d) => p.route.startsWith(d))) add('ROBOTS_BLOCKS_NOINDEX', p.path);
    const htmlTag = tags(p.html, 'html')[0];
    if (!htmlTag || !attr(htmlTag, 'lang')) add('LANG_MISSING', p.path);
    if (!tags(p.html, 'meta').some((t) => (attr(t, 'name') ?? '').toLowerCase() === 'viewport')) add('VIEWPORT_MISSING', p.path);
    for (const l of tags(p.html, 'link').filter((t) => (attr(t, 'rel') ?? '').toLowerCase() === 'alternate' && attr(t, 'hreflang') !== null)) {
      if (!HREFLANG.test(attr(l, 'hreflang') ?? '')) add('HREFLANG_INVALID', p.path);
    }
    // Links: crawlable means an <a> with a resolvable href (not script-only).
    for (const a of tags(p.html, 'a')) {
      const href = attr(a, 'href');
      if (href === null || href.trim() === '' || href.trim() === '#' || /^\s*javascript:/i.test(href)) {
        add('LINK_NOT_CRAWLABLE', p.path);
        continue;
      }
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) continue;
      const clean = (href.split(/[?#]/)[0] ?? '').trim();
      if (clean.length === 0) continue;
      const base = p.path.includes('/') ? p.path.slice(0, p.path.lastIndexOf('/') + 1) : '';
      const resolved = clean.startsWith('/') ? clean.slice(1) : normalizeRelative(base + clean);
      if (resolved === null) {
        add('LINK_BROKEN_INTERNAL', p.path);
        continue;
      }
      const candidates = resolved === '' ? ['index.html'] : resolved.endsWith('/') ? [`${resolved}index.html`] : [resolved, `${resolved}/index.html`, `${resolved}.html`];
      if (!candidates.some((c) => paths.has(c))) add('LINK_BROKEN_INTERNAL', p.path);
    }
    add('IMAGE_ALT_MISSING', p.path, tags(p.html, 'img').filter((t) => attr(t, 'alt') === null).length);
    for (const m of p.html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (!/type\s*=\s*["']?application\/ld\+json/i.test(m[1] ?? '')) continue;
      try {
        const data = JSON.parse(m[2] ?? '') as unknown;
        const items = Array.isArray(data) ? data : [data];
        if (!items.every((x) => typeof x === 'object' && x !== null && '@context' in x)) add('STRUCTURED_DATA_NO_CONTEXT', p.path);
      } catch {
        add('STRUCTURED_DATA_INVALID', p.path);
      }
    }
    // JavaScript SEO: a body whose visible text is empty once scripts are removed depends on client rendering.
    const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(p.html)?.[1] ?? p.html;
    const visible = body.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, '').trim();
    if (visible.length === 0 && /<script\b/i.test(body)) add('JS_RENDERED_CONTENT', p.path);
  }
  for (const list of titles.values()) if (list.length > 1) for (const path of list) add('TITLE_DUPLICATE', path);
  for (const list of descriptions.values()) if (list.length > 1) for (const path of list) add('DESCRIPTION_DUPLICATE', path);
  if (canonicalHosts.size > 1) add('CANONICAL_HOST_INCONSISTENT', '*');

  const findings = [...counts.entries()]
    .map(([k, count]) => {
      const [code, path] = k.split('\u0000') as [SeoCode, string];
      return { code, severity: SEVERITY[code], path, count };
    })
    .sort((a, b) => SEO_SEVERITIES.indexOf(a.severity) - SEO_SEVERITIES.indexOf(b.severity) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const bySeverity = { BLOCKING: 0, WARNING: 0, NOTICE: 0 };
  for (const f of findings) bySeverity[f.severity]++;
  return { pagesChecked: pages.length, findings, bySeverity, basis: 'MECHANICAL_CHECKS_ONLY', searchPerformance: 'NOT_ASSESSED_REQUIRES_EXTERNAL_EVIDENCE' };
}

/** Resolves `.` / `..` inside the project; null when the reference escapes it. */
function normalizeRelative(p: string): string | null {
  const out: string[] = [];
  const parts = p.split('/');
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i] as string;
    if (s === '.' || (s === '' && i < parts.length - 1)) continue;
    if (s === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(s);
  }
  return out.join('/');
}
