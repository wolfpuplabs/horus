import * as Cesium from 'cesium';
import { createNaturalDisastersLayer } from '../../layers/disasters/index.js';
import { createPriorityLayer } from '../../layers/priority/index.js';
import * as picking from '../../data/pickRegistry.js';
import * as overlays from '../../overlays/worldOverlay.js';
import { isPointerFree } from '../../data/inputOwnership.js';

const applicationWiring = () => ({
  overlayHost: {
    setEntries: overlays.setOverlayEntries,
    setVisible: overlays.setOverlaySourceVisible,
    clearSource: overlays.clearOverlaySource,
    hitTest: overlays.hitTestWorldOverlay,
  },
  openExternal: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
  screenSpaceEventHandlerFactory: (viewer) =>
    new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas),
  picking,
  pointer: { isPointerFree },
});

/** Wire GDACS + EONET natural disasters into the application catalog. */
export function createApplicationNaturalDisasters(options) {
  return createNaturalDisastersLayer({ ...applicationWiring(), ...options });
}

/** Wire the JEV priority ranking into the application catalog. */
export function createApplicationPriority(options) {
  return createPriorityLayer({ ...applicationWiring(), ...options });
}
