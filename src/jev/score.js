/**
 * JEV — Justify, Evaluate, Verdict. The go / no-go engine every Horus
 * initiative passes through at each SDLC stage, from the first idea on.
 *
 *   Justify   the initiative states its costs, the social outcomes it buys,
 *             its risks and the evidence behind them.
 *   Evaluate  outcomes are discounted for confidence, attribution and
 *             deadweight (what would have happened anyway), then valued and
 *             compared with costs over the horizon: a social return on
 *             investment (SROI) ratio, a net present value and a payback.
 *   Verdict   GO, CONDITIONAL or NO-GO from the stage's thresholds, the risk
 *             register and the evidence the stage requires.
 *
 * Pure: no file system or network, so the CLI, CI gate and tests share it.
 * @module jev/score
 */

export const STAGES = Object.freeze([
  'idea',
  'discovery',
  'build',
  'release',
  'operate',
]);

export const VERDICTS = Object.freeze({
  GO: 'GO',
  CONDITIONAL: 'CONDITIONAL',
  NO_GO: 'NO-GO',
});

const clamp01 = (value) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/** Present value of a monthly amount over `months` at an annual rate. */
export function presentValueOfMonthly(amount, months, annualRate) {
  if (!Number.isFinite(amount) || amount === 0 || months <= 0) return 0;
  const monthly = (1 + annualRate) ** (1 / 12) - 1;
  if (monthly === 0) return amount * months;
  return amount * ((1 - (1 + monthly) ** -months) / monthly);
}

/**
 * Value one outcome per year after the SROI haircuts.
 * @param {object} outcome
 * @returns {number} Valued benefit per year.
 */
export function outcomeValuePerYear(outcome) {
  const quantity = Number(outcome.quantityPerYear) || 0;
  const unitValue = Number(outcome.proxyValuePerUnit) || 0;
  return (
    quantity *
    unitValue *
    clamp01(outcome.confidence) *
    clamp01(outcome.attribution) *
    (1 - clamp01(outcome.deadweight))
  );
}

/** Risk score of one register entry: likelihood × impact, each 1–5. */
export const riskScore = (risk) =>
  Math.max(1, Math.min(5, Number(risk.likelihood) || 1)) *
  Math.max(1, Math.min(5, Number(risk.impact) || 1));

/**
 * Evaluate one initiative against the JEV configuration.
 * @param {object} initiative Parsed initiative file.
 * @param {object} config Parsed jev/config.json.
 * @param {{ exists?: (ref: string) => boolean }} [options]
 *   `exists` checks that an evidence reference points at something real.
 */
export function evaluateInitiative(initiative, config, { exists } = {}) {
  const problems = [];
  const stage = initiative.stage;
  if (!STAGES.includes(stage)) problems.push(`unknown stage "${stage}"`);
  const gate = config.stages?.[stage] || {};
  const months = Number(config.horizonMonths) || 36;
  const rate = Number(config.discountRateAnnual) || 0;

  const costs = initiative.costs || {};
  const oneOff =
    (Number(costs.buildHours) || 0) * (Number(config.hourlyRateUsd) || 0) +
    (Number(costs.oneOffUsd) || 0);
  const runPerMonth =
    (Number(costs.infraUsdPerMonth) || 0) +
    (Number(costs.maintenanceHoursPerMonth) || 0) *
      (Number(config.hourlyRateUsd) || 0);
  const pvCosts = oneOff + presentValueOfMonthly(runPerMonth, months, rate);

  const outcomes = initiative.outcomes || [];
  if (!outcomes.length) problems.push('no outcomes: nothing to justify it');
  const benefitPerYear = outcomes.reduce(
    (sum, outcome) => sum + outcomeValuePerYear(outcome),
    0,
  );
  const pvBenefits = presentValueOfMonthly(benefitPerYear / 12, months, rate);
  const sroi =
    pvCosts > 0 ? pvBenefits / pvCosts : pvBenefits > 0 ? Infinity : 0;
  const netMonthly = benefitPerYear / 12 - runPerMonth;
  const paybackMonths =
    netMonthly > 0 ? Math.ceil(oneOff / netMonthly) : Infinity;

  const risks = (initiative.risks || []).map((risk) => ({
    ...risk,
    score: riskScore(risk),
  }));
  const topRisk = risks.reduce((max, risk) => Math.max(max, risk.score), 0);
  const blocking = risks.filter(
    (risk) => risk.blocking && risk.status !== 'mitigated',
  );

  const evidence = initiative.evidence || [];
  const required = gate.requiredEvidence || [];
  const missingEvidence = required.filter(
    (kind) => !evidence.some((item) => item.kind === kind),
  );
  const brokenEvidence = exists
    ? [
        ...new Set(
          evidence
            .filter((item) => item.ref && !exists(item.ref))
            .map((item) => item.ref),
        ),
      ]
    : [];

  const reasons = [];
  if (sroi < (gate.minSroiConditional ?? 1))
    reasons.push(
      `SROI ${formatRatio(sroi)} below ${gate.minSroiConditional ?? 1} for ${stage}`,
    );
  if (topRisk > (gate.maxRiskScore ?? 25))
    reasons.push(`risk ${topRisk} above ${gate.maxRiskScore} for ${stage}`);
  for (const risk of blocking)
    reasons.push(`blocking risk open: ${risk.id || risk.title}`);
  if (missingEvidence.length)
    reasons.push(`missing evidence: ${missingEvidence.join(', ')}`);
  for (const ref of brokenEvidence) reasons.push(`evidence not found: ${ref}`);
  reasons.push(...problems);

  let verdict = VERDICTS.GO;
  if (reasons.length) verdict = VERDICTS.NO_GO;
  else if (
    sroi < (gate.minSroiGo ?? 1) ||
    paybackMonths > (gate.maxPaybackMonths ?? Infinity)
  ) {
    verdict = VERDICTS.CONDITIONAL;
    if (sroi < (gate.minSroiGo ?? 1))
      reasons.push(
        `SROI ${formatRatio(sroi)} under GO bar ${gate.minSroiGo} — proceed only with the listed conditions`,
      );
    if (paybackMonths > (gate.maxPaybackMonths ?? Infinity))
      reasons.push(`payback ${paybackMonths} mo over ${gate.maxPaybackMonths}`);
  }

  return {
    id: initiative.id,
    title: initiative.title,
    stage,
    verdict,
    reasons,
    sroi,
    npvUsd: pvBenefits - pvCosts,
    pvCostsUsd: pvCosts,
    pvBenefitsUsd: pvBenefits,
    paybackMonths,
    topRisk,
    conditions: initiative.conditions || [],
  };
}

export function formatRatio(value) {
  if (value === Infinity) return '∞';
  return `${value.toFixed(2)}x`;
}
