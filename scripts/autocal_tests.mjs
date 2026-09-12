/**
 * AUTOCAL SIGNAL — test suite (prereg §8.2). ALL must PASS before the single
 * frozen run. Covers: OB/FVG construction fixtures, placement precedence,
 * pending fill/void/expiry semantics, fill-bar resolution, engine integration,
 * cost math, geometric invariants, and the no-lookahead contract
 * (15m truncation + future-mutation, 1h close-boundary causality with
 * positive/negative controls, execution-series causality).
 *
 * The pure `resolvePendingOrder` is the independent oracle for the engine's
 * interleaved lifecycle: test T5.8 requires both to agree on the same order.
 */
import assert from 'node:assert/strict';
import {
  buildObFromBreak, buildFvgFromBreak, resolvePendingOrder, costR,
  AutocalPairEngine, lastClosedH1Index,
  MS_5M, MS_15M, MS_1H, OB_BUFFER, TP_R, MAX_PENDING_HOURS,
} from '../src/strategy/autocalSignal.mjs';
import { resolveTripleBarrier } from '../backtest/tripleBarrier.mjs';
import { buildStructure, EVENT_NAME } from '../src/strategy/marketStructure.mjs';
import { wilson, bootstrapMeanCI, mulberry32 } from '../backtest/stats.mjs';

let passed = 0, failed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}\n      ${(e.stack || '').split('\n').slice(1, 4).join('\n      ')}`); }
}
const C = (t, o, h, l, c) => ({ t, o, h, l, c });
const t2i = (cs) => new Map(cs.map((c, i) => [c.t, i]));

// ── fixtures ────────────────────────────────────────────────────────────────
/*
 * makeBull15(): 60 15m bars, exactly ONE break event — CHoCH_BULL at bar 49.
 *   bar 10  swing-high pivot (high 99.0; max of highs[5..15]) -> confirmed t=15
 *   bar 45  trough (low 93.50; min of lows[10..49])
 *   bar 44  red OB candle [93.60, 94.30] (first red scanning 45 -> 10)
 *   bars 47/48/49  bullish FVG: low[49]=94.50 > high[47]=94.00
 *   bar 49  break bar: close 100.20 > 99.0; bias needed UP at closeT=12.5h
 * Verified invariants: no sh before t=15; no sl until t=50; closes stay
 * < 99.0 on bars 15..48 and > all confirmed swing lows.
 */
function makeBull15() {
  const cs = new Array(60);
  const T = (i) => i * MS_15M;
  for (let i = 0; i <= 9; i++) {
    cs[i] = C(T(i), 98.8 - i * 0.05, 98.9 - i * 0.02, 98.5 - i * 0.1, 98.6 - i * 0.08);
  }
  cs[10] = C(T(10), 98.5, 99.0, 98.4, 98.6);                    // swing-high pivot
  for (let i = 11; i <= 19; i++) {
    const d = (i - 10) * 0.35;
    cs[i] = C(T(i), 98.4 - d, 98.5 - d, 98.0 - d, 98.2 - d);
  }
  for (let i = 20; i <= 43; i++) {
    const x = 94.7 - (i - 20) * 0.03;
    cs[i] = C(T(i), x, x + 0.15, x - 0.15, x - 0.05);
  }
  cs[44] = C(T(44), 94.20, 94.30, 93.60, 93.80);                // red OB candle
  cs[45] = C(T(45), 93.55, 93.80, 93.50, 93.75);                // trough (green)
  cs[46] = C(T(46), 93.75, 93.95, 93.70, 93.90);
  cs[47] = C(T(47), 93.90, 94.00, 93.80, 93.95);                // FVG c1 (high 94.00)
  cs[48] = C(T(48), 94.60, 94.80, 94.40, 94.70);                // FVG c2
  cs[49] = C(T(49), 94.90, 100.50, 94.50, 100.20);              // break bar, FVG c3
  for (let i = 50; i <= 59; i++) {
    const y = 99.9 - (i - 50) * 0.45;
    cs[i] = C(T(i), y, y + 0.2, y - 0.35, y - 0.1);
  }
  return cs;
}

/*
 * makeBullShort(): 56 15m bars, one break event (CHoCH_BULL) at bar 49 with a
 * SHORT impulse leg [42..49]: NO opposite-colored candle in the leg -> NO_OB,
 * while the (47,48,49) window carries a bullish FVG. Bars 31-41 rise strictly
 * (no flat runs: equal-extreme runs mint tied pivots — a trap verified the
 * hard way), bar 42 is the broken swing-high pivot (95.0, GREEN), bars 43-48
 * stay strictly below 95.0, bar 49 closes 95.6 > 95.0.
 */
function makeBullShort() {
  const cs = new Array(56);
  const T = (i) => i * MS_15M;
  for (let i = 0; i <= 9; i++) cs[i] = C(T(i), 95.0, 95.1 - i * 0.01, 94.7 - i * 0.02, 94.9 - i * 0.01);
  cs[5] = C(T(5), 94.9, 95.2, 94.7, 95.0);                      // swing-high pivot #1 (95.2)
  for (let i = 10; i <= 30; i++) {
    const d = (i - 10) * 0.04;
    cs[i] = C(T(i), 94.8 - d, 94.9 - d, 94.6 - d, 94.7 - d);
  }
  cs[30] = C(T(30), 94.0, 94.1, 93.95, 94.05);
  for (let i = 31; i <= 41; i++) {                              // strict rise, no pivots
    const r = (i - 31) * 0.04;
    cs[i] = C(T(i), 94.0 + r, 94.1 + r, 93.95 + r, 94.05 + r);
  }
  cs[42] = C(T(42), 94.4, 95.0, 94.35, 94.6);                   // swing-high pivot #2 (95.0), GREEN
  for (let i = 43; i <= 46; i++) {
    const r = (i - 42) * 0.06;
    cs[i] = C(T(i), 94.6 + r, 94.7 + r, 94.5 + r, 94.65 + r);   // rally, green, h < 95.0
  }
  cs[47] = C(T(47), 94.9, 94.98, 94.85, 94.92);                 // FVG c1 (high 94.98)
  cs[48] = C(T(48), 94.96, 94.99, 94.9, 94.97);                 // FVG c2 (h < 95.0: pivot survives)
  cs[49] = C(T(49), 95.1, 95.8, 95.1, 95.6);                    // break bar, FVG c3 (low 95.1)
  for (let i = 50; i <= 55; i++) {
    const y = 95.55 - (i - 50) * 0.03;
    cs[i] = C(T(i), y, y + 0.15, y - 0.15, y);
  }
  return cs;
}

/** 1h fixture: bias UP from hour 12 (pivot@5 window [0..10], break at bar 11). */
function makeH1Up(n = 26) {
  const cs = [];
  for (let i = 0; i <= 4; i++) cs.push(C(i * MS_1H, 99.5 + i * 0.2, 99.8 + i * 0.2, 99.2 + i * 0.2, 99.6 + i * 0.2));
  cs.push(C(5 * MS_1H, 100.4, 101.2, 100.2, 100.9));            // bar 5: swing high 101.2
  for (let i = 6; i <= 10; i++) cs.push(C(i * MS_1H, 100.4 - (i - 5) * 0.7, 100.6 - (i - 5) * 0.7, 100.0 - (i - 5) * 0.8, 100.2 - (i - 5) * 0.7));
  cs.push(C(11 * MS_1H, 97.5, 102.3, 97.2, 102.0));             // bar 11: close 102 > 101.2 -> CHoCH_BULL
  for (let i = 12; i < n; i++) {
    const b = 102.0 + (i - 11) * 0.1;
    cs.push(C(i * MS_1H, b - 0.1, b + 0.2, b - 0.3, b));
  }
  return cs;
}

/** 1h fixture: bias DOWN from hour 12 (pivot@5 window [0..10], break at bar 11). */
function makeH1Down(n = 26) {
  const cs = [];
  for (let i = 0; i <= 4; i++) cs.push(C(i * MS_1H, 100.5 - i * 0.2, 100.8 - i * 0.2, 100.2 - i * 0.2, 100.4 - i * 0.2));
  cs.push(C(5 * MS_1H, 99.6, 99.8, 98.8, 99.1));                // bar 5: swing low 98.8
  for (let i = 6; i <= 10; i++) cs.push(C(i * MS_1H, 99.6 + (i - 5) * 0.7, 100.0 + (i - 5) * 0.7, 99.4 + (i - 5) * 0.5, 99.8 + (i - 5) * 0.7));
  cs.push(C(11 * MS_1H, 99.05, 99.1, 97.7, 98.0));              // bar 11: close 98.0 < 98.8 -> CHoCH_BEAR
  for (let i = 12; i < n; i++) {
    const b = 98.0 - (i - 11) * 0.1;
    cs.push(C(i * MS_1H, b + 0.1, b + 0.3, b - 0.2, b));
  }
  return cs;
}

/** Exec series for the bull fixtures: pre-T0 noise, then a fill/no-fill bar, then drift. */
function execFor({ boundary, slLevel, fill = 'boundary', driftBars = 40, t0 = 50 * MS_15M }) {
  const exec = [];
  for (let t = 0; t < t0; t += MS_5M) exec.push(C(t, boundary + 6.5, boundary + 6.7, boundary + 6.4, boundary + 6.6));
  if (fill === 'boundary') exec.push(C(t0, boundary + 0.3, boundary + 0.4, boundary - 0.05, boundary + 0.1));
  else if (fill === 'open') exec.push(C(t0, boundary - 0.3, boundary - 0.2, boundary - 0.4, boundary - 0.25));
  else exec.push(C(t0, boundary + 0.3, boundary + 0.4, boundary + 0.1, boundary + 0.35)); // no fill
  for (let k = 1; k <= driftBars; k++) {
    const p = boundary + 0.45 + Math.sin(k) * 0.1;              // stays above boundary, below TP
    exec.push(C(t0 + k * MS_5M, p, p + 0.12, p - 0.12, p + 0.02));
  }
  return exec;
}

function runEngine({ c15, c1h, exec, msExec = MS_5M, warmupEndT = 1 }) {
  const eng = new AutocalPairEngine({ pair: 'EURUSD', c15, c1h, exec, msExec, warmupEndT });
  const rows = [];
  for (let i = 0; i < c15.length; i++) rows.push(...eng.step(i));
  rows.push(...eng.finish());
  return rows;
}

// ══════════════════════════════ T1: zone construction ══════════════════════

ok('T1.1 OB bull: trough-anchored scan finds first red candle, SL = low - 0.1xrange', () => {
  const cs = makeBull15();
  const z = buildObFromBreak(cs, 49, 'CHoCH_BULL', cs[10].t, t2i(cs));
  assert.ok(z, 'zone expected');
  assert.equal(z.type, 'OB');
  assert.equal(z.dir, 'BULL');
  assert.equal(z.zoneLow, 93.60);
  assert.equal(z.zoneHigh, 94.30);
  assert.ok(Math.abs(z.slLevel - (93.60 - OB_BUFFER * 0.7)) < 1e-12);
  assert.equal(z.breakIdx, 49);
  assert.equal(z.srcIdx, 44);
});

ok('T1.2 OB bear: crest-anchored scan mirror', () => {
  // proper vertical mirror: h <-> -l, l <-> -h (a valid upside-down market)
  const cs = makeBull15().map((c) => C(c.t, -c.o, -c.l, -c.h, -c.c));
  const z = buildObFromBreak(cs, 49, 'CHoCH_BEAR', cs[10].t, t2i(cs));
  assert.ok(z, 'zone expected');
  assert.equal(z.dir, 'BEAR');
  assert.equal(z.zoneLow, -94.30);
  assert.equal(z.zoneHigh, -93.60);
  assert.ok(Math.abs(z.slLevel - (-93.60 + OB_BUFFER * 0.7)) < 1e-12);
});

ok('T1.3 OB: BOTH -> null; missing anchor -> null; anchor ahead of break -> null', () => {
  const cs = makeBull15();
  assert.equal(buildObFromBreak(cs, 49, 'BOTH', cs[10].t, t2i(cs)), null);
  assert.equal(buildObFromBreak(cs, 49, 'CHoCH_BULL', NaN, t2i(cs)), null);
  assert.equal(buildObFromBreak(cs, 3, 'CHoCH_BULL', cs[10].t, t2i(cs)), null);
});

ok('T1.4 OB: all-green leg -> NO_OB (null)', () => {
  const cs = makeBull15();
  for (let i = 10; i <= 45; i++) cs[i] = C(cs[i].t, cs[i].o, cs[i].h + 0.05, cs[i].l - 0.05, cs[i].o + 0.1);
  assert.equal(buildObFromBreak(cs, 49, 'CHoCH_BULL', cs[10].t, t2i(cs)), null);
});

ok('T1.5 FVG bull: backward scan finds the (47,48,49) imbalance', () => {
  const cs = makeBull15();
  const z = buildFvgFromBreak(cs, 49, 'CHoCH_BULL', cs[10].t, t2i(cs));
  assert.ok(z, 'FVG expected');
  assert.equal(z.type, 'FVG');
  assert.equal(z.dir, 'BULL');
  assert.equal(z.zoneLow, 94.00);
  assert.equal(z.zoneHigh, 94.50);
  assert.ok(Math.abs(z.slLevel - (94.00 - OB_BUFFER * 0.5)) < 1e-12);
  assert.equal(z.srcIdx, 47);
});

ok('T1.6 FVG: two imbalances -> the most-recent window wins', () => {
  const cs = makeBull15();
  cs[30] = C(cs[30].t, 94.5, 94.55, 94.4, 94.45);               // older imbalance (30..32)
  cs[31] = C(cs[31].t, 94.6, 95.0, 94.58, 94.9);
  cs[32] = C(cs[32].t, 95.0, 95.1, 94.80, 94.95);
  const z = buildFvgFromBreak(cs, 49, 'CHoCH_BULL', cs[10].t, t2i(cs));
  assert.ok(z);
  assert.equal(z.srcIdx, 47, 'most-recent window must win');
});

ok('T1.7 FVG: BOTH -> null; anchor ahead -> null; no imbalance anywhere in the leg -> null', () => {
  const cs = makeBull15();
  assert.equal(buildFvgFromBreak(cs, 49, 'BOTH', cs[10].t, t2i(cs)), null);
  assert.equal(buildFvgFromBreak(cs, 2, 'CHoCH_BULL', cs[10].t, t2i(cs)), null);
  // kill EVERY imbalance in the leg: bar 48's low below high[46] AND bar 49's
  // low below high[47] — the backward scan would otherwise find the older window
  const cs2 = makeBull15();
  cs2[48] = C(cs2[48].t, 93.90, 93.92, 93.85, 93.91);
  cs2[49] = C(cs2[49].t, 94.20, 100.50, 93.95, 100.20);
  assert.equal(buildFvgFromBreak(cs2, 49, 'CHoCH_BULL', cs2[10].t, t2i(cs2)), null);
});

ok('T1.8 FVG bear mirror', () => {
  const cs = makeBull15().map((c) => C(c.t, -c.o, -c.l, -c.h, -c.c));
  const z = buildFvgFromBreak(cs, 49, 'CHoCH_BEAR', cs[10].t, t2i(cs));
  assert.ok(z);
  assert.equal(z.dir, 'BEAR');
  assert.equal(z.zoneLow, -94.50);
  assert.equal(z.zoneHigh, -94.00);
  assert.ok(Math.abs(z.slLevel - (-94.00 + OB_BUFFER * 0.5)) < 1e-12);
});

ok('T1.9 event wiring: the full fixture fires exactly one CHoCH_BULL at bar 49', () => {
  for (const [name, cs] of [['bull15', makeBull15()], ['bullShort', makeBullShort()]]) {
    const s = buildStructure(cs, 5);
    const events = [];
    for (let i = 0; i < cs.length; i++) if (s.eventAt[i] !== 0) events.push([i, EVENT_NAME[s.eventAt[i]]]);
    assert.equal(events.length, 1, `${name}: exactly one event`);
    assert.equal(events[0][0], 49, `${name}: event at bar 49`);
    assert.match(events[0][1], /BULL$/, `${name}: bull event`);
  }
});

// ════════════════════ T2: pending order semantics (pure oracle) ════════════

const BO = 100.0, SL = 99.0, T0 = 10 * MS_5M;                   // LONG: boundary 100, SL 99, TP 102

ok('T2.1 boundary touch fills AT the boundary', () => {
  const exec = [C(0, 101, 101.2, 100.9, 101), C(T0, 100.6, 100.7, BO, 100.3)];
  const r = resolvePendingOrder({ exec, startIdx: 1, direction: 'LONG', boundary: BO, slLevel: SL, t0: T0 });
  assert.equal(r.outcome, 'FILLED');
  assert.equal(r.fill, BO);
  assert.equal(r.fillOpenT, T0);
});

ok('T2.2 open beyond limit (but above SL) fills at the OPEN; R from actual fill', () => {
  const exec = [C(0, 101, 101.2, 100.9, 101), C(T0, 99.7, 100.1, 99.6, 99.9)];
  const r = resolvePendingOrder({ exec, startIdx: 1, direction: 'LONG', boundary: BO, slLevel: SL, t0: T0 });
  assert.equal(r.outcome, 'FILLED');
  assert.equal(r.fill, 99.7);
  assert.ok(Math.abs(r.rAbs - 0.7) < 1e-9, `rAbs=${r.rAbs}`);
  assert.ok(Math.abs(r.tpPrice - (99.7 + TP_R * 0.7)) < 1e-9);
});

ok('T2.3 VOID_GAP: open beyond SL cancels (never fills)', () => {
  const exec = [C(0, 101, 101.2, 100.9, 101), C(T0, 98.5, 98.7, 98.2, 98.4), C(T0 + MS_5M, 98.4, 99.5, 98.3, 99.4)];
  const r = resolvePendingOrder({ exec, startIdx: 1, direction: 'LONG', boundary: BO, slLevel: SL, t0: T0 });
  assert.equal(r.outcome, 'VOID_GAP');
  assert.equal(r.pendIdx, 1);
});

ok('T2.4 SELL mirror: boundary fill / open fill / VOID_GAP', () => {
  const B = 100.0, S = 101.0;
  const exec = [C(0, 99, 99.2, 98.9, 99), C(T0, 99.4, 100.3, 99.3, 100.1)];
  assert.equal(resolvePendingOrder({ exec, startIdx: 1, direction: 'SHORT', boundary: B, slLevel: S, t0: T0 }).fill, B);
  const exec2 = [C(0, 99, 99.2, 98.9, 99), C(T0, 100.4, 100.6, 100.2, 100.5)];
  assert.equal(resolvePendingOrder({ exec: exec2, startIdx: 1, direction: 'SHORT', boundary: B, slLevel: S, t0: T0 }).fill, 100.4);
  const exec3 = [C(0, 99, 99.2, 98.9, 99), C(T0, 101.4, 101.6, 101.2, 101.5)];
  assert.equal(resolvePendingOrder({ exec: exec3, startIdx: 1, direction: 'SHORT', boundary: B, slLevel: S, t0: T0 }).outcome, 'VOID_GAP');
});

ok('T2.5 EXPIRED at the first bar with open time >= T0+48h (checked BEFORE fill logic)', () => {
  const dl = T0 + MAX_PENDING_HOURS * MS_1H;
  const exec = [C(0, 101, 101.2, 100.9, 101), C(dl, 99.7, 100.5, 99.6, 100.2)]; // would fill, but expired
  const r = resolvePendingOrder({ exec, startIdx: 1, direction: 'LONG', boundary: BO, slLevel: SL, t0: T0 });
  assert.equal(r.outcome, 'EXPIRED');
  const exec2 = [C(0, 101, 101.2, 100.9, 101), C(dl - MS_5M, 100.6, 100.7, BO, 100.3)];
  assert.equal(resolvePendingOrder({ exec: exec2, startIdx: 1, direction: 'LONG', boundary: BO, slLevel: SL, t0: T0 }).outcome, 'FILLED');
});

ok('T2.6 weekend wall-clock: Friday order expires before the Monday open can fill it', () => {
  const friT0 = Date.parse('2026-09-04T20:45:00Z');
  const dl = friT0 + 48 * MS_1H;                                 // Sunday 20:45 — inside the weekend
  const monBar = C(Date.parse('2026-09-07T21:00:00Z'), 100.6, 100.7, BO, 100.3);
  const r = resolvePendingOrder({ exec: [monBar], startIdx: 0, direction: 'LONG', boundary: BO, slLevel: SL, t0: friT0 });
  assert.ok(dl < monBar.t, 'deadline falls inside the weekend');
  assert.equal(r.outcome, 'EXPIRED');
});

ok('T2.7 CENSORED_ORDER: execution data ends before fill/void/expiry', () => {
  const exec = [C(0, 101, 101.2, 100.9, 101)];
  const r = resolvePendingOrder({ exec, startIdx: 1, direction: 'LONG', boundary: BO, slLevel: SL, t0: T0 });
  assert.equal(r.outcome, 'CENSORED_ORDER');
});

// ═══════════════════════ T3: fill-bar rule + engine integration ════════════

ok('T3.1 fill-bar SL touch -> SL -1R on the fill bar (conservative)', () => {
  const exec = [C(0, 101, 101.2, 100.9, 101), C(T0, 100.4, 100.5, 98.9, 99.2)];
  const r = resolvePendingOrder({ exec, startIdx: 1, direction: 'LONG', boundary: BO, slLevel: SL, t0: T0 });
  assert.equal(r.outcome, 'FILLED');
  assert.equal(r.trade.type, 'SL');
  assert.equal(r.trade.r, -1);
  assert.equal(r.trade.fillBarOutcome, 'SL');
});

ok('T3.2 fill-bar TP touch (no SL) -> TP +2R on the fill bar', () => {
  const exec = [C(0, 101, 101.2, 100.9, 101), C(T0, 100.6, 102.4, BO, 101.0)];
  const r = resolvePendingOrder({ exec, startIdx: 1, direction: 'LONG', boundary: BO, slLevel: SL, t0: T0 });
  assert.equal(r.trade.type, 'TP');
  assert.equal(r.trade.r, 2);
});

ok('T3.3 fill-bar BOTH touches -> SL (engine-conservative)', () => {
  const exec = [C(0, 101, 101.2, 100.9, 101), C(T0, 100.6, 102.4, 98.8, 100.5)];
  const r = resolvePendingOrder({ exec, startIdx: 1, direction: 'LONG', boundary: BO, slLevel: SL, t0: T0 });
  assert.equal(r.trade.type, 'SL');
  assert.equal(r.trade.bothTouched, true);
});

ok('T3.4 TP on a later bar via the engine', () => {
  const exec = [C(0, 101, 101.2, 100.9, 101), C(T0, 100.6, 100.7, BO, 100.3),
                C(T0 + MS_5M, 100.3, 102.2, 100.2, 102.0)];
  const r = resolvePendingOrder({ exec, startIdx: 1, direction: 'LONG', boundary: BO, slLevel: SL, t0: T0 });
  assert.equal(r.trade.type, 'TP');
  assert.equal(r.trade.r, 2);
  assert.equal(r.trade.fillBarOutcome, 'NONE');
});

ok('T3.5 SL on a later bar; same-candle TP+SL -> SL', () => {
  const exec = [C(0, 101, 101.2, 100.9, 101), C(T0, 100.6, 100.7, BO, 100.3),
                C(T0 + MS_5M, 100.3, 99.2, 98.8, 99.0)];
  const r = resolvePendingOrder({ exec, startIdx: 1, direction: 'LONG', boundary: BO, slLevel: SL, t0: T0 });
  assert.equal(r.trade.type, 'SL');
  assert.equal(r.trade.r, -1);
  const exec2 = [C(0, 101, 101.2, 100.9, 101), C(T0, 100.6, 100.7, BO, 100.3),
                 C(T0 + MS_5M, 100.3, 102.4, 98.8, 99.1)];
  assert.equal(resolvePendingOrder({ exec: exec2, startIdx: 1, direction: 'LONG', boundary: BO, slLevel: SL, t0: T0 }).trade.type, 'SL');
});

ok('T3.6 TIMEOUT at 120h: exit at close of the last bar inside the hold window', () => {
  const exec = [C(0, 101, 101.2, 100.9, 101), C(T0, 100.6, 100.7, BO, 100.3)];
  const holdEnd = T0 + MS_5M + 120 * MS_1H;
  for (let t = T0 + MS_5M; t < holdEnd; t += MS_5M) exec.push(C(t, 100.3, 100.5, 100.1, 100.4));
  const r = resolvePendingOrder({ exec, startIdx: 1, direction: 'LONG', boundary: BO, slLevel: SL, t0: T0 });
  assert.equal(r.trade.type, 'TIMEOUT');
  assert.equal(r.trade.exitPrice, 100.4);
  assert.ok(Math.abs(r.trade.r - 0.4) < 1e-9);
  const exec2 = [...exec, C(holdEnd, 100.4, 103, 100.3, 103)];   // closes after hold end: not walked
  const r2 = resolvePendingOrder({ exec: exec2, startIdx: 1, direction: 'LONG', boundary: BO, slLevel: SL, t0: T0 });
  assert.equal(r2.trade.type, 'TIMEOUT');
  assert.equal(r2.trade.exitPrice, 100.4);
});

ok('T3.7 CENSORED trade: data ends inside the hold window', () => {
  const exec = [C(0, 101, 101.2, 100.9, 101), C(T0, 100.6, 100.7, BO, 100.3),
                C(T0 + MS_5M, 100.3, 100.5, 100.1, 100.4)];
  const r = resolvePendingOrder({ exec, startIdx: 1, direction: 'LONG', boundary: BO, slLevel: SL, t0: T0 });
  assert.equal(r.trade.type, 'CENSORED');
});

ok('T3.8 geometric invariant: boundary fill R_abs = 1.1 x zone range (OB and FVG)', () => {
  const cs = makeBull15();
  const ob = buildObFromBreak(cs, 49, 'CHoCH_BULL', cs[10].t, t2i(cs));
  const fvg = buildFvgFromBreak(cs, 49, 'CHoCH_BULL', cs[10].t, t2i(cs));
  const rOb = Math.abs((ob.dir === 'BULL' ? ob.zoneHigh : ob.zoneLow) - ob.slLevel);
  const rFvg = Math.abs((fvg.dir === 'BULL' ? fvg.zoneHigh : fvg.zoneLow) - fvg.slLevel);
  assert.ok(Math.abs(rOb - 1.1 * (ob.zoneHigh - ob.zoneLow)) < 1e-12);
  assert.ok(Math.abs(rFvg - 1.1 * (fvg.zoneHigh - fvg.zoneLow)) < 1e-12);
});

// ══════════════════════════════ T4: cost math ══════════════════════════════

ok('T4.1 spread_R and swap_R (UTC midnights strictly crossed from fill-bar OPEN)', () => {
  const fillOpen = Date.parse('2026-09-04T21:00:00Z');           // Friday 21:00
  const exit = Date.parse('2026-09-07T22:00:00Z');               // Monday 22:00
  const c = costR({ pair: 'EURUSD', rAbs: 0.0050, fillOpenT: fillOpen, exitTime: exit });
  assert.ok(Math.abs(c.spreadR - 0.0001 / 0.0050) < 1e-12);
  assert.equal(c.swapNights, 3);                                 // Sat/Sun/Mon midnights
  assert.ok(Math.abs(c.swapR - 3 * 0.0001 / 0.0050) < 1e-12);
  const c2 = costR({ pair: 'USDJPY', rAbs: 0.500, fillOpenT: fillOpen, exitTime: exit });
  assert.equal(c2.spreadPips, 1.2);
  assert.ok(Math.abs(c2.spreadR - 1.2 * 0.01 / 0.5) < 1e-12);
  const c3 = costR({ pair: 'EURUSD', rAbs: 0.0050, fillOpenT: fillOpen, exitTime: fillOpen + 3600e3 });
  assert.equal(c3.swapNights, 0);
  const c4 = costR({ pair: 'EURUSD', rAbs: 0.0050, fillOpenT: fillOpen, exitTime: null }); // CENSORED
  assert.equal(c4.swapNights, 0);
});

ok('T4.2 wilson bounds + deterministic bootstrap (seed 20260912)', () => {
  const w = wilson(30, 100);
  assert.ok(w.lo > 0.21 && w.lo < 0.23 && w.hi > 0.38 && w.hi < 0.40);
  const rndA = mulberry32(20260912), rndB = mulberry32(20260912);
  for (let i = 0; i < 100; i++) assert.equal(rndA(), rndB());
  const xs = Array.from({ length: 200 }, (_, i) => (i % 2 ? 1 : -1) * 0.5);
  assert.deepEqual(bootstrapMeanCI(xs), bootstrapMeanCI(xs));
  assert.ok(Math.abs(bootstrapMeanCI(xs).point) < 1e-9);
});

// ═══════════════════ T5: full engine lifecycle (integration) ═══════════════

const BULL15_FVG = { boundary: 94.50, slLevel: 94.00 - OB_BUFFER * 0.5 };
const BULL15_OB = { boundary: 94.30, slLevel: 93.60 - OB_BUFFER * 0.7 };
const BULLSHORT_FVG = { boundary: 95.10, slLevel: 94.98 - OB_BUFFER * (95.10 - 94.98) };

ok('T5.1 engine: FVG-only event (NO_OB) places the FVG order and fills at the boundary', () => {
  const c15 = makeBullShort();
  const exec = execFor({ ...BULLSHORT_FVG, fill: 'boundary' });
  const rows = runEngine({ c15, c1h: makeH1Up(), exec });
  const ev = rows.filter((r) => r.kind === 'EV' && r.event.endsWith('BULL'));
  assert.equal(ev.length, 1, 'exactly one bull event');
  assert.equal(ev[0].ob, null, 'OB slot empty (green leg)');
  assert.ok(ev[0].fvg && ev[0].fvg.zoneHigh === 95.10);
  const ord = rows.filter((r) => r.kind === 'ORD');
  assert.equal(ord.filter((r) => String(r.decision).startsWith('PLACED_')).length, 1);
  assert.equal(ord.find((r) => String(r.decision).startsWith('PLACED_')).decision, 'PLACED_FVG');
  assert.equal(ord.find((r) => String(r.decision).startsWith('PLACED_')).boundary, 95.10);
  const pend = rows.filter((r) => r.kind === 'PEND');
  assert.equal(pend.length, 1);
  assert.equal(pend[0].outcome, 'FILLED');
  assert.equal(pend[0].fillPrice, 95.10);
  const trd = rows.filter((r) => r.kind === 'TRD');
  assert.equal(trd.length, 1);
  assert.equal(trd[0].zoneType, 'FVG');
  assert.equal(trd[0].entry, 95.10);
  assert.ok(Math.abs(trd[0].rAbs - 1.1 * 0.12) < 1e-9, `rAbs=${trd[0].rAbs}`);
});

ok('T5.2 engine: OB takes precedence when both zones qualify (SKIPPED_OB_PRIORITY logged)', () => {
  const c15 = makeBull15();
  const exec = execFor({ ...BULL15_OB, fill: 'boundary' });
  const rows = runEngine({ c15, c1h: makeH1Up(), exec });
  const ord = rows.filter((r) => r.kind === 'ORD');
  assert.ok(ord.some((r) => r.decision === 'SKIPPED_OB_PRIORITY'), 'FVG passed over');
  const placed = ord.filter((r) => String(r.decision).startsWith('PLACED_'));
  assert.equal(placed.length, 1);
  assert.equal(placed[0].zoneType, 'OB');
  assert.equal(placed[0].boundary, 94.30);
});

ok('T5.3 engine: ZONE_DIR_MISMATCH — bull event under DOWN bias places nothing', () => {
  const c15 = makeBull15();
  const exec = execFor({ ...BULL15_OB, fill: 'boundary' });
  const rows = runEngine({ c15, c1h: makeH1Down(), exec });
  const ord = rows.filter((r) => r.kind === 'ORD');
  assert.equal(ord.length, 1);
  assert.equal(ord[0].decision, 'ZONE_DIR_MISMATCH');
  assert.equal(rows.filter((r) => r.kind === 'PEND').length, 0);
});

/** Extend a bull fixture with a second bull break at bar 70 (BOS after sh@49). */
function withSecondEvent(c15) {
  const cs = [...c15];
  for (let i = 60; i <= 69; i++) {
    const p = 96 + (i - 59) * 0.3;
    cs.push(C(i * MS_15M, p, p + 0.4, p - 0.2, p + 0.3));
  }
  cs.push(C(70 * MS_15M, 99.2, 101.9, 99.0, 101.6));             // close 101.6 > sh 100.5
  for (let i = 71; i <= 76; i++) cs.push(C(i * MS_15M, 101.4, 101.6, 101.2, 101.5));
  return cs;
}

ok('T5.4 engine: SKIPPED_PENDING — second event while the first order is still pending', () => {
  const c15 = withSecondEvent(makeBull15());
  const exec = execFor({ ...BULL15_OB, fill: 'none', driftBars: 400 }); // never fills
  const rows = runEngine({ c15, c1h: makeH1Up(30), exec });
  const ords = rows.filter((r) => r.kind === 'ORD');
  assert.equal(ords.filter((r) => String(r.decision).startsWith('PLACED_')).length, 1);
  assert.ok(ords.some((r) => r.decision === 'SKIPPED_PENDING'), 'second event must be skipped');
  const pend = rows.filter((r) => r.kind === 'PEND');
  assert.ok(pend.every((p) => p.outcome !== 'FILLED'), 'order must remain pending');
});

ok('T5.5 engine: POSITION_BUSY — event while a filled trade is still open; CENSORED keeps the pair busy', () => {
  const c15 = withSecondEvent(makeBull15());
  const exec = execFor({ ...BULL15_OB, fill: 'boundary', driftBars: 400 });
  const rows = runEngine({ c15, c1h: makeH1Up(30), exec });
  const trd = rows.filter((r) => r.kind === 'TRD');
  assert.equal(trd.length, 1, 'first order filled');
  assert.equal(trd[0].exitType, 'CENSORED', 'drift never resolves inside exec data');
  const ords = rows.filter((r) => r.kind === 'ORD');
  assert.ok(ords.some((r) => r.decision === 'POSITION_BUSY'), 'second event must see the open position');
});

ok('T5.6 engine: WARMUP blocks placements before the frozen warmup end', () => {
  const c15 = makeBull15();
  const exec = execFor({ ...BULL15_OB, fill: 'boundary' });
  const warmupEndT = 50 * MS_15M + 1;                            // just after the event close
  const rows = runEngine({ c15, c1h: makeH1Up(), exec, warmupEndT });
  const ord = rows.filter((r) => r.kind === 'ORD');
  assert.equal(ord[0].decision, 'WARMUP');
  assert.equal(rows.filter((r) => r.kind === 'PEND').length, 0);
});

ok('T5.7 engine: NO_BIAS with an empty 1h array', () => {
  const c15 = makeBull15();
  const exec = execFor({ ...BULL15_OB, fill: 'boundary' });
  const rows = runEngine({ c15, c1h: [], exec });
  const ord = rows.filter((r) => r.kind === 'ORD');
  assert.equal(ord[0].decision, 'NO_BIAS');
});

ok('T5.8 engine matches the pure oracle on the same order (fill + trade R)', () => {
  const c15 = makeBullShort();
  const exec = execFor({ ...BULLSHORT_FVG, fill: 'boundary' });
  const rows = runEngine({ c15, c1h: makeH1Up(), exec });
  const ord = rows.find((r) => r.kind === 'ORD' && String(r.decision).startsWith('PLACED_'));
  const pend = rows.find((r) => r.kind === 'PEND');
  const oracle = resolvePendingOrder({
    exec, startIdx: exec.findIndex((c) => c.t >= ord.closeT),
    direction: ord.direction, boundary: ord.boundary, slLevel: ord.slLevel, t0: ord.closeT,
  });
  assert.equal(pend.outcome, oracle.outcome);
  assert.equal(pend.fillIdx, oracle.fillIdx);
  assert.equal(rows.find((r) => r.kind === 'TRD').grossR, oracle.trade.r);
});

// ═══════════════════════════ T6: no-lookahead proofs ═══════════════════════

// decisions = EV + ORD + PEND rows (TRD excluded: exit resolution is mechanical
// forward walking BY DESIGN). Rows carry the placement bar index `i`, so the
// digest can be scoped to "everything decided at or before bar k".
function digest(rows) {
  return rows.map((r) => JSON.stringify(r)).join('|');
}
const decidedAtOrBefore = (rows, k) =>
  rows.filter((r) => r.kind !== 'TRD' && r.kind !== 'META' && (r.i ?? -1) <= k);

ok('T6.1 15m truncation + future-mutation: decisions at bars <= k are invariant', () => {
  const c15 = makeBull15();
  const exec = execFor({ ...BULL15_OB, fill: 'boundary' });
  const base = runEngine({ c15, c1h: makeH1Up(), exec });
  for (const k of [30, 49, 52]) {
    const mut = c15.map((c, i) => (i > k ? C(c.t, c.o + 5, c.h + 7, c.l + 3, c.c + 4) : c));
    const rows = runEngine({ c15: mut, c1h: makeH1Up(), exec });
    assert.equal(digest(decidedAtOrBefore(rows, k)), digest(decidedAtOrBefore(base, k)), `k=${k}`);
  }
});

ok('T6.2 1h close-boundary causality: exactly-closed bar counts (positive control); later bar never (negative control)', () => {
  const c15 = makeBull15();
  const exec = execFor({ ...BULL15_OB, fill: 'boundary' });
  const up = makeH1Up();
  // POSITIVE: bar 11 closes at 12h <= 12.5h (knowable) and IS the 1h break
  // bar. Mutating its close to below the pivot kills the break -> bias
  // UNKNOWN at the event -> NO_BIAS instead of a placement.
  const down = [...up];
  down[11] = C(11 * MS_1H, 97.5, 97.8, 97.2, 97.4);
  const rowsUp = runEngine({ c15, c1h: up, exec });
  const rowsDown = runEngine({ c15, c1h: down, exec });
  const ordUp = rowsUp.find((r) => r.kind === 'ORD' && String(r.decision).startsWith('PLACED_'));
  const ordDown = rowsDown.find((r) => r.kind === 'ORD');
  const evUp = rowsUp.find((r) => r.kind === 'EV' && r.i === 49);
  const evDown = rowsDown.find((r) => r.kind === 'EV' && r.i === 49);
  assert.equal(ordUp.decision.startsWith('PLACED_'), true);
  assert.equal(ordDown.decision, 'NO_BIAS');
  assert.equal(evUp.bias, 'UP');
  assert.equal(evDown.bias, 'UNKNOWN');
  // NEGATIVE: bar 12 closes at 13h > 12.5h — invisible to the decision at bar 49
  const down2 = [...up];
  down2[12] = C(12 * MS_1H, 102.4, 102.6, 90.0, 90.5);
  const rowsNeg = runEngine({ c15, c1h: down2, exec });
  assert.equal(digest(decidedAtOrBefore(rowsNeg, 49)), digest(decidedAtOrBefore(rowsUp, 49)));
});

ok('T6.3 execution-series causality: pre-T0 exec bars never affect the order or trade', () => {
  const c15 = makeBull15();
  const exec = execFor({ ...BULL15_OB, fill: 'boundary' });
  const T0 = 50 * MS_15M;                                        // placement instant
  const base = runEngine({ c15, c1h: makeH1Up(), exec });
  const execMut = exec.map((c) => (c.t < T0 ? C(c.t, c.o + 3, c.h + 4, c.l + 2, c.c + 3) : c));
  const rows = runEngine({ c15, c1h: makeH1Up(), exec: execMut });
  const f = (rs) => rs.filter((r) => r.kind === 'PEND' || r.kind === 'TRD');
  assert.equal(JSON.stringify(f(rows)), JSON.stringify(f(base)), 'order+trade identical');
});

ok('T6.4 structural: EV/ORD rows identical under arbitrary post-T0 exec mutation', () => {
  const c15 = makeBull15();
  const exec = execFor({ ...BULL15_OB, fill: 'boundary' });
  const execMut = exec.map((c) => (c.t >= 50 * MS_15M ? C(c.t, 1.0, 2.0, 0.5, 1.5) : c));
  const base = runEngine({ c15, c1h: makeH1Up(), exec });
  const rows = runEngine({ c15, c1h: makeH1Up(), exec: execMut });
  const f = (rs) => decidedAtOrBefore(rs.filter((r) => r.kind === 'EV' || r.kind === 'ORD'), 49);
  assert.equal(digest(f(rows)), digest(f(base)),
    'EV/ORD rows at bars <= 49 identical under arbitrary exec mutation');
});

// ══════════════════════ T7: library smoke in this repo ═════════════════════

ok('T7.1 imported engines respond (byte-identical imports wired correctly)', () => {
  const cs = makeBull15();
  const s = buildStructure(cs, 5);
  assert.equal(EVENT_NAME[s.eventAt[49]], 'CHoCH_BULL');
  assert.equal(lastClosedH1Index(makeH1Up(), 12.4 * MS_1H), 11);
  const tb = resolveTripleBarrier(
    [C(0, 100, 100, 100, 100), C(MS_5M, 100, 102.2, 100, 102)],
    1, { direction: 'LONG', entry: 100, slPrice: 99, tpPrice: 102, msPerBar: MS_5M, rAbs: 1 });
  assert.equal(tb.type, 'TP');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
