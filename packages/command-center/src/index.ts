/**
 * @qandeel-company/command-center — the C5 Founder Command Center application surface.
 *
 * One process: the canonical Company runtime plus a loopback-only, session-authenticated HTTP surface
 * that serves the Attention Orbits UI and its explicit capabilities. No second backend, no direct SQLite,
 * no test seam, no remote asset.
 */
export { FounderSurface, type FounderSurfaceOptions } from './surface.js';
export { BriefingPolicy, BRIEF_COOLDOWN_MS, signalFor, type BriefSignal } from './briefing.js';
export { CSRF_COOKIE, CSRF_HEADER, LAUNCH_PATH, LOOPBACK_HOST, MAX_BODY_BYTES, SESSION_COOKIE, allowedHosts, allowedOrigins, gateRequest, parseCookies, securityHeaders, statusForCode, type Gate, type RequestFacts } from './security.js';
export { defaultStaticRoots, findThreeRoot, resolveStatic, uiPackageRoot, type StaticFile, type StaticRoots } from './static.js';
export * as founderApi from './api.js';
