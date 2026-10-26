import test from 'node:test';
import assert from 'node:assert/strict';
import {
  biodiversityFactor,
  forestFactor,
  normalizePrioritySnapshot,
  rankEvents,
  scoreEvent,
} from './priority.js';
import {
  inArea,
  priorityArea,
  tileFor,
} from '../../server/providers/priority.js';

test('factors are bounded and unknowns stay unknown', () => {
  assert.equal(biodiversityFactor(0), 0);
  assert.equal(biodiversityFactor(10_000), 1);
  assert.equal(biodiversityFactor(1e9), 1);
  assert.equal(biodiversityFactor(null), null);
  assert.equal(forestFactor(0.125), 0.5);
  assert.equal(forestFactor(0.9), 1);
  assert.equal(forestFactor(undefined), null);
});

test('a red alert in a deforested, species-rich place outranks a quiet one', () => {
  const hot = scoreEvent({
    alert: 'red',
    occurrenceCount: 10_000,
    forestLossShare: 0.3,
  });
  assert.equal(hot.score, 100);
  assert.equal(hot.tier, 'critical');
  const quiet = scoreEvent({
    alert: 'green',
    occurrenceCount: 0,
    forestLossShare: 0,
  });
  assert.equal(quiet.tier, 'watch');
  const ranked = rankEvents([
    { id: 'quiet', priority: quiet },
    { id: 'hot', priority: hot },
  ]);
  assert.deepEqual(
    ranked.map((event) => [event.id, event.rank]),
    [
      ['hot', 1],
      ['quiet', 2],
    ],
  );
});

test('a missing factor renormalizes the weights and marks the score partial', () => {
  const partial = scoreEvent({
    alert: 'red',
    occurrenceCount: null,
    forestLossShare: null,
  });
  assert.equal(partial.score, 100);
  assert.equal(partial.confidence, 'partial');
});

test('the priority area, tiles and payload checks are defensive', () => {
  assert.deepEqual(priorityArea('1,2,3,4'), {
    west: 1,
    south: 2,
    east: 3,
    north: 4,
  });
  assert.equal(priorityArea('3,2,1,4').west, 90);
  assert.equal(priorityArea('junk').east, 145);
  assert.ok(inArea({ lat: -2, lon: 113 }, priorityArea()));
  assert.ok(!inArea({ lat: 40, lon: -100 }, priorityArea()));
  assert.deepEqual(tileFor(0, 0, 1), { z: 1, x: 1, y: 1 });
  assert.equal(normalizePrioritySnapshot({}), null);
  assert.deepEqual(
    normalizePrioritySnapshot({
      events: [
        {
          id: 'a',
          lat: 0,
          lon: 0,
          rank: 1,
          priority: { score: 5, tier: 'watch' },
        },
        {
          id: 'b',
          lat: 0,
          lon: 0,
          rank: 2,
          priority: { score: 5, tier: 'nope' },
        },
      ],
    }).map((event) => event.id),
    ['a'],
  );
});
