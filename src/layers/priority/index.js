/**
 * JEV priority layer: the current disasters inside the priority area,
 * ranked by hazard, nearby biodiversity and forest pressure (/api/priority).
 * Markers and card reuse the natural-disasters layer.
 */
import { msg, t } from '../../i18n/index.js';
import { createNaturalDisastersLayer } from '../disasters/index.js';
import {
  PRIORITY_TIERS,
  normalizePrioritySnapshot,
} from '../../jev/priority.js';

export const PRIORITY_OVERLAY_SOURCE_ID = 'priority';

const TIER_LABELS = Object.freeze({
  critical: msg('Critical'),
  high: msg('High'),
  watch: msg('Watch'),
});
const TIER_SIZES = Object.freeze({ critical: 20, high: 15, watch: 11 });
const tierColor = (tier) =>
  PRIORITY_TIERS.find((entry) => entry.id === tier)?.color || '#eab308';
const percent = (value) =>
  Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—';

/** The browser source: this app's ranked priority snapshot. */
export function createPrioritySource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  url = '/api/priority',
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(url, { signal });
      if (!response.ok) throw new Error(`Priority HTTP ${response.status}`);
      const rows = normalizePrioritySnapshot(await response.json());
      signal?.throwIfAborted();
      if (!rows) throw new Error('Malformed priority ranking');
      return rows;
    },
  };
}

/** Card model for one ranked event. Pure — no Cesium types. */
export function buildPriorityCard(row) {
  const { score, tier, factors, confidence } = row.priority;
  const details = [
    t('Priority {score}/100 · {tier} · rank #{rank}', {
      score,
      tier: t(TIER_LABELS[tier]),
      rank: row.rank,
    }),
    t(
      'Hazard {hazard} · biodiversity {biodiversity} · forest pressure {forest}',
      {
        hazard: percent(factors.hazard),
        biodiversity: percent(factors.biodiversity),
        forest: percent(factors.forest),
      },
    ),
  ];
  if (Number.isFinite(row.occurrenceCount))
    details.push(
      t('{count} species records within 50 km (GBIF)', {
        count: row.occurrenceCount.toLocaleString(),
      }),
    );
  if (Number.isFinite(row.forestLossShare))
    details.push(
      t('{share} of the area lost tree cover since 2001', {
        share: percent(row.forestLossShare),
      }),
    );
  if (confidence !== 'full')
    details.push(t('Partial score: a factor could not be measured'));
  details.push(t('Heuristic triage, not an official priority'));
  return {
    id: `priority-card:${row.id}`,
    selected: true,
    interactive: Boolean(row.url),
    title: `#${row.rank} ${row.title}`,
    details,
    accent: tierColor(tier),
    priority: Number.MAX_SAFE_INTEGER,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

function priorityMarker(row) {
  const { tier } = row.priority;
  return {
    color: tierColor(tier),
    size: TIER_SIZES[tier] || 11,
    outlineWidth: tier === 'critical' ? 3 : 1.5,
  };
}

function priorityLegend(rows) {
  return PRIORITY_TIERS.map((tier, index) => ({
    label: t(TIER_LABELS[tier.id]),
    color: tier.color,
    count: rows.filter((row) => row.priority.tier === tier.id).length,
    ...(index === 0
      ? {
          blurb: t(
            'Disasters ranked by hazard, nearby biodiversity and forest loss. Click a marker for the reasons.',
          ),
        }
      : {}),
  }));
}

/** The JEV priority layer, wired like the natural-disasters layer. */
export function createPriorityLayer(options = {}) {
  return createNaturalDisastersLayer({
    source: createPrioritySource(),
    id: 'priority',
    name: 'JEV priority',
    icon: '🎯',
    sourceLabel: 'JEV · GDACS · GBIF · GFC',
    updateInterval: 1_800_000,
    overlaySourceId: PRIORITY_OVERLAY_SOURCE_ID,
    pickPrefix: 'priority:',
    cardPrefix: 'priority-card:',
    markerFor: priorityMarker,
    buildCard: buildPriorityCard,
    legendFor: priorityLegend,
    ...options,
  });
}
