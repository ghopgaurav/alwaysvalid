import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  alwaysValid, fixedHorizon, normalCdf, normalQuantile, planFixedHorizon,
  rate, type Arm,
} from '../src/stats.ts';
import { DEFAULT_CONFIG, peekingCurve, simulate } from '../src/sim.ts';

const AA = { ...DEFAULT_CONFIG, experiments: 1_500, trueLift: 0 };

describe('THE A/A SIMULATION - the argument, made as a measurement', () => {
  test('fixed-horizon with DAILY PEEKING blows past its nominal 5%', () => {
    const result = simulate('fixed-horizon', AA);
    assert.ok(
      // The published figure for ~20 peeks is 25-30%; this simulation measures
      // ~25% at 21 daily looks. The bar is set below the measurement, not at
      // it - the claim under test is "several times the nominal rate", and a
      // threshold pinned to the observed value tests the seed, not the effect.
      result.rate > 0.20,
      `peeking daily for 21 days on identical arms declared a winner in ` +
      `${(result.rate * 100).toFixed(1)}% of experiments - if this is not ` +
      `well above 5%, the simulation is not modelling the problem`,
    );
  });

  test('always-valid inference holds its rate under the same peeking', () => {
    const result = simulate('always-valid', AA);
    assert.ok(
      result.rate <= 0.05,
      `always-valid declared a winner in ${(result.rate * 100).toFixed(1)}% ` +
      `of A/A experiments; the guarantee is <= 5% at every peek`,
    );
  });

  test('THE HEADLINE: the gap between the two is the whole point', () => {
    const fixed = simulate('fixed-horizon', AA);
    const valid = simulate('always-valid', AA);
    assert.ok(
      fixed.rate > valid.rate * 4,
      `fixed-horizon ${(fixed.rate * 100).toFixed(1)}% vs always-valid ` +
      `${(valid.rate * 100).toFixed(1)}%`,
    );
  });

  test('fixed-horizon is CORRECT when looked at exactly once', () => {
    // The method is not broken. The process around it is. Without this the
    // comparison would be unfair and the argument would not survive review.
    const once = simulate('fixed-horizon', {
      ...AA, peekDaily: false, experiments: 2_000,
    });
    assert.ok(
      once.rate < 0.09,
      `looking once gave ${(once.rate * 100).toFixed(1)}% - it should be ` +
      `near the nominal 5%`,
    );
  });

  test('the false-positive rate GROWS with the number of looks', () => {
    const curve = peekingCurve('fixed-horizon', 21, AA);
    const first = curve[0]!;
    const last = curve[curve.length - 1]!;
    assert.ok(
      last.falsePositiveRate > first.falsePositiveRate * 2,
      `1 peek: ${(first.falsePositiveRate * 100).toFixed(1)}%, ` +
      `${last.peeks} peeks: ${(last.falsePositiveRate * 100).toFixed(1)}%`,
    );
  });

  test('always-valid does NOT grow with the number of looks', () => {
    const curve = peekingCurve('always-valid', 21, AA);
    for (const point of curve) {
      assert.ok(
        point.falsePositiveRate <= 0.06,
        `${point.peeks} peeks gave ` +
        `${(point.falsePositiveRate * 100).toFixed(1)}%`,
      );
    }
  });
});

describe('THE METHOD MUST STILL HAVE POWER', () => {
  test('always-valid detects a real effect', () => {
    // Without this, "never a false positive" is satisfied by a method that
    // never reports anything at all.
    const result = simulate('always-valid', {
      ...DEFAULT_CONFIG, trueLift: 0.15, experiments: 500, days: 28,
    });
    assert.ok(
      result.rate > 0.6,
      `only detected a 15% lift in ${(result.rate * 100).toFixed(0)}% of runs`,
    );
  });

  test('it costs sample size - the honest price of peeking', () => {
    const valid = simulate('always-valid', {
      ...DEFAULT_CONFIG, trueLift: 0.15, experiments: 400, days: 28,
    });
    const fixed = simulate('fixed-horizon', {
      ...DEFAULT_CONFIG, trueLift: 0.15, experiments: 400, days: 28,
    });
    assert.ok(
      (valid.medianStopDay ?? 99) >= (fixed.medianStopDay ?? 0),
      'always-valid should take at least as long to call a real winner - ' +
      'you are paying for the option to stop whenever you like',
    );
  });

  test('a larger effect is called sooner', () => {
    const small = simulate('always-valid', {
      ...DEFAULT_CONFIG, trueLift: 0.10, experiments: 300, days: 28 });
    const large = simulate('always-valid', {
      ...DEFAULT_CONFIG, trueLift: 0.40, experiments: 300, days: 28 });
    assert.ok((large.medianStopDay ?? 99) < (small.medianStopDay ?? 99));
  });
});

describe('the intervals', () => {
  const control: Arm = { n: 10_000, conversions: 800 };
  const treatment: Arm = { n: 10_000, conversions: 880 };

  test('always-valid is WIDER than fixed-horizon at the same data', () => {
    const a = fixedHorizon(control, treatment);
    const b = alwaysValid(control, treatment);
    assert.ok(b.high - b.low > a.high - a.low,
      'the extra width is what pays for unlimited peeking');
  });

  test('both are centred on the same observed effect', () => {
    const a = fixedHorizon(control, treatment);
    const b = alwaysValid(control, treatment);
    assert.ok(Math.abs(a.effect - b.effect) < 1e-12);
    assert.ok(Math.abs(a.effect - 0.008) < 1e-9);
  });

  test('an interval is not offered before there is data', () => {
    const v = fixedHorizon({ n: 0, conversions: 0 }, { n: 0, conversions: 0 });
    assert.equal(v.significant, false);
    assert.equal(v.low, -Infinity);
  });

  test('identical arms are never significant', () => {
    const arm: Arm = { n: 50_000, conversions: 4_000 };
    assert.equal(fixedHorizon(arm, { ...arm }).significant, false);
    assert.equal(alwaysValid(arm, { ...arm }).significant, false);
  });

  test('a huge effect is significant under both', () => {
    const a: Arm = { n: 20_000, conversions: 1_000 };
    const b: Arm = { n: 20_000, conversions: 3_000 };
    assert.equal(fixedHorizon(a, b).significant, true);
    assert.equal(alwaysValid(a, b).significant, true);
  });

  test('the always-valid interval narrows as data accumulates', () => {
    const small = alwaysValid(
      { n: 1_000, conversions: 80 }, { n: 1_000, conversions: 88 });
    const large = alwaysValid(
      { n: 100_000, conversions: 8_000 }, { n: 100_000, conversions: 8_800 });
    assert.ok(large.high - large.low < small.high - small.low);
  });
});

describe('planning', () => {
  test('a smaller detectable effect needs a bigger sample', () => {
    const coarse = planFixedHorizon(0.08, 0.10, 2_000);
    const fine = planFixedHorizon(0.08, 0.02, 2_000);
    assert.ok(fine.perArm > coarse.perArm * 5);
  });

  test('the plan states the days as well as the users', () => {
    const plan = planFixedHorizon(0.08, 0.05, 2_000);
    assert.ok(plan.days > 0);
    assert.equal(plan.totalUsers, plan.perArm * 2);
  });
});

describe('numerics', () => {
  test('the normal CDF is accurate at known points', () => {
    assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-9);
    assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-3);
    assert.ok(Math.abs(normalCdf(-1.96) - 0.025) < 1e-3);
  });

  test('the quantile function inverts it', () => {
    for (const p of [0.025, 0.1, 0.5, 0.9, 0.975]) {
      assert.ok(Math.abs(normalCdf(normalQuantile(p)) - p) < 2e-3, `p=${p}`);
    }
  });

  test('rate handles an empty arm', () => {
    assert.equal(rate({ n: 0, conversions: 0 }), 0);
  });
});
