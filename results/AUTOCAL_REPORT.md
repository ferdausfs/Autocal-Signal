# AUTOCAL SIGNAL — PHASE 1 BACKTEST REPORT (single frozen run)

**VERDICT: GATE FAIL — pooled net expectancy −0.474R, bootstrap 95% CI [−0.709, −0.235].
CI lower bound < 0. Phase 2 (demo deployment, worker, bot) is NOT triggered.**

- Pre-registration: `prereg/PREREG_AUTOCAL_SIGNAL.md`, frozen 2026-09-12T15:45Z, commit
  `a353866` — committed and pushed to GitHub BEFORE any strategy code existed.
- Implementation commit: `d1a4adc` (39/39 tests passing, committed before the run).
- This report: single frozen run of `backtest/autocal_backtest.mjs` over the frozen
  window. Zero parameter changes after results. No rescue conditions applied.
- Run timestamp: 2026-09-12 (see `results/AUTOCAL_summary.json` → `meta.generatedAt`).

## 1. What was tested

Pure price-action SMC, no indicators: 1h BOS/CHoCH trend bias (library engine, L=5),
15m Order Block + Fair Value Gap zones from the most recent 15m structure break, a
**pending limit order at the zone's proximal boundary** placed the moment the zone
forms, fill on first touch, structural SL at the far edge + 0.1× zone-range buffer,
TP = 2R, max hold 120h, max pending 48h. FX CFD cost model (spread + swap). The
variable under test vs SMC-CFD-1H (scoreboard row 17): the fill mechanism — limit at
boundary vs market-on-close confirmation — on the same pairs, same window, same
15m/1h candles (byte-copies), same exit engine, same cost assumptions.

## 2. Data and execution resolution (per pair)

15m/1h: byte-copies of row 17's Yahoo datasets (evaluable window 2026-07-20T00:00Z →
2026-09-11 end, ~38 trading days; 1h bias machine warmed on 22 months). 5m execution
series fetched fresh; the prereg's frozen quality gates decided the per-pair
execution resolution BEFORE the run:

| Pair | 15m bars | 1h bars | 5m bars | 5m flat share | 5m gates | Execution resolution |
|------|---------|---------|---------|---------------|----------|----------------------|
| EURUSD | 4,142 | 12,312 | 12,023 | 19.18% | **FAIL** (<5%) | **15m fallback** (msPerBar=900,000) |
| GBPUSD | 4,144 | 12,304 | 12,023 | 0.52% | PASS | **5m** (msPerBar=300,000) |
| USDJPY | 4,148 | 12,386 | 11,972 | 0.03% | PASS | **5m** (msPerBar=300,000) |
| AUDUSD | 4,142 | 12,344 | 12,026 | 18.73% | **FAIL** (<5%) | **15m fallback** (msPerBar=900,000) |

The EURUSD/AUDUSD 5m feeds carry ~19% flat (stale-quote) bars — disqualifying for
touch-based fill simulation. The fallback is the prereg's own frozen per-pair rule
(§3), decided on data quality, not on any outcome (no results existed). Largest gaps
are the weekend closures (49.6–50.1h); no mid-week holes; first 5m bar
2026-07-15T15:35Z, covering the evaluable window.

## 3. Decision funnel (pooled, all four pairs)

| Stage | Count | Notes |
|-------|-------|-------|
| 15m break events | 816 | OB zone built on 763; FVG zone built on 614; BOTH events: 0 |
| WARMUP (no placement before 2026-07-20) | 68 | |
| ZONE_DIR_MISMATCH (no placement) | 381 | 376 = zones exist, bias disagrees; 5 = no zones (NO_OB / no FVG) |
| SKIPPED_PENDING | 174 | an order was already pending at the event |
| POSITION_BUSY | 17 | a filled trade was still open |
| SKIPPED_OB_PRIORITY | 130 | FVG zone passed over because the OB also qualified |
| **PLACED (orders)** | **176** | 169 OB + 7 FVG |
| — FILLED | **142** | **fill rate 80.7% (Wilson 95% CI [74.2%, 85.8%])** |
| — EXPIRED (48h, no touch) | 30 | |
| — VOID_GAP (open beyond SL) | 4 | |
| — CENSORED_ORDER | 0 | |
| Resolved trades | 141 | +1 CENSORED (excluded from statistics, reported) |

Fill-rate reading: the feared "many orders that never fill" did not materialize —
orders are placed at fresh zones and 80.7% were touched within 48h. The strategy is
therefore genuinely TESTED, not just untriggered: 141 resolved R-multiples.

## 4. Results — pooled (the gate)

| Metric | Value | 95% CI | n |
|--------|-------|--------|---|
| **Net expectancy (gate metric)** | **−0.4742 R/trade** | **[−0.7090, −0.2351]** | 141 |
| Gross expectancy (no costs) | −0.0103 R/trade | [−0.2443, +0.2244] | 141 |
| Win rate (gross R > 0) | 33.3% | [26.1%, 41.5%] | 141 |
| Mean cost per trade | 0.462 R | (spread 0.438 + swap 0.024) | 141 |
| Geometry breakeven WR at 2R with these costs | 48.7% | — | — |

**GATE (prereg §7): pooled net-expectancy bootstrap 95% CI lower bound > 0 →
−0.7090 > 0 is FALSE → GATE FAIL.** Bootstrap: 10,000 resamples, seed 20260912.

The gross result is a coin-flip around zero: the strategy has NO edge for costs to
erase. At 2R geometry, zero costs would need 33.3% wins to break even — the observed
33.3% is exactly there — and then costs remove 0.46R per trade.

## 5. Results — per pair (minimum-bucket-30 flags)

| Pair | Exec | Placed | Filled | Resolved n | WR (gross) | Net expectancy | Net 95% CI | Gross | min-30 |
|------|------|--------|--------|-----------|-----------|----------------|------------|-------|--------|
| EURUSD | 15m | 46 | 38 | 37 | 43.2% | −0.081 R | [−0.544, +0.406] | +0.297 R | ✓ 30 |
| GBPUSD | 5m | 42 | 30 | 30 | 26.7% | −0.642 R | [−1.098, −0.128] | −0.200 R | ✓ 30 |
| USDJPY | 5m | 36 | 30 | 30 | 36.7% | −0.226 R | [−0.747, +0.317] | +0.052 R | ✓ 30 |
| AUDUSD | 15m | 52 | 44 | 44 | 27.3% | −0.859 R | [−1.226, −0.472] | −0.182 R | ✓ 44 |

All four pairs are net-negative. Two of four (GBP, AUD) are negative with CIs
excluding zero; EUR and JPY CIs span zero but their point estimates are negative.
No pair — not even the best (EURUSD) — has a positive net point estimate.

## 6. Results — per zone type

| Zone type | Placed | Filled | Resolved n | WR | Net expectancy | Net 95% CI | mean cost R | min-30 |
|-----------|--------|--------|-----------|-----|----------------|------------|-------------|--------|
| Order Block | 169 | 136 | 135 | 33.3% | −0.445 R | [−0.680, −0.203] | 0.435 | ✓ |
| Fair Value Gap | 7 | 6 | 6 | 33.3% | −1.122 R | [−2.197, −0.014] | 1.122 | ✗ INSUFFICIENT |

The FVG cell is below the minimum bucket of 30 and cannot certify anything (its
−1.12R mean cost reflects tiny 3-candle imbalance zones — some FVG R_abs were under
a pip). OB carries the test's statistical weight and fails on its own.

## 7. Stability (halves split 2026-08-16T00:00Z, row 17's midpoint)

| Half | Resolved n | WR | Net expectancy | Net 95% CI | Gross | min-30 |
|------|-----------|-----|----------------|------------|-------|--------|
| First (to 08-15) | 68 | 32.4% | −0.519 R | [−0.850, −0.166] | −0.051 R | ✓ |
| Second (08-16+) | 73 | 34.2% | −0.432 R | [−0.753, −0.100] | +0.027 R | ✓ |

Stably negative across both halves — the failure is not a single-regime artifact.

## 8. Cost sensitivities (pooled net point estimates)

| Scenario | Net R/trade |
|----------|-------------|
| As-frozen | −0.474 |
| Spread ×0.5 | −0.254 |
| Spread ×2 | −0.914 |
| Swap ×0 | −0.450 |
| Swap ×2 | −0.499 |
| Worst case (spread ×2 + swap ×2) | −0.938 |

**Halving the spread still leaves net negative.** The failure is robust to every
cost assumption tried, including zero swap.

## 9. Why it failed — the mechanics, honestly

1. **The pending mechanism did what it promised — and it was not enough.** Gross
   expectancy improved from row 17's −0.105R to −0.010R (fill at the boundary is a
   better entry price than a confirming close, exactly as hypothesized, worth
   roughly +0.09R). But the gross CI [−0.244, +0.224] still spans zero: there is no
   demonstrated edge to capture.
2. **The better entry price SHRINKS R — and costs are fixed in price terms.** A
   boundary fill sits at the top of the zone, so R_abs = 1.1 × zone range is the
   TIGHTEST possible stop for the same zone. Mean R_abs came out at ~0.00195 USD
   (~2 pips on EUR/USD) vs row 17's roughly double — so the SAME 1-pip spread
   became 0.438R instead of ~0.22R. The fill mechanism that improved the entry
   simultaneously doubled the cost burden per R. Net expectancy moved from −0.333R
   (row 17) to −0.474R (this test).
3. **Swap is immaterial at these holds** (mean 0.15 nights held; 94/141 trades hit
   SL, most within hours): spread is effectively the entire cost problem, and it is
   structural at 2-pip stops.
4. Exit mix: SL 94 (66.7%), TP 46 (32.6%), TIMEOUT 1, CENSORED 1. Same-candle
   TP+SL double touches: 11 (resolved SL, frozen conservative rule). Fill-bar SL
   resolutions: 20 (the fill bar itself continued to the stop). Gap fills at SL: 9
   (reported; using `rOpen` fills instead of barrier fills would make results
   worse, consistent with row 17's sensitivity).

## 10. Gate verdict and consequences

- **GATE: FAIL** (net expectancy bootstrap 95% CI lower bound −0.7090 < 0).
- Per prereg §9: **Phase 2 is NOT triggered.** No Cloudflare Worker is created, no
  Telegram bot is created, no demo/paper deployment happens, and the existing FTT
  project's worker/bot remain untouched.
- Scoreboard: **18 tests, 0 PASS.** This is the fifth independent failure of the
  SMC family (SMC-1, SMC-2 MTF, SMC Search, SMC-CFD-1H, Autocal-1) and the second
  on the identical 1h-bias + 15m-zone skeleton — the fill mechanism was the last
  untested degree of freedom in that skeleton, and it did not rescue it.
- No parameter changes were made after seeing results. The frozen constants
  (L=5, OB buffer 0.1×, TP=2R, 48h pending, 120h hold, cost assumptions) are
  exactly those of the prereg.

## 11. Mechanization notes (declared, zero parameter changes)

- **Zero-range OB rejection:** a flat (zero-range) 15m candle cannot be an OB here —
  the imported engine's frozen contract mandates R_abs > 0 (`tripleBarrier.mjs`
  throws otherwise). Color already implies range > 0 for real candles, so this is
  defensive; no zone in this run was affected.
- **CENSORED_ORDER:** an order still pending at data end (never filled/voided and
  no 48h-deadline bar exists in the data) is logged CENSORED_ORDER and excluded
  from the fill-rate denominator. Zero occurred in this run.
- **Swap nights** are counted from the fill bar's OPEN time (the earliest possible
  fill moment → conservative upper bound); the engine's hold window starts at the
  fill bar's CLOSE time (its own frozen contract). Mean nights 0.15 — immaterial
  either way.
- **ZONE_DIR_MISMATCH** follows the prereg's literal fixed order, so events with no
  zones at all (BOTH / NO_OB / no FVG) also log this code; the report decomposes
  them (376 wrong-direction vs 5 no-zones).
- **SKIPPED_OB_PRIORITY** counts FVG zones passed over when the OB also qualified —
  the FVG order count (7) is small because OB precedence consumes most dual-zone
  events; the FVG bucket is therefore INSUFFICIENT by construction, not by data.
- **TIE** (R exactly 0) did not occur.

## 12. Reproducibility

- `node backtest/autocal_backtest.mjs` re-runs the identical frozen pipeline on the
  committed datasets (`backtest/data/*.json`, `backtest/data/autocal/*.json` — all
  in-repo, sha256 recorded at commit `aa10c1c`).
- Every decision is in `results/AUTOCAL_audit.jsonl(.gz)`: META (data + gates) /
  EV (every 15m bar: event, both zone slots, bias) / ORD (every placement attempt
  with reason) / PEND (fill/void/expire) / TRD (entry, SL, TP, R_abs, exit, costs,
  gross and net R). All summary numbers derive from these rows alone.
- Engines byte-identical to the Ftt-Otc-v6 refs (sha256 in prereg §4);
  `node scripts/autocal_tests.mjs` re-verifies 39/39.

## 13. Commit chain (branch `main`, pushed and verified)

| Commit | Content |
|--------|---------|
| `27bf659` | Phase 0 scaffold (byte-identical engine imports) |
| `a353866` | **PREREG frozen (pre-code) — pushed before any strategy code existed** |
| `aa10c1c` | Data frozen (15m/1h copies + 5m fetch + gates; fetcher committed before fetch) |
| `d1a4adc` | Frozen implementation + 39/39 tests |
| (this commit) | Single run + this report |
