/**
 * Frozen statistics helpers (prereg §7): Wilson CI, deterministic bootstrap,
 * means, funnel counts. Pure functions — no I/O, no randomness except the
 * seeded PRNG below (mulberry32; fixed seed 20260912 per prereg).
 */

export function mean(xs) {
  if (!xs.length) return null;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Wilson 95% CI for a binomial proportion (z = 1.959963984540054). */
export function wilson(wins, n) {
  if (n === 0) return { lo: null, hi: null, p: null };
  const z = 1.959963984540054;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { p, lo: Math.max(0, (center - spread) / denom), hi: Math.min(1, (center + spread) / denom) };
}

/** mulberry32 — small deterministic PRNG (seed fixed by prereg). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Nonparametric bootstrap percentile CI of the mean (prereg: 10k, seed 20260912). */
export function bootstrapMeanCI(xs, { iters = 10000, seed = 20260912, z = 1.959963984540054 } = {}) {
  const n = xs.length;
  if (n === 0) return { lo: null, hi: null, point: null };
  const rnd = mulberry32(seed);
  const means = new Array(iters);
  for (let b = 0; b < iters; b++) {
    let s = 0;
    for (let k = 0; k < n; k++) s += xs[(rnd() * n) | 0];
    means[b] = s / n;
  }
  means.sort((a, b) => a - b);
  const point = mean(xs);
  // normal-approximation percentile bounds are the frozen convention's intent;
  // percentile bootstrap = 2.5% / 97.5% order statistics
  const lo = means[Math.floor(0.025 * iters)];
  const hi = means[Math.ceil(0.975 * iters) - 1];
  void z;
  return { lo, hi, point };
}
