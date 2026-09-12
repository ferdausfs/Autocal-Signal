# Autocal Signal

Pure price-action SMC strategy with **pending limit orders** at structure zones — no
indicators (no EMA/RSI/MACD/ATR/Bollinger). Structure and zones only.

This repository exists to answer ONE pre-registered question with ONE frozen backtest:

> Does entering via a PENDING LIMIT order at the boundary of a bias-aligned SMC zone
> (Order Block or Fair Value Gap), instead of entering on a confirming candle close,
> produce POSITIVE net expectancy (after FX CFD spread + overnight financing) on
> EUR/USD, GBP/USD, USD/JPY, AUD/USD?

**GATE (frozen in `prereg/PREREG_AUTOCAL_SIGNAL.md` before any strategy code existed):
pooled net-expectancy bootstrap 95% CI lower bound > 0 → PASS, else FAIL.**
A FAIL is reported plainly and the project stops — no deployment, no rescue, no
post-hoc parameter changes.

## Discipline (inherited from the Ftt-Otc-v6 project, never re-litigated there)

1. **Pre-registration before code** — the frozen spec is committed and pushed BEFORE
   any strategy implementation exists.
2. **One run** — the frozen backtest runs ONCE on the frozen window. No parameter
   tuning after seeing results. A genuine engine bug found after the run is disclosed
   as such (engine-vs-fixture discipline).
3. **Raw evidence** — every decision (zones, placements, fills, voids, expiries,
   exits, costs) is logged to `results/AUTOCAL_audit.jsonl`; the report must be
   recomputable from that file alone.
4. **Test-then-deploy** — Phase 2 (demo deployment) happens ONLY if Phase 1's gate
   passes. A demo account has no capital risk, but deploying an unvalidated strategy
   still teaches the wrong lesson.
5. **Fresh repo, same scoreboard** — see `AGENT_LOG.md`; cumulative evidence lives in
   the Ftt-Otc-v6 project scoreboard (17 tests, 0 PASS as of this repo's creation —
   including SMC-CFD-1H, the market-on-close sibling of this test).

## Reused engines (byte-identical imports, sha256-verified)

| File | Source | sha256 (prefix) |
|------|--------|-----------------|
| `src/strategy/marketStructure.mjs` | `Ftt-Otc-v6` @ `origin/feature/market-structure` | `834d79a0ba94281a…` |
| `backtest/tripleBarrier.mjs` | `Ftt-Otc-v6` @ `origin/feature/frvp-rr` | `b7761bcd24347102…` |

Neither file is modified in this repository. Byte-identity is part of the frozen
pre-registration.

## Repository map

```
prereg/PREREG_AUTOCAL_SIGNAL.md   frozen spec (commit order proves it precedes all code)
src/strategy/marketStructure.mjs  imported engine (pivot/BOS/CHoCH, L=5)
src/strategy/autocalSignal.mjs    frozen strategy (bias + zones + pending orders)
backtest/tripleBarrier.mjs        imported engine (R:R triple-barrier exits)
backtest/fetch_autocal_5m.py      5m execution-series fetcher + quality gates
backtest/data/                    frozen datasets (15m/1h copies + 5m execution)
scripts/autocal_tests.mjs         fixture + no-lookahead test suite (must PASS pre-run)
backtest/autocal_backtest.mjs     single-run backtest runner
results/AUTOCAL_audit.jsonl(.gz)  raw per-decision audit log
results/AUTOCAL_REPORT.md         the verdict
```

## Status

- Phase 1 (backtest): see `results/AUTOCAL_REPORT.md`.
- Phase 2 (demo deployment): **forbidden unless Phase 1's gate PASSES.**
