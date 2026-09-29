/**
 * @qandeel-company/command-center-ui — the pure model of the Attention Orbits UI (layout, lenses,
 * formatting). The browser application under `src/app` imports these same modules; the Node tests run
 * them directly. Nothing here touches the DOM, the network or storage.
 */
export { RING_HEIGHT, RING_RADIUS, layoutUniverse, sectorsOf, stableHash } from './model/layout.js';
export { applyLens, cameraTargetFor, chainNodeIds, labelTier, labelVisible } from './model/lenses.js';
export * from './model/format.js';
export type { Emphasis, Layout, LayoutEdge, LayoutNode, LayoutSector, Lens, NodeKind } from './model/types.js';
