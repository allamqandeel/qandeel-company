/**
 * @qandeel-company/command-center-ui — the pure model of the Tree of Light surface (layout, lenses,
 * formatting). The browser application under `src/app` imports these same modules; the Node tests run
 * them directly. Nothing here touches the DOM, the network or storage.
 */
export { RANK_ORDER, layoutUniverse, stableHash } from './model/layout.js';
export { applyLens, chainNodeIds, showsRelations } from './model/lenses.js';
export * from './model/format.js';
export type { Emphasis, Layout, LayoutColumn, LayoutEdge, LayoutNode, Lens, NodeKind, ReportEdge } from './model/types.js';
