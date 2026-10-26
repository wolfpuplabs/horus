/**
 * JEV priority: rank current natural disasters by where a response matters
 * most for nature. A heuristic for triage, not an official priority.
 *
 *   hazard        GDACS alert level (EONET events carry none: "watch")
 *   biodiversity  recorded species occurrences (GBIF) within the radius,
 *                 log-scaled so a few hundred records already count
 *   forest        share of the surrounding area with tree-cover loss since
 *                 2001 (Global Forest Change), i.e. forests under pressure
 *
 * score = 100 × Σ weight × factor, each factor in 0–1.
 * @module jev/priority
 */

export const PRIORITY_WEIGHTS = Object.freeze({
  hazard: 0.5,
  biodiversity: 0.25,
  forest: 0.25,
});

export const PRIORITY_TIERS = Object.freeze([
  Object.freeze({ id: 'critical', min: 70, color: '#dc2626' }),
  Object.freeze({ id: 'high', min: 45, color: '#f97316' }),
  Object.freeze({ id: 'watch', min: 0, color: '#eab308' }),
]);

const HAZARD_BY_ALERT = Object.freeze({ red: 1, orange: 0.65, green: 0.35 });
/** Events without an alert level (EONET) start as a green alert. */
const HAZARD_UNRATED = 0.35;
/** Occurrence count that saturates the biodiversity factor. */
const BIODIVERSITY_SATURATION = 10_000;
/** Loss share that saturates the forest factor (a quarter of the area). */
const FOREST_SATURATION = 0.25;

const clamp01 = (value) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;

export function hazardFactor(alert) {
  return HAZARD_BY_ALERT[alert] ?? HAZARD_UNRATED;
}

/** log10(count + 1) / log10(saturation + 1); null when unknown. */
export function biodiversityFactor(count) {
  if (!Number.isFinite(count) || count < 0) return null;
  return clamp01(
    Math.log10(count + 1) / Math.log10(BIODIVERSITY_SATURATION + 1),
  );
}

/** Share of pixels with tree-cover loss, scaled to the saturation share. */
export function forestFactor(lossShare) {
  if (!Number.isFinite(lossShare) || lossShare < 0) return null;
  return clamp01(lossShare / FOREST_SATURATION);
}

export function tierFor(score) {
  return (
    PRIORITY_TIERS.find((tier) => score >= tier.min) || PRIORITY_TIERS.at(-1)
  );
}

/**
 * Score one event. A factor that could not be measured is left out and the
 * remaining weights are renormalized, so a missing feed lowers confidence
 * (reported) rather than the score itself.
 */
export function scoreEvent(
  { alert, occurrenceCount, forestLossShare },
  weights = PRIORITY_WEIGHTS,
) {
  const factors = {
    hazard: hazardFactor(alert),
    biodiversity: biodiversityFactor(occurrenceCount),
    forest: forestFactor(forestLossShare),
  };
  let weighted = 0;
  let total = 0;
  for (const [name, value] of Object.entries(factors)) {
    if (value === null) continue;
    weighted += weights[name] * value;
    total += weights[name];
  }
  const score = total > 0 ? Math.round((100 * weighted) / total) : 0;
  const measured = Object.values(factors).filter((v) => v !== null).length;
  return {
    score,
    tier: tierFor(score).id,
    factors,
    confidence: measured === 3 ? 'full' : 'partial',
  };
}

/**
 * Rank scored events, highest first; ties keep the more severe alert and
 * then the newer event.
 */
export function rankEvents(events) {
  return [...events]
    .sort(
      (a, b) =>
        b.priority.score - a.priority.score ||
        b.priority.factors.hazard - a.priority.factors.hazard ||
        (b.startMs ?? 0) - (a.startMs ?? 0),
    )
    .map((event, index) => ({ ...event, rank: index + 1 }));
}

/** Validate the server payload before the layer replaces what it shows. */
export function normalizePrioritySnapshot(payload) {
  if (!Array.isArray(payload?.events)) return null;
  const tiers = new Set(PRIORITY_TIERS.map((tier) => tier.id));
  return payload.events.filter(
    (event) =>
      typeof event?.id === 'string' &&
      Number.isFinite(event.lat) &&
      Number.isFinite(event.lon) &&
      Math.abs(event.lat) <= 90 &&
      Math.abs(event.lon) <= 180 &&
      Number.isFinite(event.priority?.score) &&
      tiers.has(event.priority?.tier) &&
      Number.isInteger(event.rank),
  );
}
