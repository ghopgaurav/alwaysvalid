import { alwaysValid, fixedHorizon, type Arm, type Verdict } from './stats.ts';

/**
 * The A/A simulation.
 *
 * This is the core of the project. Run two thousand experiments in which the two arms are
 * IDENTICAL, peek at each one daily, and stop the moment it turns green. Under
 * a fixed-horizon test the share that produce a "winner" is the empirical
 * false-positive rate, and it is nothing like 5%.
 *
 * It is a simulation rather than an argument because the argument has been
 * made in blog posts for fifteen years and teams still peek. A number they
 * generated themselves is harder to wave away.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Method = 'fixed-horizon' | 'always-valid';

export interface RunOutcome {
  /** Did the experiment ever declare a winner? */
  readonly stopped: boolean;
  /** At which peek, if it did. */
  readonly stoppedAtPeek: number | null;
  readonly finalEffect: number;
  readonly peeks: number;
}

export interface SimulationConfig {
  readonly experiments: number;
  /** True relative lift. 0 for an A/A test. */
  readonly trueLift: number;
  readonly baseRate: number;
  readonly usersPerDay: number;
  readonly days: number;
  /** 1 = look every day. 0 = look only at the end. */
  readonly peekDaily: boolean;
  readonly alpha: number;
  readonly seed: number;
}

export const DEFAULT_CONFIG: SimulationConfig = {
  experiments: 2_000,
  trueLift: 0,
  baseRate: 0.08,
  usersPerDay: 2_000,
  days: 21,
  peekDaily: true,
  alpha: 0.05,
  seed: 20260911,
};

function evaluate(
  method: Method, control: Arm, treatment: Arm, alpha: number,
): Verdict {
  return method === 'fixed-horizon'
    ? fixedHorizon(control, treatment, alpha)
    : alwaysValid(control, treatment, alpha);
}

export function runExperiment(
  method: Method, config: SimulationConfig, rnd: () => number,
): RunOutcome {
  const control: Arm = { n: 0, conversions: 0 };
  const treatment: Arm = { n: 0, conversions: 0 };
  const perArmPerDay = Math.floor(config.usersPerDay / 2);
  const controlRate = config.baseRate;
  const treatmentRate = config.baseRate * (1 + config.trueLift);

  let peeks = 0;
  for (let day = 1; day <= config.days; day++) {
    for (let i = 0; i < perArmPerDay; i++) {
      control.n++;
      if (rnd() < controlRate) control.conversions++;
      treatment.n++;
      if (rnd() < treatmentRate) treatment.conversions++;
    }

    const looking = config.peekDaily || day === config.days;
    if (!looking) continue;
    peeks++;

    const verdict = evaluate(method, control, treatment, config.alpha);
    if (verdict.significant) {
      return {
        stopped: true, stoppedAtPeek: peeks,
        finalEffect: verdict.effect, peeks,
      };
    }
  }

  const final = evaluate(method, control, treatment, config.alpha);
  return {
    stopped: false, stoppedAtPeek: null, finalEffect: final.effect, peeks,
  };
}

export interface SimulationResult {
  readonly method: Method;
  readonly experiments: number;
  readonly declaredWinner: number;
  readonly rate: number;
  readonly medianStopDay: number | null;
  readonly config: SimulationConfig;
}

export function simulate(
  method: Method, config: SimulationConfig = DEFAULT_CONFIG,
): SimulationResult {
  const rnd = mulberry32(config.seed);
  let declared = 0;
  const stopDays: number[] = [];

  for (let i = 0; i < config.experiments; i++) {
    const outcome = runExperiment(method, config, rnd);
    if (outcome.stopped) {
      declared++;
      if (outcome.stoppedAtPeek !== null) stopDays.push(outcome.stoppedAtPeek);
    }
  }

  stopDays.sort((a, b) => a - b);
  return {
    method,
    experiments: config.experiments,
    declaredWinner: declared,
    rate: declared / config.experiments,
    medianStopDay: stopDays.length
      ? stopDays[Math.floor(stopDays.length / 2)]! : null,
    config,
  };
}

/** False-positive rate as a function of how often you look. */
export function peekingCurve(
  method: Method, maxPeeks: number, config: SimulationConfig = DEFAULT_CONFIG,
): Array<{ peeks: number; falsePositiveRate: number }> {
  const out: Array<{ peeks: number; falsePositiveRate: number }> = [];
  for (const peeks of [1, 2, 3, 5, 7, 14, maxPeeks]) {
    if (peeks > maxPeeks) continue;
    const scoped: SimulationConfig = {
      ...config, trueLift: 0, days: peeks, peekDaily: true,
      usersPerDay: Math.floor(config.usersPerDay * config.days / peeks),
    };
    out.push({
      peeks,
      falsePositiveRate: simulate(method, scoped).rate,
    });
  }
  return out;
}
