/**
 * Natural disasters now (GDACS + NASA EONET, merged by /api/disasters): one
 * coloured marker per event, sized by GDACS alert level, with a card on click
 * that links to the event report.
 */
import * as Cesium from 'cesium';
import { msg, t } from '../../i18n/index.js';
import { DISASTER_KINDS, normalizeDisasterSnapshot } from './records.js';

export * from './records.js';

export const DISASTER_OVERLAY_SOURCE_ID = 'disasters';
const PICK_PREFIX = 'disaster:';
const CARD_HOST_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

/** Marker colour and legend label for each disaster kind. */
export const DISASTER_STYLES = Object.freeze({
  flood: Object.freeze({ color: '#3b82f6', label: msg('Flood') }),
  wildfire: Object.freeze({ color: '#f97316', label: msg('Wildfire') }),
  cyclone: Object.freeze({ color: '#a855f7', label: msg('Tropical cyclone') }),
  storm: Object.freeze({ color: '#8b5cf6', label: msg('Severe storm') }),
  volcano: Object.freeze({ color: '#dc2626', label: msg('Volcano') }),
  earthquake: Object.freeze({ color: '#eab308', label: msg('Earthquake') }),
  drought: Object.freeze({ color: '#b45309', label: msg('Drought') }),
  landslide: Object.freeze({ color: '#78716c', label: msg('Landslide') }),
  'extreme-temperature': Object.freeze({
    color: '#ef4444',
    label: msg('Extreme temperature'),
  }),
  other: Object.freeze({ color: '#9ca3af', label: msg('Other hazard') }),
});

const ALERT_LABELS = Object.freeze({
  red: msg('Red alert'),
  orange: msg('Orange alert'),
  green: msg('Green alert'),
});

const PIXEL_SIZE = Object.freeze({ red: 18, orange: 14, green: 10 });
/** Within this camera distance markers ignore terrain depth. */
const NEAR_ON_TOP_METRES = 2_000_000;

/** The source the layer reads by default: this app's merged proxy. */
export function createDisasterSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  url = '/api/disasters',
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(url, { signal });
      if (!response.ok)
        throw new Error(`Disaster feed HTTP ${response.status}`);
      const payload = await response.json();
      signal?.throwIfAborted();
      const rows = normalizeDisasterSnapshot(payload);
      if (!rows) throw new Error('Malformed disaster feed');
      return rows;
    },
  };
}

/** Card model for one selected disaster. Pure — no Cesium types. */
export function buildDisasterCard(row, nowMs = Date.now()) {
  const style = DISASTER_STYLES[row.kind] || DISASTER_STYLES.other;
  const facts = [t(style.label)];
  if (row.alert) facts.push(t(ALERT_LABELS[row.alert]));
  if (row.country) facts.push(row.country);
  const details = [facts.join(' · ')];
  if (row.severity) details.push(row.severity);
  if (Number.isFinite(row.startMs)) {
    const days = Math.max(0, Math.floor((nowMs - row.startMs) / 86_400_000));
    details.push(
      days === 0
        ? t('Started today · {source}', { source: row.source })
        : t('Started {days} d ago · {source}', { days, source: row.source }),
    );
  } else details.push(row.source);
  if (row.url) details.push(t('Report ↗ · click card to open'));
  return {
    id: `disaster-card:${row.id}`,
    selected: true,
    interactive: Boolean(row.url),
    title: row.title,
    details,
    accent: style.color,
    priority: Number.MAX_SAFE_INTEGER,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Own the disaster markers, their refresh, and click selection. */
export function createNaturalDisastersLayer({
  source = createDisasterSource(),
  overlayHost = null,
  screenSpaceEventHandlerFactory = null,
  picking = null,
  pointer = null,
  openExternal = null,
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Natural disasters require a snapshot source');
  let viewer = null;
  let dataSource = null;
  let request = null;
  let enabled = false;
  let clickHandler = null;
  let selectedId = null;
  let lastUpdate = null;
  let lastError = null;
  /** @type {Map<string, object>} */
  const rowsById = new Map();

  const canSelect = () => overlayHost && screenSpaceEventHandlerFactory;

  function publishSelectedCard() {
    if (!overlayHost) return;
    const row = selectedId ? rowsById.get(selectedId) : null;
    if (!row) {
      selectedId = null;
      overlayHost.setEntries(DISASTER_OVERLAY_SOURCE_ID, [], CARD_HOST_OPTIONS);
      return;
    }
    const card = {
      ...buildDisasterCard(row),
      position: Cesium.Cartesian3.fromDegrees(row.lon, row.lat),
    };
    if (!openExternal) card.interactive = false;
    else if (row.url)
      card.activate = () => {
        openExternal(row.url);
        return true;
      };
    overlayHost.setEntries(
      DISASTER_OVERLAY_SOURCE_ID,
      [card],
      CARD_HOST_OPTIONS,
    );
  }

  const pickedRowId = (picked) => {
    const id = picking?.resolvePickId
      ? picking.resolvePickId(picked)
      : picked?.id?.id;
    if (typeof id !== 'string' || !id.startsWith(PICK_PREFIX)) return null;
    const rowId = id.slice(PICK_PREFIX.length);
    return rowsById.has(rowId) ? rowId : null;
  };

  function installClickHandler() {
    if (!canSelect() || clickHandler || !viewer) return;
    clickHandler = screenSpaceEventHandlerFactory(viewer);
    clickHandler.setInputAction((click) => {
      if (pointer && !pointer.isPointerFree()) return;
      const cardHit = overlayHost.hitTest?.(
        click.position?.x,
        click.position?.y,
        { sourceId: DISASTER_OVERLAY_SOURCE_ID },
      );
      const selected = selectedId ? rowsById.get(selectedId) : null;
      if (cardHit && cardHit.entryId === `disaster-card:${selectedId}`) {
        if (selected?.url && openExternal) openExternal(selected.url);
        return;
      }
      const picked = viewer.scene.pick(click.position);
      const rowId = picked ? pickedRowId(picked) : null;
      if (rowId) {
        selectedId = rowId;
        publishSelectedCard();
        return;
      }
      if (picked && picking?.isOwnedByOtherLayer) {
        const pickId = picking.resolvePickId(picked);
        if (pickId && picking.isOwnedByOtherLayer(layer.id, pickId)) return;
      }
      if (selectedId) {
        selectedId = null;
        publishSelectedCard();
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function removeClickHandler() {
    clickHandler?.destroy();
    clickHandler = null;
  }

  function clearSelection() {
    selectedId = null;
    overlayHost?.clearSource(DISASTER_OVERLAY_SOURCE_ID);
    overlayHost?.setVisible?.(DISASTER_OVERLAY_SOURCE_ID, false);
  }

  function entityFor(row) {
    const style = DISASTER_STYLES[row.kind] || DISASTER_STYLES.other;
    const color = Cesium.Color.fromCssColorString(style.color);
    const size = PIXEL_SIZE[row.alert] || 11;
    return new Cesium.Entity({
      id: `${PICK_PREFIX}${row.id}`,
      position: Cesium.Cartesian3.fromDegrees(row.lon, row.lat),
      point: {
        pixelSize: size,
        color: color.withAlpha(0.9),
        outlineColor: Cesium.Color.WHITE.withAlpha(0.85),
        outlineWidth: row.alert === 'red' ? 3 : 1.5,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        // Stay on top of nearby terrain, but let the globe hide markers on
        // its far side: an infinite distance drew the Americas through Asia.
        disableDepthTestDistance: NEAR_ON_TOP_METRES,
        scaleByDistance: new Cesium.NearFarScalar(2e5, 1.4, 2e7, 0.8),
      },
      properties: {
        kind: row.kind,
        title: row.title,
        alert: row.alert,
        source: row.source,
      },
    });
  }

  const layer = {
    id: 'disasters',
    name: 'Natural disasters',
    icon: '🌊',
    source: 'GDACS · NASA EONET',
    updateInterval: 600_000,

    init(nextViewer) {
      if (viewer) throw new Error('Natural disasters already initialized');
      viewer = nextViewer;
      dataSource = new Cesium.CustomDataSource('disasters');
      dataSource.show = false;
      viewer.dataSources.add(dataSource);
    },

    enable() {
      enabled = true;
      if (dataSource) dataSource.show = true;
      overlayHost?.setVisible?.(DISASTER_OVERLAY_SOURCE_ID, true);
      installClickHandler();
    },

    disable() {
      request?.abort();
      request = null;
      enabled = false;
      if (dataSource) dataSource.show = false;
      removeClickHandler();
      clearSelection();
    },

    async update() {
      if (!enabled || !dataSource) return false;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      try {
        const rows = await source.getSnapshot({ signal: controller.signal });
        if (controller.signal.aborted || request !== controller || !enabled)
          return false;
        rowsById.clear();
        dataSource.entities.suspendEvents();
        dataSource.entities.removeAll();
        for (const row of rows) {
          rowsById.set(row.id, row);
          dataSource.entities.add(entityFor(row));
        }
        dataSource.entities.resumeEvents();
        if (selectedId) publishSelectedCard();
        lastUpdate = Date.now();
        lastError = null;
        viewer?.scene?.requestRender?.();
        return true;
      } catch (error) {
        if (controller.signal.aborted || request !== controller || !enabled)
          return false;
        lastError = error?.message || msg('Disaster feeds unavailable');
        return false;
      } finally {
        if (request === controller) request = null;
      }
    },

    destroy(nextViewer = viewer) {
      layer.disable();
      if (dataSource) {
        nextViewer?.dataSources?.remove(dataSource, true);
        dataSource = null;
      }
      rowsById.clear();
      viewer = null;
    },

    /** Event facts for the analyst query engine. */
    getAnalystRecords(maxCount = 2000) {
      if (!dataSource?.show) return [];
      return [...rowsById.values()].slice(0, Math.max(1, maxCount));
    },

    getRowControls() {
      const counts = new Map();
      for (const row of rowsById.values())
        counts.set(row.kind, (counts.get(row.kind) || 0) + 1);
      return {
        chips: [],
        legend: DISASTER_KINDS.filter((kind) => counts.get(kind)).map(
          (kind, index) => ({
            label: t(DISASTER_STYLES[kind].label),
            color: DISASTER_STYLES[kind].color,
            count: counts.get(kind),
            ...(index === 0
              ? {
                  blurb: t(
                    'Current events from GDACS and NASA EONET. Larger markers are higher GDACS alerts.',
                  ),
                }
              : {}),
          }),
        ),
      };
    },

    getStats() {
      return { count: rowsById.size, lastUpdate, error: lastError };
    },
  };
  return layer;
}
