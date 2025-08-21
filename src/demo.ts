/**
 * The headline demo: what daily peeking actually costs, measured.
 * Run: `npm run demo`
 */
import {
  DEFAULT_TAU, alwaysValid, fixedHorizon, planFixedHorizon,
} from './stats.ts';
import { DEFAULT_CONFIG, peekingCurve, simulate } from './sim.ts';

const AA = { ...DEFAULT_CONFIG, experiments: 2_000, trueLift: 0 };

console.log('\n  ALWAYSVALID - the A/A test that ends the peeking argument');
console.log('  ' + '='.repeat(74));
console.log(`  ${AA.experiments.toLocaleString('en-US')} simulated experiments. ` +
            `Both arms convert at ${(AA.baseRate * 100).toFixed(0)}%.`);
console.log(`  ${AA.usersPerDay.toLocaleString('en-US')} users/day for ${AA.days} ` +
            `days. There is NO real effect in any of them.\n`);

// --- the headline ----------------------------------------------------------
const fixedPeeking = simulate('fixed-horizon', AA);
const validPeeking = simulate('always-valid', AA);
const fixedOnce = simulate('fixed-horizon', { ...AA, peekDaily: false });

console.log('  HOW OFTEN A "WINNER" IS DECLARED WHEN THERE IS NO WINNER');
console.log('  ' + '-'.repeat(74));
console.log(`  ${'method'.padEnd(24)}${'process'.padEnd(28)}false-positive rate`);
console.log(`  ${'fixed-horizon z-test'.padEnd(24)}` +
            `${'looked at once, at the end'.padEnd(28)}` +
            `${(fixedOnce.rate * 100).toFixed(1)}%`);
console.log(`  ${'fixed-horizon z-test'.padEnd(24)}` +
            `${'peeked at daily'.padEnd(28)}` +
            `${(fixedPeeking.rate * 100).toFixed(1)}%   <- what teams do`);
console.log(`  ${'always-valid (mSPRT)'.padEnd(24)}` +
            `${'peeked at daily'.padEnd(28)}` +
            `${(validPeeking.rate * 100).toFixed(1)}%`);
console.log('\n    The z-test is not broken. Looking at it every day is. Same');
console.log('    test, same data, same nominal 5% - and one in four of these');
console.log('    experiments would have shipped a change that does nothing.\n');

// --- the curve -------------------------------------------------------------
console.log('  IT GETS WORSE WITH EVERY LOOK');
console.log('  ' + '-'.repeat(74));
const fixedCurve = peekingCurve('fixed-horizon', 21, AA);
const validCurve = peekingCurve('always-valid', 21, AA);
console.log(`  ${'looks'.padEnd(10)}${'fixed-horizon'.padEnd(18)}always-valid`);
fixedCurve.forEach((point, i) => {
  const bar = '#'.repeat(Math.round(point.falsePositiveRate * 100));
  console.log(`  ${String(point.peeks).padEnd(10)}` +
              `${(point.falsePositiveRate * 100).toFixed(1).padStart(5)}%  ` +
              `${bar.padEnd(26)}` +
              `${(validCurve[i]!.falsePositiveRate * 100).toFixed(1).padStart(5)}%`);
});
console.log('\n    The total sample is held constant down the column - only the');
console.log('    number of looks changes. Nothing about the data got worse.\n');

// --- the price -------------------------------------------------------------
const liftConfig = { ...DEFAULT_CONFIG, trueLift: 0.15, experiments: 600,
  days: 28 };
const validLift = simulate('always-valid', liftConfig);
const fixedLift = simulate('fixed-horizon', liftConfig);

console.log('  THE PRICE, STATED HONESTLY');
console.log('  ' + '-'.repeat(74));
console.log(`  With a REAL 15% lift present:`);
console.log(`  ${'method'.padEnd(26)}${'detected'.padEnd(14)}median day called`);
console.log(`  ${'fixed-horizon (peeking)'.padEnd(26)}` +
            `${(fixedLift.rate * 100).toFixed(0) + '%'} `.padEnd(14) +
            `${fixedLift.medianStopDay ?? '-'}`);
console.log(`  ${'always-valid'.padEnd(26)}` +
            `${(validLift.rate * 100).toFixed(0) + '%'} `.padEnd(14) +
            `${validLift.medianStopDay ?? '-'}`);
console.log('\n    Always-valid is slower. That is the trade, not a defect: the');
console.log('    peeking z-test looks faster only because a share of those');
console.log('    early calls are the false positives measured above.\n');

// --- the intervals ---------------------------------------------------------
console.log('  THE INTERVAL AT A FIXED SNAPSHOT');
console.log('  ' + '-'.repeat(74));
console.log(`  ${'per arm'.padEnd(12)}${'observed'.padEnd(12)}` +
            `${'fixed-horizon +/-'.padEnd(20)}always-valid +/-`);
for (const n of [2_000, 10_000, 50_000, 250_000]) {
  const c = { n, conversions: Math.round(n * 0.08) };
  const t = { n, conversions: Math.round(n * 0.088) };
  const f = fixedHorizon(c, t);
  const a = alwaysValid(c, t);
  console.log(`  ${n.toLocaleString('en-US').padEnd(12)}` +
              `${a.effect.toFixed(4).padEnd(12)}` +
              `${((f.high - f.low) / 2).toFixed(4).padEnd(20)}` +
              `${((a.high - a.low) / 2).toFixed(4)}` +
              `${a.significant && !f.significant ? '  (AV calls it)' : ''}`);
}
console.log(`\n    Both shrink. The always-valid interval is uniformly wider -`);
console.log(`    that width is the peeking option, priced. tau = ${DEFAULT_TAU}`);
console.log('    sets where it is cheapest, and must be chosen in advance.\n');

// --- planning --------------------------------------------------------------
console.log('  WHAT TO TELL THE PERSON ASKING FOR THE TEST');
console.log('  ' + '-'.repeat(74));
console.log(`  ${'detectable lift'.padEnd(20)}${'users needed'.padEnd(18)}days`);
for (const mde of [0.02, 0.05, 0.10, 0.20]) {
  const plan = planFixedHorizon(AA.baseRate, mde, AA.usersPerDay);
  console.log(`  ${((mde * 100).toFixed(0) + '%').padEnd(20)}` +
              `${plan.totalUsers.toLocaleString('en-US').padEnd(18)}${plan.days}`);
}
console.log('\n    A 2% lift takes most of a year at this traffic. The useful');
console.log('    answer to "can we test this?" is usually no, and saying so');
console.log('    early is worth more than any amount of sequential machinery.\n');
