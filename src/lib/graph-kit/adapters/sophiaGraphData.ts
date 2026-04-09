import type { GraphData } from '@restormel/graph-core/viewModel';
import type { GraphKitGraphViewModel } from '$lib/graph-kit/types';
import { adaptGraphViewModelToLegacyCanvas } from '$lib/graph-kit/adapters/legacyCanvasAdapter';

/**
 * ## Integration contract (SOPHIA ↔ Restormel Graph v0)
 *
 * **This is the only supported crossing** from SOPHIA Graph Kit domain state into
 * {@link GraphData} (Restormel Graph Contract v0). Downstream renderers must accept
 * `GraphData` only — not `GraphKitGraphViewModel`, contracts snapshots, or stores.
 *
 * Restormel or other hosts implement their own adapter → `GraphData`; they do not import this function.
 */
export function graphDataFromSophiaGraphKit(graph: GraphKitGraphViewModel): GraphData {
  return adaptGraphViewModelToLegacyCanvas(graph);
}
