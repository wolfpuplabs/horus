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

/**
 * NASA GIBS WMS on the geographic endpoint: thermal anomalies are vector data
 * that the Web Mercator endpoint cannot render, so the geographic service
 * draws them for EPSG:3857 tiles instead.
 */
export const GIBS_WMS_URL =
  'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
/** VIIRS 375 m active fires from NOAA-20 and Suomi NPP, latest day. */
export const FIRE_HOTSPOT_LAYERS = Object.freeze([
  'VIIRS_NOAA20_Thermal_Anomalies_375m_All',
  'VIIRS_SNPP_Thermal_Anomalies_375m_All',
]);

/**
 * Active-fire hotspots drawn by NASA GIBS. The browser loads the images from
 * NASA directly: keyless, and no request reaches this app's functions.
 */
export function createFireHotspotsLayer(options = {}) {
  return createTileOverlayLayer({
    id: 'hotspots',
    name: 'Fire hotspots (VIIRS)',
    icon: '🔥',
    source: 'NASA GIBS · VIIRS',
    maximumLevel: 12,
    alpha: 1,
    countLabel: msg('Mapped'),
    credit: 'NASA GIBS · VIIRS 375 m thermal anomalies (NOAA-20, Suomi NPP)',
    createProvider: (cesium) =>
      new cesium.WebMapServiceImageryProvider({
        url: GIBS_WMS_URL,
        layers: FIRE_HOTSPOT_LAYERS.join(','),
        parameters: {
          service: 'WMS',
          format: 'image/png',
          transparent: true,
          version: '1.3.0',
        },
        crs: 'EPSG:3857',
        tilingScheme: new cesium.WebMercatorTilingScheme(),
        maximumLevel: 12,
        credit: 'NASA GIBS',
      }),
    ...options,
  });
}
