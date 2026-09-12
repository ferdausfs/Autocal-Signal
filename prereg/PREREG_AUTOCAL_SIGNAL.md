# PRE-REGISTRATION — AUTOCAL SIGNAL v1 (pure price-action SMC, pending limit orders at OB/FVG zones, FX CFD)

Frozen: 2026-09-12T15:45:00Z BEFORE any Autocal Signal strategy code exists and BEFORE
any 5m execution dataset for this test was fetched or aggregated. Repo:
`ferdausfs/Autocal-Signal`, branch `main`, scaffold commit `27bf659` (contains ONLY the
README, AGENT_LOG and the two byte-identical engine imports — no strategy logic).
Test ID: AUTOCAL-1 (scoreboard row 18 in the Ftt-Otc-v6 project scoreboard).
Context: 17 project tests, 0 PASS. Row 16 (crypto SMC search): 0/640 configs
net-positive at 1–5m market-close entries. Row 17 (SMC-CFD-1H): the SAME 1h-bias +
15m-zone family with market-on-close entries on the SAME four FX pairs and the SAME
data window — GATE FAIL (pooled net −0.333R, gross −0.105R, n=114).

## 0. User task (2026-09-12, verbatim intent)

New project "Autocal Signal": pure price-action SMC (no indicators), pending limit
orders at structure zones, test-then-deploy. Phase 1 = pre-registered backtest with
the project's standard gate; Phase 2 (new Cloudflare Worker + new Telegram bot +
demo/paper account only) is permitted ONLY if Phase 1 passes. Not a resumption of the
crypto SMC search — the mechanism under test is genuinely different: pending limit
fills at a zone boundary instead of market entries on candle close.

## 1. Hypothesis being tested (falsifiable)

A strategy that (a) reads 1h BOS/CHoCH trend bias, (b) marks bias-aligned 15m Order
Block and Fair Value Gap zones from the most recent 15m structure break, (c) places a
PENDING LIMIT order at the zone's proximal boundary the moment the zone forms, (d)
fills on the first touch of that boundary (no close-confirmation, no waiting candle),
(e) exits via the standard R:R triple barrier (structural SL at the zone's invalidation
edge + 0.1× zone-range buffer, TP = 2R, max hold 120h) — has POSITIVE net expectancy
(R per filled trade, after FX CFD spread + overnight financing) on EUR/USD, GBP/USD,
USD/JPY, AUD/USD.

Mechanism claim under test (the ONLY variable relative to row 17): the fill mechanism.
Row 17 entered at the close of a confirming retest candle; this test enters at the
zone's proximal edge — a strictly earlier and typically better price — and the limit
order self-selects moments when price actually returns to the zone. The cost of that
selectivity is fill risk (orders that never fill are CANCELLED, never counted as
trades). Fill rate is therefore a first-class reported outcome, not a footnote.

GATE (primary, explicit): pooled net-expectancy 95% bootstrap CI lower bound > 0 →
PASS, else FAIL. Framing honesty: this follows 17 failed tests; row 17's zone logic
was gross-NEGATIVE on this exact window, so the prior here is strongly negative and a
PASS would still be "suggestive at best", requiring fresh-data confirmation before any
deployment claim. A FAIL is reported plainly with no rescue.

## 2. Instrument type and cost regime (explicit choice)

**FX CFD, spread + overnight-financing cost model** — not crypto taker fees.
Reasons, stated at freeze time: (a) the strategy's mechanics (pending GTC-style limit
orders, a 48h pending lifetime, per-night financing) are CFD/FX broker mechanics;
(b) the project's live SMC track (row 17) is CFD/FX on exactly these four pairs, and
same-instrument comparability is what isolates the fill-mechanism variable; (c) row 16
established that crypto taker-fee structure is hostile at these R scales.
Pairs (same as row 17): EUR/USD, GBP/USD, USD/JPY, AUD/USD.

## 3. Data (frozen)

- **Structure/bias series (15m and 1h):** byte-identical copies of row 17's cached
  Yahoo Finance chart-API datasets (`{PAIR}_m15.json`, `{PAIR}_h1.json`, fetched
  2026-09-12T06:03Z; provenance and quality gates documented in SMC-CFD-1H Amendment
  A3). Files are committed into `backtest/data/` of THIS repo; their sha256 digests
  are recorded in the commit message; the runner re-runs the same quality gates at
  load and re-reports them. Rationale: identical candles to row 17 — the entry
  mechanism becomes the only differing variable. 15m covers 2026-07-14 → 2026-09-11
  (~4.1k bars/pair, flat-bar share ≤ 1.67%, largest gap = the weekend); 1h covers
  ~22 months (bias-machine warmup).
- **Execution series (5m, NEW fetch):** Yahoo chart API, interval=5m, ~59d lookback,
  fetched by `backtest/fetch_autocal_5m.py` (committed BEFORE the fetch it performs).
  Pre-freeze availability probe (metadata only): EURUSD=X 12,187 rows, 98.7% valid
  OHLC, 2026-07-15T15:25Z → 2026-09-11T22:55Z. The 5m series is used ONLY for
  pending-fill detection and triple-barrier resolution — never for bias or zone
  decisions (those read only the 15m/1h series).
- **5m quality gates (checked at load, BEFORE the strategy run, reported per pair):**
  first bar ≤ 2026-07-19T00:00Z; flat-bar share (high == low) < 5%; no mid-week gap
  > 24h (weekend gaps of ~49–51h are expected and fine); valid-OHLC rows ≥ 95% of
  fetched rows. **Fallback rule (frozen, pre-run):** a pair failing any gate has its
  fills and barrier resolution resolved on its own 15m series instead (msPerBar =
  900,000) — same frozen semantics at coarser resolution; the per-pair choice is
  disclosed in the report. No other use of the fallback exists.
- **Window (frozen):** 15m warmup = bars before 2026-07-20T00:00Z feed the structure
  machines and produce NO placements (identical to row 17's A3 warmup). Evaluable
  window = 2026-07-20T00:00Z → 2026-09-11 end-of-data (~38 trading days/pair).
  1h bias machine warmed on the full 22-month history. The row 17 depth caveat is
  inherited verbatim: this window is shallow; the test is underpowered by design
  constraints, and that is reported, not hidden.
- **Reuse disclosure:** all four pairs were touched by prior tests (rows 8, 14, 17).
  Per the basis already established in row 17's prereg §6 (itself extending the
  crypto FRVP-FX1H precedent), reusing previously touched FX data for a NEW frozen
  hypothesis is legitimate: the strategy and ALL parameters below are new and frozen
  here before any 5m series was aggregated and before any run. The row 17 15m/1h
  copies are reused AS-IS (same files), which is the point of the comparability.

## 4. Reused engines (byte-identity, part of the freeze)

- `src/strategy/marketStructure.mjs` — imported UNCHANGED; byte-identical to
  `Ftt-Otc-v6` @ `origin/feature/market-structure`; sha256
  `834d79a0ba94281a48af7cc21be98f1eaa6825161ca870b1e28e9895a5a44b72`. Used:
  `buildStructure`/`stepStructure` at pivot L = 5 on BOTH the 1h (bias) and 15m
  (zone anchor) series.
- `backtest/tripleBarrier.mjs` — imported UNCHANGED; byte-identical to
  `Ftt-Otc-v6` @ `origin/feature/frvp-rr`; sha256
  `b7761bcd24347102ea5ee5d347df1d57a98c706588de6f1fa073bb50fb30d0eb`. Used:
  `resolveTripleBarrier` for every filled trade's exit.
- The library's `makeBiasPointer` hardcodes a 15m close duration and is NOT used for
  the 1h alignment; a local `lastClosedH1Index` helper (same as row 17's) is an
  alignment adapter, not an engine fork.
- Candle shape everywhere `{t,o,h,l,c}`, t = OPEN time ms UTC.

## 5. Strategy mechanization (single, frozen — no free parameters)

### 5.1 Bias (1h) — identical to row 17 §3.1
`buildStructure` on 1h, L = 5. At any decision with close time T, bias =
`trendAfter` of the last 1h bar whose CLOSE time (t + 3.6e6) ≤ T. A 1h bar closing
exactly at T counts. Bias UNKNOWN → no placement (NO_BIAS). Only closed 1h bars are
ever read.

### 5.2 Structure events (15m) — the zone anchor, identical to row 17 §3.2
`buildStructure` on 15m, L = 5, conceptually stepped bar by bar. Event classes:
BOS_BULL / CHoCH_BULL (bull break), BOS_BEAR / CHoCH_BEAR (bear break), BOTH.
The MOST RECENT break event of ANY direction owns the zone slots (frozen
interpretation A, generalized to two zone types): every new event REPLACES both the
standing OB slot and the standing FVG slot with what it constructs (a BULL/BEAR event
with a failed scan clears that slot; a BOTH event clears both slots — row 17's BOTH
semantics). Zone direction = event direction.

### 5.3 Zone construction at a break event (15m bar t)

- **Order Block (reused verbatim from row 17 §3.3):** bull break — pIdx = index of
  the broken swing-high pivot (from `shT[t]` via a time→index map; missing anchor →
  no OB); trough = argmin(low) over [pIdx..t] (earliest tie); scan k = trough … pIdx
  for the FIRST bar with close < open → OB; zone = [low_OB, high_OB]; SL level =
  low_OB − 0.1 × (high_OB − low_OB). Bear break — mirror (pIdx from `slT[t]`; crest
  = argmax(high); first bar with close > open; SL level = high_OB + 0.1 × range).
  No qualifying candle → NO_OB (slot cleared).
- **Fair Value Gap (NEW, frozen):** scan 3-candle windows (k, k+1, k+2) for
  k = t−2 DOWN TO pIdx (most-recent window first; the window must lie inside
  [pIdx..t], so k ≥ pIdx and k ≤ t−2; legs shorter than 3 bars produce no FVG).
  Bull event → bullish imbalance iff low[k+2] > high[k] → zone = [high[k], low[k+2]]
  (zoneLow = high[k], zoneHigh = low[k+2]). Bear event → bearish imbalance iff
  high[k+2] < low[k] → zone = [high[k+2], low[k]]. The FIRST qualifying window in the
  backward scan wins — exactly one FVG per event. SL level = far edge ∓ 0.1 ×
  (zoneHigh − zoneLow). No qualifying window → no FVG (slot cleared). No mitigation
  check is performed between window formation and placement (consistent with row 17's
  zone lifecycle: the zone lives until invalidation, and the pending order only
  exists from placement onward).
- For BOTH zone types: **proximal boundary** = zoneHigh for BULL zones, zoneLow for
  BEAR zones (price retraces INTO the zone from the distal side; the first touch of
  the proximal edge is the fill). **SL level** = far edge ∓ 0.1 × zone range.
  By construction R_abs = |boundary − SL| = 1.1 × zone range when filled at the
  boundary (a stated geometric invariant, useful as a test oracle).

### 5.4 Placement (frozen) — at the close of the event bar
At the close of 15m event bar t (placement instant T0 = t + 900,000), with the slots
just replaced by this event, evaluated ONCE per event, in this fixed order (first
failure logs its code and stops):
1. WARMUP — t's close before 2026-07-20T00:00Z (no placements in warmup);
2. NO_BIAS — bias UNKNOWN;
3. ZONE_DIR_MISMATCH — no slot's direction matches bias (BULL zones need bias UP,
   BEAR zones bias DOWN); both slots share the event's direction, so this is one
   check;
4. SKIPPED_PENDING — the pair already has a pending order;
5. POSITION_BUSY — the pair has an open position;
6. Zone-type selection when BOTH slots qualify: **OB takes precedence** (frozen);
   the FVG is logged SKIPPED_OB_PRIORITY and NOT placed;
7. PLACED_OB / PLACED_FVG — one limit order: BUY at boundary (BULL) or SELL at
   boundary (BEAR), with SL level as constructed, placed GTC-style with a frozen
   48h pending lifetime.
Placement is attempted exactly once per event, at the event bar's close. A zone whose
placement fails is never re-offered later (the next event replaces the slots).
Disclosure: a pending order is NOT cancelled by zone supersession or bias flip — the
prompt's cancellation list (invalidation, max pending duration) is treated as
exhaustive and is frozen as such.

### 5.5 Pending order lifecycle (frozen) — fill / void / expire
Fill checks run on the execution series (5m, or the 15m fallback), starting at the
first execution bar whose OPEN time ≥ T0 (the event bar's close coincides with the
5m grid, so the first such bar starts exactly at T0):

- **BUY limit:** bar OPEN ≤ SL level → VOID_GAP (gap over the entire zone before any
  fill — order cancelled; conservative: no modeling of instant-stop gap fills). Else
  bar OPEN ≤ boundary → **FILL at bar OPEN** (a real limit fills at the better open).
  Else bar LOW ≤ boundary → **FILL at boundary**.
- **SELL limit:** mirror — OPEN ≥ SL → VOID_GAP; OPEN ≥ boundary → FILL at OPEN;
  else HIGH ≥ boundary → FILL at boundary.
- **EXPIRED:** the first execution bar whose OPEN time ≥ T0 + 48h cancels the order
  (checked BEFORE that bar's fill logic; earlier bars fill normally). Wall-clock,
  including weekends (FX data has no Sat/Sun bars; a late-Friday placement can expire
  before the Monday open — frozen convention, disclosed).
- No other cancellation exists. The prompt's no-fill invalidation rule ("SL-level
  touch voids the zone") is unreachable BEFORE fill under proximal-boundary fills —
  any path to the SL level must first touch the boundary and fill — and is retained
  where it is live: as the post-fill SL barrier. This is documented reasoning, frozen
  at prereg time.
- One pending order OR one open position per pair at any time, never both, never two
  orders.
- **Fill-bar resolution (frozen, conservative):** the fill bar itself can resolve the
  trade. After the fill: SL touch (BUY: bar LOW ≤ SL; SELL: bar HIGH ≥ SL) → exit at
  SL (type SL); else TP touch → exit at TP (type TP); both → SL (same-candle
  worst-case, identical to the engine's contract). Rationale: intrabar path is
  unknown; no favorable ordering is ever assumed — the engine's own frozen rule,
  extended to the fill bar by the caller.
- **After the fill bar:** `resolveTripleBarrier(exec, firstIdx = fillIdx + 1,
  { direction, entry = fill, slPrice, tpPrice = fill ± 2 × R_abs, maxHoldMs =
  120 × 3,600,000, msPerBar = 300,000 (5m; 900,000 under fallback), entryTime = fill
  bar's CLOSE time, rAbs = |fill − SL| })`. Engine contract inherited UNCHANGED:
  inclusive touch, same-candle TP+SL → SL, TIMEOUT = close of the last bar in the
  hold window, CENSORED at data end, gap-fill sensitivity (`slGapFill`/`rOpen`)
  reported. TP = 2R is a SINGLE frozen value — no variant comparison, per the task.

### 5.6 Outcome categories (frozen)
- FILLED trades resolve to SL / TP / TIMEOUT / CENSORED (engine types). R =
  signed(exit − fill) / R_abs (LONG positive on gain; SHORT mirrored). SL = −1R by
  construction; TP = +2R; TIMEOUT ∈ (−1, 2).
- CENSORED trades are excluded from every expectancy statistic and reported by count.
- Unfilled orders: VOID_GAP, EXPIRED — own audit categories, NEVER counted as trades.
- **Fill rate** = FILLED / PLACED, reported prominently (pooled, per pair, per zone
  type) with its own Wilson 95% CI.

### 5.7 Funnel codes (fixed order, logged per event/order/trade)
WARMUP, NO_BIAS, ZONE_DIR_MISMATCH, SKIPPED_PENDING, POSITION_BUSY,
SKIPPED_OB_PRIORITY, PLACED_OB, PLACED_FVG, FILLED, VOID_GAP, EXPIRED, then per-trade
SL / TP / TIMEOUT / CENSORED.

## 6. Costs (frozen ASSUMPTIONS — identical to row 17 §4; flagged as assumptions, not broker guarantees)

- Spread, round-trip, charged once at fill, per pair: EUR/USD 1.0 pip, GBP/USD 1.5
  pips, USD/JPY 1.2 pips, AUD/USD 1.2 pips. Pip = 0.0001 (EUR/GBP/AUD quote),
  0.01 (JPY quote). spread_R = spread_pips × pip / R_abs.
  Note: the limit fill price comes from a mid/bid-side chart series; the frozen pip
  assumptions are broker-quote abstractions exactly as in row 17 — the spread is a
  property of the instrument, not of the entry mechanism.
- Overnight financing (swap): 1.0 pip per UTC midnight strictly crossed between fill
  time and exit time, charged flat for both directions (conservative simplification:
  real swaps are directional and sometimes credit; Wednesday 3× and 5pm-ET rollover
  conventions simplified away). swap_R = nights × 1.0 × pip / R_abs.
- Sensitivities reported: spread ×0.5 / ×2, swap ×0 / ×2, and combined worst case
  (spread ×2 + swap ×2). No slippage or commission beyond the assumed spread.
- Gross expectancy (no costs) AND net expectancy (after spread + swap) are BOTH
  reported; neither is collapsed into the other.

## 7. Statistics and gate (frozen — identical to row 17 §5)

- Unit: filled trade (R multiples). Pooled across pairs AND full per-pair and
  per-zone-type (OB / FVG) breakdowns always reported. TIE = R exactly 0.
- Win rate: WIN if R > 0, LOSS if R < 0; Wilson 95% CI on pooled, per-pair,
  per-zone-type and fill-rate proportions.
- Gross expectancy = mean gross R. Net expectancy = mean(R − spread_R − swap_R).
- Net expectancy CI: nonparametric bootstrap, 10,000 resamples, percentile 95%, fixed
  seed 20260912 (deterministic PRNG) — pooled, per-pair, per-zone-type.
- **GATE (primary, explicit): pooled net expectancy bootstrap 95% CI lower bound > 0
  → PASS, else FAIL.**
- Minimum-bucket-30: cells (pair, zone type, half) with < 30 resolved trades are
  flagged INSUFFICIENT and cannot certify that cell regardless of the pooled verdict.
- Halves split at 2026-08-16T00:00Z (row 17's A3 midpoint — same window, same split)
  reported with min-30 flags (stability lens).
- Geometry breakeven p_be = (1 + mean cost_R)/3 quoted for reference only (TP = 2R).
- No parameter changes, no additional filters, no alternate TP values after results
  are seen. If a genuine engine bug is discovered after the run, the fix and re-run
  are disclosed as such in the report (engine-vs-fixture discipline).

## 8. Deliverables

1. `src/strategy/autocalSignal.mjs` — the frozen engine (bias + zones + pending
   lifecycle), written only after this prereg is committed and pushed.
2. `scripts/autocal_tests.mjs` — fixtures and proofs, ALL PASSING before the run:
   OB bull/bear + NO_OB + BOTH fixtures (row 17 semantics), FVG bull/bear + backward-
   scan-first-window + leg-too-short fixtures, placement precedence (OB over FVG,
   pending-busy, position-busy, direction mismatch), fill-at-open vs fill-at-boundary,
   VOID_GAP, EXPIRY boundary (before/after 48h, weekend wall-clock), fill-bar SL/TP
   ordering, triple-barrier integration (SL / TP / same-candle / TIMEOUT / CENSORED),
   cost math, and no-lookahead proofs: 15m truncation + future-mutation invariance,
   1h close-boundary causality with positive/negative mutation controls, and 5m
   execution-series causality (decisions never read execution bars at or after the
   decision instant for zone/bias purposes; fills only read bars ≥ T0).
3. `backtest/autocal_backtest.mjs` — single-run runner writing
   `results/AUTOCAL_audit.jsonl` (+ .gz) with META / GATE / EV (event+zone) / ORD
   (placement) / PEND (fill/void/expire) / TRD (trade+costs) rows: every decision,
   every condition value, resolutions and R, per pair and zone type.
4. `results/AUTOCAL_REPORT.md` — fill rate prominent, gross AND net expectancy,
   Wilson CIs, per-pair and per-zone-type and halves tables with min-30 flags,
   decision funnel, cost sensitivities, explicit PASS/FAIL verdict against §7's
   gate, fully recomputable from the JSONL.

## 9. Phase 2 gate (deployment — only on PASS)

- If §7's gate FAILS: report plainly and STOP. No worker, no bot, no deployment.
- If §7's gate PASSES: deploy to a NEW Cloudflare Worker (separate from the existing
  FTT project's worker, which is not touched), with a NEW Telegram bot token (the FTT
  project's bot and its subscribers are not touched). BEFORE deployment: the demo /
  paper account status is explicitly confirmed (ambiguous account type = do not
  proceed). The live loop scans every 5 minutes (an operational detail — the
  backtest above already resolves every execution bar), places pending orders per the
  frozen strategy, and notifies via the new bot. Live phase = observation /
  paper-validation, NOT a profitability claim; no live parameter tuning without a new,
  separately pre-registered test.

## 10. Declarations

- No Autocal Signal strategy code existed at freeze time; only this prereg, the
  scaffold (README / AGENT_LOG / engine imports) and the 5m fetcher (mechanical I/O)
  precede the strategy implementation, and the fetcher's run postdates this commit.
- The 15m/1h datasets are byte-copies of row 17's (same fetch, same files); the 5m
  dataset is new but was NOT fetched or viewed (beyond the metadata probe of §3)
  before this commit.
- Credentials (GitHub / Cloudflare / broker / Telegram) are used by the implementer
  agent OUTSIDE repo content and are never committed to this repository.
- Single run of the frozen backtest over the frozen window. Results land in
  `results/AUTOCAL_audit.jsonl(.gz)` + `results/AUTOCAL_REPORT.md`.
- Branch `main` is pushed to GitHub and the push is verified; the remote commit hash
  of this prereg commit is recorded in the handoff so the freeze ordering
  (prereg → code → run) is independently verifiable.
