import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phaseAt, Workout, warningAt } from './web/timer.mjs';

const plan = { active: 1000, rest: 1000, rounds: 10000, prep: 3000 };

test('phase boundaries hold over ten thousand one-second rounds', () => {
  for (let i = 0; i < plan.rounds; i++) {
    const start = 3000 + 2000 * i;
    assert.deepEqual(phaseAt(plan, start), { kind: 'active', round: i + 1, start, end: start + 1000 });
    assert.equal(phaseAt(plan, start + 999.99).kind, 'active');
    assert.equal(phaseAt(plan, start + 1000).kind, i === plan.rounds - 1 ? 'complete' : 'rest');
  }
});

test('preparation, zero rest, and unlimited rounds', () => {
  assert.equal(phaseAt(plan, 2999).kind, 'ready');
  const unlimited = { ...plan, prep: 0, rest: 0, rounds: Infinity };
  assert.equal(phaseAt(unlimited, 12_345_678).round, 12_346);
  assert.equal(phaseAt(unlimited, 12_345_678).end, 12_346_000);
  assert.equal(phaseAt({ ...unlimited, rounds: 1 }, 1000).kind, 'complete');
});

test('late callbacks skip to the correct phase and pausing preserves elapsed time', () => {
  let now = 25;
  const workout = new Workout(plan, () => now);
  now += 10_600;
  assert.equal(workout.snapshot().kind, 'rest');
  assert.equal(workout.snapshot().round, 4);
  assert.equal(workout.snapshot().remaining, 400);
  workout.pause();
  now += 40_000;
  assert.equal(workout.snapshot().remaining, 400);
  workout.resume();
  now += 400;
  assert.equal(workout.snapshot().kind, 'active');
  assert.equal(workout.snapshot().round, 5);
});

test('advance cues skip stale and already fired warnings', () => {
  const phase = { kind: 'active', start: 1000, end: 10_000, elapsed: 8050 };
  assert.deepEqual(warningAt(phase, 'countdown', 7600), { seconds: 2, spoken: '2' });
  assert.equal(warningAt(phase, 'countdown', 8005), null);
  assert.equal(warningAt({ ...phase, elapsed: 8500 }, 'countdown', 7600), null);
  assert.deepEqual(warningAt({ ...phase, elapsed: 5100 }, 5, 4800), { seconds: 5, spoken: null });
});
