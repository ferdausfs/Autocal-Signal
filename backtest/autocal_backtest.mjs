/**
 * AUTOCAL SIGNAL — single-run backtest runner (prereg §8.3).
 *
 * Loads the frozen datasets, drives one AutocalPairEngine per pair over the
 * 15m series, and writes:
 *   results/AUTOCAL_audit.jsonl      every EV / ORD / PEND / TRD row + META
 *   results/AUTOCAL_audit.jsonl.gz   gz copy
 *   results/AUTOCAL_summary.json     computed statistics (prereg §7)
 *
 * FROZEN: warmup end 2026-07-20T00:00Z; halves split 2026-08-16T00:00Z;
 * execution = 5m where the prereg quality gates passed, else the pair's own
 * 15m series (per-pair fallback disclosed in META rows). Single run — no
 * parameter exploration, no re-runs.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { AutocalPairEngine } from '../src/strategy/autocalSignal.mjs';
import { mean, wilson, bootstrapMeanCI } from './stats.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'backtest', 'data');
const OUT = path.join(ROOT, 'results');

const PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD'];
const WARMUP_END_T = Date.parse('2026-07-20T00:00:00Z');
const HALVES_SPLIT_T = Date.parse('2026-08-16T00:00:00Z');
const MS_5M = 300_000, MS_15M = 900_000;

function load(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function runPair(pair) {
  const m15 = load(path.join(DATA, `${pair}_m15.json`));
  const h1 = load(path.join(DATA, `${pair}_h1.json`));
  const m5path = path.join(DATA, 'autocal', `${pair}_m5.json`);
  const m5 = fs.existsSync(m5path) ? load(m5path) : null;
  const gatePass = !!(m5 && m5.gates && m5.gates.pass);
  const exec = gatePass ? m5.candles : m15.candles;
  const msExec = gatePass ? MS_5M : MS_15M;

  const engine = new AutocalPairEngine({
    pair, c15: m15.candles, c1h: h1.candles, exec, msExec, warmupEndT: WARMUP_END_T,
  });

  const meta = {
    kind: 'META', pair,
    c15: m15.quality, c1hBars: h1.candles.length,
    c1hFirst: h1.candles[0].t, c1hLast: h1.candles[h1.candles.length - 1].t,
    execSource: gatePass ? 'yahoo_5m' : 'yahoo_15m_fallback',
    msExec, execBars: exec.length,
    execGates: m5 ? m5.gates : null,
    warmupEndT: WARMUP_END_T, halvesSplitT: HALVES_SPLIT_T,
  };

  const rows = [meta];
  for (let i = 0; i < m15.candles.length; i++) rows.push(...engine.step(i));
  rows.push(...engine.finish());
  return rows;
}

// ── statistics (prereg §7) ──────────────────────────────────────────────────

function cellStats(trades, placedCount, resolvedOrderCount) {
  const resolved = trades.filter((t) => t.exitType !== 'CENSORED');
  const censored = trades.length - resolved.length;
  const rs = resolved.map((t) => t.netR);
  const gross = resolved.map((t) => t.grossR);
  const wins = resolved.filter((t) => t.grossR > 0).length;   // WIN on gross R (costs separate)
  const losses = resolved.filter((t) => t.grossR < 0).length;
  const ties = resolved.length - wins - losses;
  const wr = wilson(wins, resolved.length);
  const net = bootstrapMeanCI(rs);
  const gr = bootstrapMeanCI(gross);
  const meanCostR = resolved.length ? mean(resolved.map((t) => t.costs.spreadR + t.costs.swapR)) : null;
  return {
    nTrades: trades.length, nResolved: resolved.length, nCensored: censored,
    wins, losses, ties,
    wr: { point: wr.p, lo: wr.lo, hi: wr.hi },
    gross: { point: gr.point, lo: gr.lo, hi: gr.hi },
    net: { point: net.point, lo: net.lo, hi: net.hi },
    meanCostR,
    geometryBreakEven: meanCostR != null ? (1 + meanCostR) / 3 : null,
    placedCount, resolvedOrderCount,
    fillRateRaw: placedCount ? trades.length / placedCount : null,
    fillRateResolved: resolvedOrderCount ? trades.length / resolvedOrderCount : null,
    min30: resolved.length >= 30,
  };
}

function sensitivity(trades, spreadMult, swapMult) {
  const resolved = trades.filter((t) => t.exitType !== 'CENSORED');
  if (!resolved.length) return null;
  const xs = resolved.map((t) => t.grossR - t.costs.spreadR * spreadMult - t.costs.swapR * swapMult);
  return bootstrapMeanCI(xs).point;
}

function summarize(allRows) {
  const trades = allRows.filter((r) => r.kind === 'TRD');
  const ords = allRows.filter((r) => r.kind === 'ORD');
  const pends = allRows.filter((r) => r.kind === 'PEND');
  const placed = ords.filter((r) => String(r.decision).startsWith('PLACED_'));
  const pendOutcomes = {};
  for (const p of pends) pendOutcomes[p.outcome] = (pendOutcomes[p.outcome] || 0) + 1;
  const funnel = {};
  for (const o of ords) funnel[o.decision] = (funnel[o.decision] || 0) + 1;

  const resolvedOrders = placed.length - (pendOutcomes.CENSORED_ORDER || 0);
  const pooled = cellStats(trades, placed.length, resolvedOrders);

  const byPair = {}, byZone = {}, halves = { first: [], second: [] };
  for (const p of PAIRS) {
    const t = trades.filter((r) => r.pair === p);
    const pl = placed.filter((r) => r.pair === p);
    const po = pends.filter((r) => r.pair === p);
    const resOrd = pl.length - po.filter((x) => x.outcome === 'CENSORED_ORDER').length;
    byPair[p] = cellStats(t, pl.length, resOrd);
  }
  for (const zt of ['OB', 'FVG']) {
    const t = trades.filter((r) => r.zoneType === zt);
    const pl = placed.filter((r) => r.zoneType === zt);
    const po = pends.filter((r) => r.ordId && pl.some((x) => x.ordId === r.ordId));
    const resOrd = pl.length - po.filter((x) => x.outcome === 'CENSORED_ORDER').length;
    byZone[zt] = cellStats(t, pl.length, resOrd);
  }
  const ordById = new Map(placed.map((o) => [o.ordId, o]));
  for (const t of trades) {
    const o = ordById.get(t.ordId);
    if (!o) continue;
    (t.fillOpenT < HALVES_SPLIT_T ? halves.first : halves.second).push(t);
  }
  const halvesStats = {
    splitT: HALVES_SPLIT_T,
    first: cellStats(halves.first, null, null),
    second: cellStats(halves.second, null, null),
  };

  return {
    gate: 'pooled net expectancy bootstrap 95% CI lower bound > 0 (prereg §7)',
    pooled: {
      ...pooled,
      netSens: {
        spreadHalf: null, spreadDouble: null, swapZero: null, swapDouble: null, worstCase: null,
      },
    },
    byPair, byZone, halves: halvesStats,
    funnel, pendOutcomes,
    placedTotal: placed.length,
  };
}

// ── main ────────────────────────────────────────────────────────────────────

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const allRows = [];
  for (const pair of PAIRS) allRows.push(...runPair(pair));

  const jsonl = allRows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(path.join(OUT, 'AUTOCAL_audit.jsonl'), jsonl);
  fs.writeFileSync(path.join(OUT, 'AUTOCAL_audit.jsonl.gz'), zlib.gzipSync(Buffer.from(jsonl)));

  const summary = summarize(allRows);
  const tradesAll = allRows.filter((r) => r.kind === 'TRD');
  summary.pooled.netSens = {
    spreadHalf: sensitivity(tradesAll, 0.5, 1),
    spreadDouble: sensitivity(tradesAll, 2, 1),
    swapZero: sensitivity(tradesAll, 1, 0),
    swapDouble: sensitivity(tradesAll, 1, 2),
    worstCase: sensitivity(tradesAll, 2, 2),
  };
  summary.meta = {
    generatedAt: new Date().toISOString(),
    runner: 'backtest/autocal_backtest.mjs',
    prereg: 'prereg/PREREG_AUTOCAL_SIGNAL.md (frozen 2026-09-12T15:45Z, commit a353866)',
    singleRun: true,
    bootstrap: { iters: 10000, seed: 20260912 },
  };
  fs.writeFileSync(path.join(OUT, 'AUTOCAL_summary.json'), JSON.stringify(summary, null, 2));

  // console digest
  const s = summary;
  console.log('=== AUTOCAL SIGNAL — single frozen run ===');
  console.log(`funnel: ${JSON.stringify(s.funnel)}`);
  console.log(`pend outcomes: ${JSON.stringify(s.pendOutcomes)}`);
  for (const p of PAIRS) {
    const c = s.byPair[p];
    console.log(`${p}: placed=${c.placedCount} filled=${c.nTrades} resolved=${c.nResolved} ` +
      `wr=${(c.wr.point * 100).toFixed(1)}% net=${c.net.point?.toFixed(3)}R CI[${c.net.lo?.toFixed(3)},${c.net.hi?.toFixed(3)}] ` +
      `gross=${c.gross.point?.toFixed(3)}R min30=${c.min30}`);
  }
  const zp = s.byZone;
  console.log(`OB : filled=${zp.OB.nTrades} net=${zp.OB.net.point?.toFixed(3)}R | FVG: filled=${zp.FVG.nTrades} net=${zp.FVG.net.point?.toFixed(3)}R`);
  console.log(`POOLED: n=${s.pooled.nResolved} net=${s.pooled.net.point?.toFixed(4)}R CI[${s.pooled.net.lo?.toFixed(4)}, ${s.pooled.net.hi?.toFixed(4)}]`);
  console.log(`        gross=${s.pooled.gross.point?.toFixed(4)}R CI[${s.pooled.gross.lo?.toFixed(4)}, ${s.pooled.gross.hi?.toFixed(4)}]`);
  console.log(`        WR=${(s.pooled.wr.point * 100).toFixed(1)}% CI[${(s.pooled.wr.lo * 100).toFixed(1)}, ${(s.pooled.wr.hi * 100).toFixed(1)}] fillRate=${(s.pooled.fillRateRaw * 100).toFixed(1)}%`);
  console.log(`GATE: net CI-LO ${s.pooled.net.lo?.toFixed(4)} > 0 ? ${s.pooled.net.lo > 0 ? 'PASS' : 'FAIL'}`);
}

main();
