// Public surface of the overlay layer.
//
// Owner: workflow W4-D (world rendering). The entity layer of W5-D adds its labels
// through `OverlayScene.addLabel` and `addProgress` and imports nothing else from here.

export {
  OverlayScene,
  type OverlayLabel,
  type OverlayProgress,
  type OverlayItem,
} from './OverlayScene';
export { projectAnchor, type AnchorScreenPoint, type WorldAnchor } from './anchors';
export { debugLines, isOverBudget } from './debugLines';
