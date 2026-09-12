/**
 * AUTOCAL SIGNAL v1 — SINGLE FROZEN STRATEGY (pre-registered, no exploration).
 *
 * Spec: prereg/PREREG_AUTOCAL_SIGNAL.md (frozen 2026-09-12T15:45Z, commit a353866,
 * BEFORE this file existed). Every mechanism below is copied from that prereg —
 * no free parameters, no alternatives attempted. Deviations are forbidden.
 *
 * ── Strategy (prereg §5) ────────────────────────────────────────────────────
 * Bias (1h):   buildStructure at pivot L=5 (marketStructure.mjs, imported
 *              unchanged; sha256 834d79a0..) on 1h candles. At a decision with
 *              close time T, bias = trendAfter of the last 1h bar whose CLOSE
 *              time <= T. UNKNOWN -> no placement.
 * Zones (15m): buildStructure at L=5 on 15m. The MOST RECENT break event of any
 *              direction owns two zone slots (OB, FVG) — every new event
 *              replaces both with what it constructs (failed scan clears the
 *              slot; BOTH clears both). Zone direction = event direction.
 *   OB  (reused verbatim from SMC-CFD-1H prereg §3.3): pIdx = index of the
 *       broken swing pivot (shT/slT time->index; missing -> no OB); trough/
 *       crest = argmin low / argmax high over [pIdx..t] (earliest tie); scan
 *       extreme..pIdx for the FIRST opposite-colored candle; zone = full
 *       candle range; SL level = far edge -/+ 0.1 x range.
 *   FVG (new, frozen): 3-candle windows (k, k+1, k+2), k = t-2 DOWN TO pIdx
 *       (most-recent window first; window inside [pIdx..t]). Bull: low[k+2] >
 *       high[k] -> zone [high[k], low[k+2]]. Bear: high[k+2] < low[k] -> zone
 *       [high[k+2], low[k]]. First qualifying window wins (one FVG per event).
 *       SL level = far edge -/+ 0.1 x zone range.
 *   Proximal boundary = zoneHigh (BULL) / zoneLow (BEAR) — the edge price
 *   touches FIRST on the retest. R_abs at a boundary fill = 1.1 x zone range.
 * Placement:   at the close of the event bar (T0), once per event, fixed order:
 *              WARMUP, NO_BIAS, ZONE_DIR_MISMATCH, SKIPPED_PENDING,
 *              POSITION_BUSY, OB-over-FVG precedence, PLACED_OB / PLACED_FVG.
 *              A zone whose placement fails is never re-offered (the next
 *              event replaces the slots).
 * Pending:     BUY: bar OPEN <= SL -> VOID_GAP; OPEN <= boundary -> fill at
 *              OPEN; LOW <= boundary -> fill at boundary. SELL: mirror.
 *              EXPIRED at the first execution bar with OPEN time >= T0+48h
 *              (checked before that bar's fill logic). No other cancellation
 *              (a pending order survives zone supersession and bias flips —
 *              frozen disclosure, prereg §5.4).
 * Fill bar:    after the fill, the fill bar itself can resolve: SL touch ->
 *              SL; else TP touch -> TP; both -> SL (conservative, engine-
 *              consistent). Then resolveTripleBarrier(exec, fillIdx+1,
 *              { entryTime = fill bar CLOSE, maxHoldMs = 120h, msPerBar }).
 * Costs:       spread RT charged once at fill (EURUSD 1.0 / GBPUSD 1.5 /
 *              USDJPY 1.2 / AUDUSD 1.2 pips); swap 1.0 pip per UTC midnight
 *              strictly crossed between the fill bar's OPEN time and the exit
 *              time, flat both directions (prereg §6).
 *
 * ── No-lookahead contract ───────────────────────────────────────────────────
 * Decisions at 15m index i read: 15m bars <= i (causal buildStructure + this
 * bar's own OHLC) and 1h bars whose CLOSE time <= close time of bar i. The
 * execution series is NEVER read for bias/zone/placement decisions. Fill
 * detection reads only execution bars whose OPEN time >= the order's T0, in
 * chronological order (an execution bar starting exactly at T0 is eligible;
 * the event bar itself never is). Exit resolution is mechanical forward
 * walking of the frozen barrier engine (by design, that IS the future).
 * scripts/autocal_tests.mjs proves the contract by truncation and mutation.
 */

import {
  buildStructure, EVENT, EVENT_NAME, TREND_NAME, PIVOT_L,
} from './marketStructure.mjs';
import { resolveTripleBarrier } from '../../backtest/tripleBarrier.mjs';

export const MS_5M = 300_000;
export const MS_15M = 900_000;
export const MS_1H = 3_600_000;
export const OB_BUFFER = 0.1;        // prereg §5.3: 0.1x zone range beyond far edge
export const TP_R = 2;               // prereg §5.5: single TP value
export const MAX_HOLD_HOURS = 120;   // prereg §5.5
export const MAX_PENDING_HOURS = 48; // prereg §5.5

export const SPREAD_PIPS = Object.freeze({ EURUSD: 1.0, GBPUSD: 1.5, USDJPY: 1.2, AUDUSD: 1.2 });
export const SWAP_PIPS_PER_NIGHT = 1.0;

export function pipSizeFor(pair) { return pair === 'USDJPY' ? 0.01 : 0.0001; }

/** Index of the last 1h bar CLOSED at or before decisionCloseT (-1 if none). */
export function lastClosedH1Index(c1h, decisionCloseT) {
  for (let k = c1h.length - 1; k >= 0; k--) {
    if (c1h[k].t + MS_1H <= decisionCloseT) return k;
  }
  return -1;
}

function zoneFromCandle(dir, lo, hi, slLevel, breakIdx, srcIdx, srcT, type) {
  return { type, dir, zoneLow: lo, zoneHigh: hi, slLevel, breakIdx, srcIdx, srcT };
}

/**
 * OB zone from a break event at 15m bar t (prereg §5.3, row 17 construction).
 * @returns zone | null (BOTH, anchor missing, or no opposite-colored candle)
 */
export function buildObFromBreak(candles, t, event, swingRefT, timeToIdx) {
  const bull = event === 'BOS_BULL' || event === 'CHoCH_BULL';
  const bear = event === 'BOS_BEAR' || event === 'CHoCH_BEAR';
  if (!bull && !bear) return null;                       // BOTH / NONE
  const pIdx = Number.isFinite(swingRefT) ? (timeToIdx.get(swingRefT) ?? null) : null;
  if (pIdx == null || pIdx > t) return null;             // anchor must be at/behind the break
  let extremeIdx = pIdx;
  if (bull) {
    for (let k = pIdx; k <= t; k++) if (candles[k].l < candles[extremeIdx].l) extremeIdx = k;
    for (let k = extremeIdx; k >= pIdx; k--) {
      // zero-range (flat) candles are rejected: the imported engine's frozen
      // contract mandates rAbs > 0 (tripleBarrier.mjs throws otherwise), and a
      // flat OB candle yields boundary == SL level -> R_abs = 0. Mechanization
      // note M1 (mirror of SMC-CFD-1H's M1): rejection at construction.
      if (candles[k].c < candles[k].o && candles[k].h > candles[k].l) {
        const lo = candles[k].l, hi = candles[k].h;
        return zoneFromCandle('BULL', lo, hi, lo - OB_BUFFER * (hi - lo), t, k, candles[k].t, 'OB');
      }
    }
  } else {
    for (let k = pIdx; k <= t; k++) if (candles[k].h > candles[extremeIdx].h) extremeIdx = k;
    for (let k = extremeIdx; k >= pIdx; k--) {
      if (candles[k].c > candles[k].o && candles[k].h > candles[k].l) {
        const lo = candles[k].l, hi = candles[k].h;
        return zoneFromCandle('BEAR', lo, hi, hi + OB_BUFFER * (hi - lo), t, k, candles[k].t, 'OB');
      }
    }
  }
  return null;                                           // NO_OB
}

/**
 * FVG zone from a break event at 15m bar t (prereg §5.3 — NEW frozen
 * construction): backward scan of 3-candle windows inside [pIdx..t], most
 * recent first; first qualifying imbalance wins; at most one FVG per event.
 */
export function buildFvgFromBreak(candles, t, event, swingRefT, timeToIdx) {
  const bull = event === 'BOS_BULL' || event === 'CHoCH_BULL';
  const bear = event === 'BOS_BEAR' || event === 'CHoCH_BEAR';
  if (!bull && !bear) return null;                       // BOTH / NONE
  const pIdx = Number.isFinite(swingRefT) ? (timeToIdx.get(swingRefT) ?? null) : null;
  if (pIdx == null || pIdx > t) return null;             // anchor must be at/behind the break
  for (let k = t - 2; k >= pIdx; k--) {                  // most-recent window first
    const c1 = candles[k], c3 = candles[k + 2];
    if (bull && c3.l > c1.h) {
      return zoneFromCandle('BULL', c1.h, c3.l, c1.h - OB_BUFFER * (c3.l - c1.h), t, k, c1.t, 'FVG');
    }
    if (bear && c3.h < c1.l) {
      return zoneFromCandle('BEAR', c3.h, c1.l, c1.l + OB_BUFFER * (c1.l - c3.h), t, k, c1.t, 'FVG');
    }
  }
  return null;
}

/**
 * Cost decomposition in R for one resolved trade (prereg §6 — frozen
 * assumptions). Spread charged once at fill; swap per UTC midnight strictly
 * crossed between the fill bar's OPEN time and the exit time.
 */
export function costR({ pair, rAbs, fillOpenT, exitTime }) {
  const pip = pipSizeFor(pair);
  const spreadPips = SPREAD_PIPS[pair];
  const spreadR = (spreadPips * pip) / rAbs;
  let nights = 0;
  if (exitTime != null) {
    const day = (ms) => Math.floor(ms / 86_400_000);
    nights = day(exitTime) - day(fillOpenT);
    if (nights < 0) nights = 0;
  }
  const swapPips = nights * SWAP_PIPS_PER_NIGHT;
  const swapR = (swapPips * pip) / rAbs;
  return { spreadPips, spreadR, swapNights: nights, swapPips, swapR };
}

/**
 * Frozen pending-order + exit resolution for ONE order against the execution
 * series (prereg §5.5). Pure: scans exec bars from startIdx; returns the order
 * outcome and, when filled, the full trade record (fill-bar rule + engine).
 *
 * @param exec    execution candles (5m, or the 15m fallback for gated pairs)
 * @param startIdx first exec index eligible for fill checks (t >= T0)
 * @returns { outcome: 'FILLED'|'VOID_GAP'|'EXPIRED'|'CENSORED_ORDER',
 *            pendIdx, fillIdx?, fillOpenT?, fill?, fillBarOutcome?,
 *            trade? } — trade present only when resolved (SL/TP/TIMEOUT/
 *            CENSORED from the engine or the fill-bar rule).
 */
export function resolvePendingOrder({ exec, startIdx, direction, boundary, slLevel,
                                      t0, msPerBar = MS_5M }) {
  const isLong = direction === 'LONG';
  const deadline = t0 + MAX_PENDING_HOURS * MS_1H;

  for (let e = startIdx; e < exec.length; e++) {
    const bar = exec[e];
    if (bar.t >= deadline) {
      return { outcome: 'EXPIRED', pendIdx: e };
    }
    // fill tests (prereg §5.5, fixed order per bar)
    if (isLong) {
      if (bar.o <= slLevel) return { outcome: 'VOID_GAP', pendIdx: e };
      if (bar.o <= boundary) return fillAt({ exec, e, fillPrice: bar.o, direction, boundary, slLevel, msPerBar });
      if (bar.l <= boundary) return fillAt({ exec, e, fillPrice: boundary, direction, boundary, slLevel, msPerBar });
    } else {
      if (bar.o >= slLevel) return { outcome: 'VOID_GAP', pendIdx: e };
      if (bar.o >= boundary) return fillAt({ exec, e, fillPrice: bar.o, direction, boundary, slLevel, msPerBar });
      if (bar.h >= boundary) return fillAt({ exec, e, fillPrice: boundary, direction, boundary, slLevel, msPerBar });
    }
  }
  return { outcome: 'CENSORED_ORDER', pendIdx: exec.length - 1 };
}

/** Fill-bar rule + engine resolution (prereg §5.5). */
function fillAt({ exec, e, fillPrice, direction, boundary, slLevel, msPerBar }) {
  const bar = exec[e];
  const isLong = direction === 'LONG';
  const rAbs = isLong ? fillPrice - slLevel : slLevel - fillPrice;
  if (!(rAbs > 0)) throw new Error('autocal: non-positive R_abs at fill');
  const tpPrice = isLong ? fillPrice + TP_R * rAbs : fillPrice - TP_R * rAbs;

  // fill-bar resolution (conservative: SL first, then TP; both -> SL)
  const slTouch = isLong ? bar.l <= slLevel : bar.h >= slLevel;
  const tpTouch = isLong ? bar.h >= tpPrice : bar.l <= tpPrice;
  let trade;
  if (slTouch || tpTouch) {
    const type = slTouch ? 'SL' : 'TP';
    const exitPrice = slTouch ? slLevel : tpPrice;
    trade = {
      type, exitIdx: e, exitT: bar.t + msPerBar, exitPrice,
      fillBarOutcome: type, slGapFill: false, bothTouched: slTouch && tpTouch,
      barsHeld: 0, minutesHeld: msPerBar / 60_000,
      r: +(((isLong ? exitPrice - fillPrice : fillPrice - exitPrice) / rAbs)).toFixed(8),
      rOpen: null,
    };
  } else {
    const eng = resolveTripleBarrier(exec, e + 1, {
      direction, entry: fillPrice, slPrice: slLevel, tpPrice,
      maxHoldMs: MAX_HOLD_HOURS * MS_1H, msPerBar,
      entryTime: bar.t + msPerBar, rAbs,
    });
    trade = { ...eng, fillBarOutcome: 'NONE' };
  }
  return {
    outcome: 'FILLED', pendIdx: e, fillIdx: e, fillOpenT: bar.t, fill: fillPrice,
    fillBarOutcome: trade.fillBarOutcome, trade, rAbs, tpPrice,
  };
}

/**
 * Per-pair engine: steps 15m bars in order, drives the pending-order lifecycle
 * on the execution series, and emits audit rows. One instance per pair.
 *
 * State: two zone slots (replaced at every event), at most one pending order,
 * at most one open position (tracked by close time), exec cursor.
 */
export class AutocalPairEngine {
  /**
   * @param {object} opts { pair, c15, c1h, exec, msExec, warmupEndT }
   *   exec: execution candle array; msExec: its bar duration (5m or 15m fallback)
   *   warmupEndT: placements allowed from this UTC ms onward (frozen: 2026-07-20T00:00Z)
   */
  constructor({ pair, c15, c1h, exec, msExec, warmupEndT }) {
    this.pair = pair;
    this.c15 = c15;
    this.c1h = c1h;
    this.exec = exec;
    this.msExec = msExec;
    this.warmupEndT = warmupEndT;
    this.s15 = buildStructure(c15, PIVOT_L);             // library engine, L=5
    this.s1h = buildStructure(c1h, PIVOT_L);             // library engine, L=5
    this.timeToIdx15 = new Map(c15.map((c, i) => [c.t, i]));
    this.ob = null;
    this.fvg = null;
    this.i = -1;                                          // last stepped index
    this.execPtr = 0;                                     // next unprocessed exec bar
    this.pending = null;                                  // active pending order
    this.positionOpenUntil = null;                        // close time of open position
    this._ids = { ev: 0, ord: 0, trd: 0 };
  }

  biasAt(closeT) {
    const i1h = lastClosedH1Index(this.c1h, closeT);
    return { i1h, bias: i1h >= 0 ? TREND_NAME[this.s1h.trendAfter[i1h]] : 'UNKNOWN' };
  }

  /**
   * Process 15m bar i (strictly in order). Returns audit rows produced by this
   * step: PEND (order resolutions), EV (event snapshot), ORD (placement).
   */
  step(i) {
    if (i !== this.i + 1) throw new Error(`autocal: bars must be stepped in order (got ${i}, expected ${this.i + 1})`);
    this.i = i;
    const bar = this.c15[i];
    const closeT = bar.t + MS_15M;
    const rows = [];

    // ── 1. drain execution bars that START strictly before this 15m close ──
    // (fills that happened before the decision instant Ti are knowable now).
    // The cursor ALWAYS advances through every bar with t < closeT — even when
    // no order is pending — so an order placed at closeT can only ever scan
    // bars with t >= its T0 (no phantom pre-placement fills).
    while (this.execPtr < this.exec.length && this.exec[this.execPtr].t < closeT) {
      const e = this.execPtr++;
      if (this.pending) rows.push(...this._checkExecBar(e));
    }

    // ── 2. event at bar i -> replace both zone slots (prereg §5.2) ──
    const evCode = this.s15.eventAt[i];
    const event = EVENT_NAME[evCode];
    let obScan = null, fvgScan = null;
    if (evCode !== EVENT.NONE) {
      const swingRefT = (event === 'BOS_BULL' || event === 'CHoCH_BULL')
        ? this.s15.shT[i] : this.s15.slT[i];
      this.ob = buildObFromBreak(this.c15, i, event, swingRefT, this.timeToIdx15);
      this.fvg = buildFvgFromBreak(this.c15, i, event, swingRefT, this.timeToIdx15);
      obScan = this.ob ? { srcIdx: this.ob.srcIdx, srcT: this.ob.srcT } : 'NO_OB';
      fvgScan = this.fvg ? { srcIdx: this.fvg.srcIdx, srcT: this.fvg.srcT } : 'NO_FVG';
    }
    const { i1h, bias } = this.biasAt(closeT);
    const evId = ++this._ids.ev;
    rows.push({
      kind: 'EV', pair: this.pair, evId, i, t: bar.t, closeT, event, bias, i1h,
      ob: this.ob ? snapZone(this.ob) : null, fvg: this.fvg ? snapZone(this.fvg) : null,
      obScan, fvgScan, pendingAtEvent: !!this.pending,
      positionOpen: this.positionOpenUntil != null && closeT < this.positionOpenUntil,
    });
    const ev = rows[rows.length - 1];

    // ── 3. placement attempt (once per event, prereg §5.4 fixed order) ──
    if (evCode !== EVENT.NONE) {
      this._tryPlace(ev, closeT, rows);
    }
    return rows;
  }

  /**
   * Safety drain after the last 15m step: process any remaining execution bars
   * (t >= last 15m close) for a still-pending order. No-op when the execution
   * series ends at or before the 15m series (the case for both 5m and the
   * 15m-fallback datasets in this test) — included for contract completeness.
   */
  finish() {
    const rows = [];
    while (this.execPtr < this.exec.length) {
      const e = this.execPtr++;
      if (this.pending) rows.push(...this._checkExecBar(e));
    }
    // An order still pending at data end is CENSORED_ORDER (prereg §5.6
    // semantics inherited from the engine's data-end contract: never
    // interpolated, never silently dropped) — excluded from the fill-rate
    // denominator, reported by count.
    if (this.pending) {
      const ord = this.pending;
      this.pending = null;
      rows.push({ kind: 'PEND', pair: this.pair, ordId: ord.ordId, i: ord.i,
                  outcome: 'CENSORED_ORDER', pendIdx: this.exec.length - 1 });
    }
    return rows;
  }

  /** Fill/void/expiry check for the pending order on exec bar e. */
  _checkExecBar(e) {
    const ord = this.pending;
    const bar = this.exec[e];
    const deadline = ord.t0 + MAX_PENDING_HOURS * MS_1H;
    if (bar.t >= deadline) {
      this.pending = null;
      return [{ kind: 'PEND', pair: this.pair, ordId: ord.ordId, i: ord.i, outcome: 'EXPIRED',
                pendIdx: e, pendT: bar.t }];
    }
    const isLong = ord.direction === 'LONG';
    let fillPrice = null;
    if (isLong) {
      if (bar.o <= ord.slLevel) {
        this.pending = null;
        return [{ kind: 'PEND', pair: this.pair, ordId: ord.ordId, i: ord.i, outcome: 'VOID_GAP',
                  pendIdx: e, pendT: bar.t, barOpen: bar.o, slLevel: ord.slLevel }];
      }
      if (bar.o <= ord.boundary) fillPrice = bar.o;
      else if (bar.l <= ord.boundary) fillPrice = ord.boundary;
    } else {
      if (bar.o >= ord.slLevel) {
        this.pending = null;
        return [{ kind: 'PEND', pair: this.pair, ordId: ord.ordId, outcome: 'VOID_GAP',
                  pendIdx: e, pendT: bar.t, barOpen: bar.o, slLevel: ord.slLevel }];
      }
      if (bar.o >= ord.boundary) fillPrice = bar.o;
      else if (bar.h >= ord.boundary) fillPrice = ord.boundary;
    }
    if (fillPrice == null) return [];                     // no touch on this bar

    // ── FILL ──
    const rAbs = isLong ? fillPrice - ord.slLevel : ord.slLevel - fillPrice;
    const tpPrice = isLong ? fillPrice + TP_R * rAbs : fillPrice - TP_R * rAbs;
    const res = fillAt({ exec: this.exec, e, fillPrice, direction: ord.direction,
                         boundary: ord.boundary, slLevel: ord.slLevel, msPerBar: this.msExec });
    const tr = res.trade;
    const grossR = tr.r;
    const costs = costR({ pair: this.pair, rAbs, fillOpenT: res.fillOpenT, exitTime: tr.exitT });
    const netR = +(grossR - costs.spreadR - costs.swapR).toFixed(8);
    const trdId = ++this._ids.trd;
    this.pending = null;
    // CENSORED trade (exitT null): the position is open until data end — keep
    // the pair busy for the whole remaining horizon.
    this.positionOpenUntil = tr.exitT != null ? tr.exitT : Infinity;
    return [
      { kind: 'PEND', pair: this.pair, ordId: ord.ordId, i: ord.i, outcome: 'FILLED', pendIdx: e,
        pendT: bar.t, fillIdx: e, fillOpenT: res.fillOpenT, fillPrice,
        fillBarOutcome: tr.fillBarOutcome },
      { kind: 'TRD', pair: this.pair, trdId, ordId: ord.ordId, i: ord.i, zoneType: ord.zoneType,
        direction: ord.direction, entry: res.fill, slPrice: ord.slLevel, tpPrice,
        rAbs, fillIdx: e, fillOpenT: res.fillOpenT, entryTime: bar.t + this.msExec,
        exitType: tr.type, exitIdx: tr.exitIdx, exitT: tr.exitT, exitPrice: tr.exitPrice,
        grossR, netR, costs,
        bothTouched: tr.bothTouched, slGapFill: tr.slGapFill, rOpen: tr.rOpen,
        minutesHeld: tr.minutesHeld },
    ];
  }

  /** Placement attempt at event-bar close (prereg §5.4). */
  _tryPlace(ev, closeT, rows) {
    const ordId = ++this._ids.ord;
    const base = { kind: 'ORD', pair: this.pair, ordId, evId: ev.evId, i: ev.i, closeT };
    if (closeT < this.warmupEndT) { rows.push({ ...base, decision: 'WARMUP' }); return; }
    if (ev.bias === 'UNKNOWN') { rows.push({ ...base, decision: 'NO_BIAS' }); return; }
    const wantBull = ev.bias === 'UP';
    const obOk = this.ob && (this.ob.dir === 'BULL') === wantBull;
    const fvgOk = this.fvg && (this.fvg.dir === 'BULL') === wantBull;
    if (!obOk && !fvgOk) { rows.push({ ...base, decision: 'ZONE_DIR_MISMATCH' }); return; }
    if (this.pending) { rows.push({ ...base, decision: 'SKIPPED_PENDING' }); return; }
    if (this.positionOpenUntil != null && closeT < this.positionOpenUntil) {
      rows.push({ ...base, decision: 'POSITION_BUSY' }); return;
    }
    let zone, zoneType;
    if (obOk) {
      zone = this.ob; zoneType = 'OB';
      if (fvgOk) rows.push({ ...base, decision: 'SKIPPED_OB_PRIORITY' });  // an FVG was passed over
    } else { zone = this.fvg; zoneType = 'FVG'; }
    const boundary = zone.dir === 'BULL' ? zone.zoneHigh : zone.zoneLow;
    this.pending = {
      ordId, zoneType, direction: zone.dir === 'BULL' ? 'LONG' : 'SHORT',
      boundary, slLevel: zone.slLevel, t0: closeT, evId: ev.evId, i: ev.i,
      zoneLow: zone.zoneLow, zoneHigh: zone.zoneHigh,
    };
    rows.push({
      kind: 'ORD', pair: this.pair, ordId, evId: ev.evId, i: ev.i, closeT,
      decision: zoneType === 'OB' ? 'PLACED_OB' : 'PLACED_FVG',
      zoneType, direction: this.pending.direction, boundary, slLevel: zone.slLevel,
      zoneLow: zone.zoneLow, zoneHigh: zone.zoneHigh,
      expiryT: closeT + MAX_PENDING_HOURS * MS_1H,
    });
  }
}

function snapZone(z) {
  return { type: z.type, dir: z.dir, zoneLow: z.zoneLow, zoneHigh: z.zoneHigh,
           slLevel: z.slLevel, breakIdx: z.breakIdx, srcIdx: z.srcIdx, srcT: z.srcT };
}
