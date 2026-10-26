import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VERDICTS,
  evaluateInitiative,
  outcomeValuePerYear,
  presentValueOfMonthly,
} from './score.js';

const config = {
  horizonMonths: 12,
  discountRateAnnual: 0,
  hourlyRateUsd: 10,
  stages: {
    build: {
      minSroiConditional: 1,
      minSroiGo: 2,
      maxRiskScore: 12,
      requiredEvidence: ['prd'],
    },
  },
};

const initiative = (overrides = {}) => ({
  id: 'x',
  title: 'X',
  stage: 'build',
  costs: { buildHours: 100 },
  outcomes: [
    {
      quantityPerYear: 100,
      proxyValuePerUnit: 30,
      confidence: 1,
      attribution: 1,
      deadweight: 0,
    },
  ],
  evidence: [{ kind: 'prd', ref: 'docs/PRD.md' }],
  ...overrides,
});

test('outcomes are haircut for confidence, attribution and deadweight', () => {
  assert.equal(
    outcomeValuePerYear({
      quantityPerYear: 100,
      proxyValuePerUnit: 10,
      confidence: 0.5,
      attribution: 0.5,
      deadweight: 0.2,
    }),
    200,
  );
  assert.equal(presentValueOfMonthly(10, 12, 0), 120);
  assert.ok(presentValueOfMonthly(10, 12, 0.1) < 120);
});

test('ROI decides GO, CONDITIONAL and NO-GO at a stage', () => {
  const go = evaluateInitiative(initiative(), config);
  assert.equal(go.verdict, VERDICTS.GO);
  assert.equal(go.sroi, 3);
  const conditional = evaluateInitiative(
    initiative({ costs: { buildHours: 200 } }),
    config,
  );
  assert.equal(conditional.verdict, VERDICTS.CONDITIONAL);
  const noGo = evaluateInitiative(
    initiative({ costs: { buildHours: 400 } }),
    config,
  );
  assert.equal(noGo.verdict, VERDICTS.NO_GO);
  assert.match(noGo.reasons[0], /SROI 0\.75x below 1/);
});

test('blocking risks, missing and broken evidence each force NO-GO', () => {
  const blocked = evaluateInitiative(
    initiative({
      risks: [{ id: 'licence', likelihood: 2, impact: 2, blocking: true }],
    }),
    config,
  );
  assert.equal(blocked.verdict, VERDICTS.NO_GO);
  const mitigated = evaluateInitiative(
    initiative({
      risks: [
        {
          id: 'licence',
          likelihood: 2,
          impact: 2,
          blocking: true,
          status: 'mitigated',
        },
      ],
    }),
    config,
  );
  assert.equal(mitigated.verdict, VERDICTS.GO);
  assert.equal(
    evaluateInitiative(initiative({ evidence: [] }), config).verdict,
    VERDICTS.NO_GO,
  );
  const broken = evaluateInitiative(initiative(), config, {
    exists: () => false,
  });
  assert.deepEqual(broken.reasons, ['evidence not found: docs/PRD.md']);
});
