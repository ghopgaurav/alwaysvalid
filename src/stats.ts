/**
 * Fixed-horizon and always-valid inference, side by side.
 *
 * Everyone looks at the experiment dashboard every day and stops when it turns
 * green. Under a fixed-horizon test that is not a minor procedural lapse - it
 * inflates the false-positive rate from 5% to roughly 25% over three weeks of
 * daily looks (see src/demo.ts), because each
 * additional look is another chance for noise to cross the line and the test
 * only ever gets stopped when it does.
 *
 * Always-valid inference (a confidence sequence built on the mixture
 * sequential probability ratio test) is valid at EVERY peek by construction.
 * The interval is wider early on, which is the honest price: you are being
 * charged for the option to stop whenever you like.
 *
 * The module ships both, because the argument is not "use mSPRT" - it is
 * "here is what your current process actually does", and that needs the
 * comparison to be runnable.
 */

// --- normal distribution helpers -------------------------------------------

export function normalCdf(z: number): number {
  // Abramowitz & Stegun 7.1.26 applied to erf.
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

export function normalQuantile(p: number): number {
  // Acklam's inverse normal approximation.
  const a = [-3.969683028665376e+01, 2.209460984245205e+02,
             -2.759285104469687e+02, 1.383577518672690e+02,
             -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02,
             -1.556989798598866e+02, 6.680131188771972e+01,
             -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01,
             -2.400758277161838e+00, -2.549732539343734e+00,
             4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01,
             2.445134137142996e+00, 3.754408661907416e+00];
  const pLow = 0.02425;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q
      + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - pLow) return -normalQuantile(1 - p);

  const q = p - 0.5;
  const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r
    + a[5]!) * q / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r
    + b[4]!) * r + 1);
}

// --- experiment state ------------------------------------------------------

export interface Arm {
  n: number;
  conversions: number;
}

export function rate(arm: Arm): number {
  return arm.n > 0 ? arm.conversions / arm.n : 0;
}

export interface Verdict {
  readonly effect: number;
  readonly low: number;
  readonly high: number;
  readonly significant: boolean;
  readonly method: 'fixed-horizon' | 'always-valid';
}

/**
 * Fixed-horizon two-proportion z-interval.
 *
 * Correct if you look exactly once, at a sample size fixed in advance. That is
 * not what anybody does.
 */
export function fixedHorizon(
  control: Arm, treatment: Arm, alpha = 0.05,
): Verdict {
  const p1 = rate(control);
  const p2 = rate(treatment);
  const effect = p2 - p1;

  if (control.n < 2 || treatment.n < 2) {
    return { effect, low: -Infinity, high: Infinity, significant: false,
      method: 'fixed-horizon' };
  }
  const se = Math.sqrt(
    (p1 * (1 - p1)) / control.n + (p2 * (1 - p2)) / treatment.n);
  const z = normalQuantile(1 - alpha / 2);
  const half = z * se;
  return {
    effect, low: effect - half, high: effect + half,
    significant: se > 0 && Math.abs(effect) > half,
    method: 'fixed-horizon',
  };
}

//: Default mixture variance.
//:
//: Of the order of the variance of the effect estimate at the sample size
//: where you expect to stop - here ~1.5e-5, which is two arms of 10,000 users
//: at an 8% base rate. Too large and the radius shrinks only slowly; too small
//: and the test is tuned narrowly to one effect size.
//:
//: It must be fixed BEFORE the experiment. Tuning it after seeing the data
//: reintroduces exactly the problem this module exists to solve, just one
//: level up.
export const DEFAULT_TAU = 1.5e-5;

/**
 * Always-valid confidence sequence (mSPRT with a normal mixture).
 *
 * The width carries an extra log term that grows with the sample size, which
 * is exactly what pays for unlimited peeking: the boundary widens just fast
 * enough that the probability of EVER crossing it under the null stays at
 * alpha, rather than the probability of crossing it at one prearranged moment.
 */
export function alwaysValid(
  control: Arm, treatment: Arm, alpha = 0.05, tau = DEFAULT_TAU,
): Verdict {
  const p1 = rate(control);
  const p2 = rate(treatment);
  const effect = p2 - p1;

  if (control.n < 2 || treatment.n < 2) {
    return { effect, low: -Infinity, high: Infinity, significant: false,
      method: 'always-valid' };
  }

  const variance = (p1 * (1 - p1)) / control.n + (p2 * (1 - p2)) / treatment.n;
  if (variance <= 0) {
    return { effect, low: -Infinity, high: Infinity, significant: false,
      method: 'always-valid' };
  }

  // Radius of the confidence sequence.
  //
  //   r^2 = V * ((V + tau) / tau) * log((V + tau) / (alpha^2 * V))
  //
  // where V is the variance of the estimated effect and `tau` is the mixture
  // variance. The middle factor is (V + tau)/tau, NOT (V + tau)/V - and using
  // the latter is a silent disaster: the radius then stops shrinking as data
  // accumulates, so the test has essentially no power and simply never calls
  // a winner. It passes every "no false positives" check perfectly.
  const ratio = (variance + tau) / variance;
  const scale = (variance + tau) / tau;
  const half = Math.sqrt(
    variance * scale * Math.log(ratio / (alpha * alpha)));

  return {
    effect, low: effect - half, high: effect + half,
    significant: Math.abs(effect) > half,
    method: 'always-valid',
  };
}

// --- planning --------------------------------------------------------------

export interface Plan {
  readonly perArm: number;
  readonly totalUsers: number;
  readonly days: number;
  readonly mde: number;
}

/** Sample size for a fixed-horizon test at the given power. */
export function planFixedHorizon(
  baseRate: number, mde: number, dailyUsers: number,
  alpha = 0.05, power = 0.8,
): Plan {
  const zAlpha = normalQuantile(1 - alpha / 2);
  const zBeta = normalQuantile(power);
  const p1 = baseRate;
  const p2 = baseRate * (1 + mde);
  const pBar = (p1 + p2) / 2;
  const numerator = (zAlpha * Math.sqrt(2 * pBar * (1 - pBar))
    + zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2;
  const perArm = Math.ceil(numerator / ((p2 - p1) ** 2));
  const total = perArm * 2;
  return { perArm, totalUsers: total, days: Math.ceil(total / dailyUsers), mde };
}
