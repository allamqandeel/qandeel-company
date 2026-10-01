/**
 * C7-D SEO readiness: mechanical checks only — titles, descriptions, canonical consistency, robots / noindex and sitemap
 * contradictions, crawlable links, alt text, language, viewport, structured-data syntax, route status intent — and never a
 * score, probability, rank, keyword volume or search position. Search performance needs governed external evidence.
 * C7D-PROOF: seo-readiness
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { pageRoute, seoReadiness, type SeoInputFile } from '../src/index.js';

const html = (title: string | null, extra = '', body = '<p>Text</p>'): string =>
  `<!doctype html><html lang="ar"><head><meta name="viewport" content="width=device-width">${title === null ? '' : `<title>${title}</title>`}<meta name="description" content="d ${title ?? ''}">${extra}</head><body>${body}</body></html>`;
const page = (path: string, text: string): SeoInputFile => ({ path, mediaType: 'text/html', text });
const codes = (files: SeoInputFile[]): string[] => seoReadiness(files).findings.map((f) => `${f.code}@${f.path}`);

describe('C7-D SEO readiness lint', () => {
  test('27/28 the report carries findings and tallies only — no score, rank, probability, volume or position — and says search performance is not assessed', () => {
    const r = seoReadiness([page('index.html', html('Home'))]);
    assert.equal(r.basis, 'MECHANICAL_CHECKS_ONLY');
    assert.equal(r.searchPerformance, 'NOT_ASSESSED_REQUIRES_EXTERNAL_EVIDENCE');
    const json = JSON.stringify(r);
    assert.doesNotMatch(json, /score|rank(?!ing)|probabil|likelihood|volume|position|impression|click/i);
    assert.deepEqual(Object.keys(r).sort(), ['basis', 'bySeverity', 'findings', 'pagesChecked', 'searchPerformance']);
  });

  test('29 a noindex page listed in the sitemap, and a noindex page hidden from crawlers by robots.txt, are surfaced', () => {
    const files: SeoInputFile[] = [
      page('index.html', html('Home')),
      page('draft/index.html', html('Draft', '<meta name="robots" content="noindex">')),
      { path: 'sitemap.xml', mediaType: 'application/xml', text: '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.org/</loc></url><url><loc>https://example.org/draft/</loc></url></urlset>' },
      { path: 'robots.txt', mediaType: 'text/plain', text: 'User-agent: *\nDisallow: /draft/\n' },
    ];
    const c = codes(files);
    assert.ok(c.includes('NOINDEX_IN_SITEMAP@draft/index.html'));
    assert.ok(c.includes('ROBOTS_BLOCKS_NOINDEX@draft/index.html'));
    assert.ok(codes([page('index.html', html('Home')), { path: 'robots.txt', mediaType: 'text/plain', text: 'User-agent: *\nDisallow: /' }]).includes('ROBOTS_DISALLOWS_ALL@robots.txt'));
  });

  test('30 canonical conflicts: multiple, relative, inconsistent hosts, missing targets and canonical-to-noindex are surfaced', () => {
    const c = codes([
      page('index.html', html('Home', '<link rel="canonical" href="https://a.example/"><link rel="canonical" href="https://a.example/x">')),
      page('b/index.html', html('B', '<link rel="canonical" href="/b/">')),
      page('c/index.html', html('C', '<link rel="canonical" href="https://b.example/c/">')),
      page('d/index.html', html('D', '<link rel="canonical" href="https://a.example/nope/">')),
      page('e/index.html', html('E', '<link rel="canonical" href="https://a.example/f/">')),
      page('f/index.html', html('F', '<meta name="robots" content="noindex">')),
    ]);
    for (const x of ['CANONICAL_MULTIPLE@index.html', 'CANONICAL_NOT_ABSOLUTE@b/index.html', 'CANONICAL_HOST_INCONSISTENT@*', 'CANONICAL_TARGET_MISSING@d/index.html', 'CANONICAL_TO_NOINDEX@e/index.html']) assert.ok(c.includes(x), x);
  });

  test('31 sitemap shape and status intent are checked deterministically (the same input → the same findings, in order)', () => {
    const files: SeoInputFile[] = [
      page('index.html', html('Home')),
      page('old/index.html', html('Old')),
      { path: 'sitemap.xml', mediaType: 'application/xml', text: '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.org/old/</loc></url><url><loc>https://example.org/missing/</loc></url></urlset>' },
      { path: 'seo/routes.json', mediaType: 'application/json', text: JSON.stringify({ routes: [{ path: '/old/', status: 301 }, { path: '/x', status: 999 }] }) },
    ];
    const a = seoReadiness(files);
    assert.deepEqual(a, seoReadiness([...files].reverse()));
    const c = a.findings.map((f) => f.code);
    for (const x of ['SITEMAP_LISTS_NON_200', 'SITEMAP_URL_NOT_IN_REVISION', 'ROUTE_REDIRECT_TARGET_MISSING', 'ROUTE_STATUS_INVALID']) assert.ok(c.includes(x as never), x);
    assert.ok(codes([page('index.html', html('A')), page('b.html', html('B')), { path: 'sitemap.xml', mediaType: 'application/xml', text: '<urlset></urlset>' }]).includes('SITEMAP_INVALID@sitemap.xml'));
    assert.ok(codes([page('index.html', html('A')), page('b.html', html('B'))]).includes('SITEMAP_MISSING@*'));
  });

  test('titles, descriptions, links, alt text, language, viewport, structured data and client-rendered pages', () => {
    const c = codes([
      page('index.html', html(null, '', '<a href="javascript:go()">x</a><a>y</a><a href="missing/">z</a><img src="a.png"><script type="application/ld+json">{bad json</script>')),
      page('a.html', html('Same')),
      page('b.html', html('Same', '<link rel="alternate" hreflang="arabic" href="https://x/">', '<div id="root"></div><script src="app.js"></script>')),
      page('c.html', '<html><head><title>C</title></head><body><p>c</p><script type="application/ld+json">{"name":"x"}</script></body></html>'),
    ]);
    for (const x of ['TITLE_MISSING@index.html', 'TITLE_DUPLICATE@a.html', 'TITLE_DUPLICATE@b.html', 'LINK_NOT_CRAWLABLE@index.html', 'LINK_BROKEN_INTERNAL@index.html', 'IMAGE_ALT_MISSING@index.html', 'STRUCTURED_DATA_INVALID@index.html', 'HREFLANG_INVALID@b.html', 'JS_RENDERED_CONTENT@b.html', 'LANG_MISSING@c.html', 'VIEWPORT_MISSING@c.html', 'DESCRIPTION_MISSING@c.html', 'STRUCTURED_DATA_NO_CONTEXT@c.html']) assert.ok(c.includes(x), x);
    assert.equal(pageRoute('index.html'), '/');
    assert.equal(pageRoute('ar/index.html'), '/ar/');
  });

  test('32 a clean page produces no blocking finding — and still no claim about ranking or traffic', () => {
    const r = seoReadiness([page('index.html', html('QANDEEL', '<link rel="canonical" href="https://example.org/">', '<p>Real people-first copy.</p><a href="about/">About</a><img src="l.png" alt="logo">')), page('about/index.html', html('About', '<link rel="canonical" href="https://example.org/about/">')), { path: 'sitemap.xml', mediaType: 'application/xml', text: '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.org/</loc></url><url><loc>https://example.org/about/</loc></url></urlset>' }]);
    assert.equal(r.bySeverity.BLOCKING, 0);
    assert.equal(r.searchPerformance, 'NOT_ASSESSED_REQUIRES_EXTERNAL_EVIDENCE');
  });
});
