/**
 * Environment overlays: tree-cover loss and where plants and animals have
 * been recorded. Both are keyless tile layers.
 */
import { msg } from '../../i18n/index.js';
import { createTileOverlayLayer } from './tileOverlay.js';

export { createTileOverlayLayer } from './tileOverlay.js';

/**
 * Hansen / UMD / Google Global Forest Change v1.13: tree-cover loss 2001–2025
 * as red, transparent elsewhere. Native tiles stop at zoom 12.
 */
export const FOREST_LOSS_TILES =
  'https://storage.googleapis.com/earthenginepartners-hansen/tiles/gfc_v1.13/loss_alpha/{z}/{x}/{y}.png';

/** Tree-cover loss since 2001 (Global Forest Change). */
export function createForestLossLayer(options = {}) {
  return createTileOverlayLayer({
    id: 'deforestation',
    name: 'Deforestation (2001–2025)',
    icon: '🌳',
    source: 'Hansen/UMD/Google · GFW',
    url: FOREST_LOSS_TILES,
    maximumLevel: 12,
    alpha: 0.85,
    countLabel: msg('Mapped'),
    credit: 'Hansen/UMD/Google/USGS/NASA Global Forest Change (CC BY 4.0)',
    ...options,
  });
}

/** Recorded plant occurrences (GBIF kingdom Plantae), hex-binned density. */
export function createFloraHabitatLayer(options = {}) {
  return createTileOverlayLayer({
    id: 'flora',
    name: 'Flora habitat (GBIF)',
    icon: '🌿',
    source: 'GBIF.org',
    url: '/api/gbif-tiles/flora/{z}/{x}/{y}.png',
    maximumLevel: 14,
    alpha: 0.75,
    countLabel: msg('Mapped'),
    credit: 'GBIF.org occurrence data (CC BY 4.0)',
    ...options,
  });
}

/** Recorded animal occurrences (GBIF kingdom Animalia), hex-binned density. */
export function createFaunaHabitatLayer(options = {}) {
  return createTileOverlayLayer({
    id: 'fauna',
    name: 'Fauna habitat (GBIF)',
    icon: '🐾',
    source: 'GBIF.org',
    url: '/api/gbif-tiles/fauna/{z}/{x}/{y}.png',
    maximumLevel: 14,
    alpha: 0.75,
    countLabel: msg('Mapped'),
    credit: 'GBIF.org occurrence data (CC BY 4.0)',
    ...options,
  });
}
