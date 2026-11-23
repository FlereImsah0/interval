export const maxRoundSeconds = 24 * 60 * 60;

export function secondsFromDuration(hours, minutes, seconds) {
  return (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60 + (Number(seconds) || 0);
}

export function durationParts(seconds) {
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
}

export function limitIntervalSeconds(seconds, otherSeconds) {
  const budget = maxRoundSeconds - Math.max(0, otherSeconds);
  return Math.max(0, Math.min(seconds, budget));
}

export function phaseAt(plan, elapsed) {
  const { active, rest, rounds, prep } = plan;
  if (elapsed < prep) {
    return { kind: 'ready', round: 1, start: 0, end: prep };
  }
  const total = prep + rounds * active + (rounds - 1) * rest;
  if (rounds !== Infinity && elapsed >= total) {
    return { kind: 'complete', round: rounds, start: total, end: total };
  }
  const cycle = active + rest;
  const index = Math.floor((elapsed - prep) / cycle);
  const start = prep + index * cycle;
  if (elapsed < start + active) {
    return { kind: 'active', round: index + 1, start, end: start + active };
  }
  return { kind: 'rest', round: index + 1, start: start + active, end: start + cycle };
}

export class Workout {
  constructor(plan, clock = () => performance.now()) {
    this.plan = plan;
    this.clock = clock;
    this.origin = clock();
    this.pausedAt = null;
  }

  pause() {
    if (this.pausedAt === null) this.pausedAt = this.clock();
  }

  resume() {
    if (this.pausedAt === null) return;
    this.origin += this.clock() - this.pausedAt;
    this.pausedAt = null;
  }

  snapshot() {
    const elapsed = (this.pausedAt ?? this.clock()) - this.origin;
    const phase = phaseAt(this.plan, elapsed);
    return { ...phase, elapsed, remaining: Math.max(0, phase.end - elapsed), paused: this.pausedAt !== null };
  }
}

export function warningAt(phase, warning, previous) {
  if (phase.kind === 'complete' || phase.paused) return null;
  const offsets = warning === 'countdown' ? [1, 2, 3] : [Number(warning)];
  for (const seconds of offsets) {
    if (!seconds) continue;
    const threshold = phase.end - seconds * 1000;
    if (threshold > phase.start && previous < threshold && phase.elapsed >= threshold && phase.elapsed - threshold <= 300) {
      return { seconds, spoken: warning === 'countdown' ? String(seconds) : null };
    }
  }
  return null;
}
