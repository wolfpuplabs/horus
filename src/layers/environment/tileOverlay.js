/**
 * A draped XYZ tile overlay (deforestation, species density): one imagery
 * layer that follows the active map stack. A globe stack drapes on
 * `viewer.imageryLayers`; a 3D-tiles stack drapes on the tileset; with neither
 * the row says the map source hides it. No polling: tiles load on demand.
 */
import * as Cesium from 'cesium';
import { t } from '../../i18n/index.js';
import { NO_IMAGERY_HOST } from '../../maps/imageryHost.js';

/**
 * @param {object} config
 * @param {string} config.id
 * @param {string} config.name English layer name.
 * @param {string} config.icon
 * @param {string} config.source Attribution shown on the layer row.
 * @param {string} config.url XYZ template with {z}/{x}/{y}.
 * @param {number} [config.maximumLevel]
 * @param {number} [config.alpha]
 * @param {string} config.countLabel English label for the row's count.
 * @param {string} config.credit Credit drawn in the Cesium credit area.
 */
export function createTileOverlayLayer({
  id,
  name,
  icon,
  source,
  url,
  maximumLevel = 12,
  alpha = 0.85,
  countLabel,
  credit,
  cesium = Cesium,
  eventTarget = globalThis,
} = {}) {
  let viewer = null;
  let imageryHost = null;
  let enabled = false;
  let imageryLayer = null;
  let collection = null;
  let error = null;
  let enabledAt = null;

  const resolveHost = () =>
    imageryHost?.() ?? {
      collection: viewer?.imageryLayers || null,
      kind: viewer ? 'globe' : 'none',
    };

  const detach = () => {
    if (imageryLayer && collection && !collection.isDestroyed?.())
      collection.remove(imageryLayer, true);
    imageryLayer = null;
    collection = null;
  };

  /** Keep the overlay on the surface the current map stack draws. */
  const sync = () => {
    if (!enabled || !viewer) return detach();
    const host = resolveHost();
    error = host.collection ? null : NO_IMAGERY_HOST;
    if (host.collection === collection && imageryLayer) {
      collection.raiseToTop?.(imageryLayer);
      return;
    }
    detach();
    if (!host.collection) return;
    const provider = new cesium.UrlTemplateImageryProvider({
      url,
      maximumLevel,
      credit,
    });
    imageryLayer = new cesium.ImageryLayer(provider, { alpha });
    host.collection.add(imageryLayer);
    collection = host.collection;
    viewer.scene?.requestRender?.();
  };

  const onMapStackChanged = () => sync();

  return {
    id,
    name,
    icon,
    source,
    updateInterval: 0,

    init(nextViewer) {
      viewer = nextViewer;
      eventTarget?.addEventListener?.(
        'gev:map-stack-changed',
        onMapStackChanged,
      );
    },

    attachShellServices(services) {
      imageryHost =
        typeof services?.imageryHost === 'function'
          ? services.imageryHost
          : null;
      sync();
    },

    enable() {
      enabled = true;
      enabledAt = Date.now();
      sync();
    },

    disable() {
      enabled = false;
      enabledAt = null;
      detach();
      viewer?.scene?.requestRender?.();
    },

    async update() {
      sync();
      return enabled;
    },

    destroy() {
      enabled = false;
      detach();
      eventTarget?.removeEventListener?.(
        'gev:map-stack-changed',
        onMapStackChanged,
      );
      imageryHost = null;
      viewer = null;
    },

    getStats() {
      const shown = Boolean(enabled && imageryLayer);
      return {
        count: shown ? 1 : 0,
        countLabel: t(countLabel),
        lastUpdate: shown ? enabledAt : null,
        error,
        source,
      };
    },
  };
}
