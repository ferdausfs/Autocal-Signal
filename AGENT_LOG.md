# Autocal-Signal — Agent Log

Running record of every task, decision and verification in this repository.
Convention inherited from the Ftt-Otc-v6 project: append-only, one section per
task, results never re-litigated — a closed finding gets a new pre-registered
test, never an edit.

---

## 2026-09-12T15:35Z — Task 1: Repository creation + byte-identical engine imports

**Task:** Create the `Autocal-Signal` repository (Phase 0 of the user's agent
prompt) and import the two mandated engines unchanged, before any pre-registration
or strategy code exists.

**Work log:**

- GitHub repo `ferdausfs/Autocal-Signal` created (public) via API. Two tokens were
  supplied by the user in the task text: the first failed authentication
  (`401 Bad credentials`), the second authenticated as `ferdausfs` and was used for
  repo creation and all pushes. Tokens are never written into any committed file.
- `src/strategy/marketStructure.mjs` imported from `Ftt-Otc-v6` @
  `origin/feature/market-structure` — extracted with `git show` from the exact ref,
  sha256 `834d79a0ba94281a48af7cc21be98f1eaa6825161ca870b1e28e9895a5a44b72`.
- `backtest/tripleBarrier.mjs` imported from `Ftt-Otc-v6` @ `origin/feature/frvp-rr`
  — same procedure, sha256
  `b7761bcd24347102ea5ee5d347df1d57a98c706588de6f1fa073bb50fb30d0eb`.
- Byte-identity cross-check: the working-tree copies on `Ftt-Otc-v6`'s
  `feature/smc-cfd-1h` branch (which SMC-CFD-1H's prereg already certified as
  byte-identical to those refs) hash to the same two digests. The digests above are
  recorded in the pre-registration.
- Probe (metadata only, no strategy-relevant data viewed): Yahoo 5m FX series is
  available for the evaluable window (EURUSD=X: 12,187 rows, 98.7% valid OHLC,
  2026-07-15 → 2026-09-11). This enables 5m fill resolution — finer than the 15m
  used by SMC-CFD-1H — and is frozen into the pre-registration with per-pair
  quality gates and a pre-run fallback rule.

**Stage summary:**

- Repo scaffolded; engines imported byte-identical; NOTHING else exists yet.
- Next: pre-registration commit (frozen constants), pushed and hash-verified BEFORE
  any strategy code is written.

---

## 2026-09-12T17:50Z — Task 2: Frozen implementation, single run, GATE FAIL

**Task:** Implement the pre-registered strategy (only after the prereg commit was
pushed), pass the full test suite, run the frozen backtest ONCE, report the verdict.

**Work log:**

- `src/strategy/autocalSignal.mjs` written strictly from prereg §5 (no free
  parameters): 1h bias via the imported engine (L=5, close-time causal), most-recent-
  event zone slots (OB = row-17 construction verbatim; FVG = frozen 3-candle
  backward scan), placement precedence per §5.4, pending lifecycle per §5.5
  (open-beyond-SL → VOID_GAP; open-beyond-limit → fill at open; touch → fill at
  boundary; EXPIRED at T0+48h checked before fill logic), fill-bar rule (SL first,
  then TP, both → SL), exits via the imported tripleBarrier (TP=2R, 120h, CENSORED
  honored), costs per §6.
- `scripts/autocal_tests.mjs`: **39/39 PASS** before the run. Fixture iterations
  were all fixture bugs, engine never wrong: flat candle runs mint tied pivots
  (event fired at the wrong bar until the leg was made strictly monotone); a break
  bar inside its own pivot window always destroys the pivot (1h fixtures moved the
  break one bar past confirmation); a vertical mirror must swap high/low. Includes
  15m truncation + future-mutation invariance, 1h close-boundary causality with
  positive AND negative controls, execution-series causality (pre-T0 exec bars
  provably never affect the order), and engine-vs-pure-oracle agreement.
- RAN the frozen backtest ONCE. Funnel: 816 events → 176 orders placed (169 OB,
  7 FVG) → 142 filled (fill rate 80.7% [74.2, 85.8]), 30 expired, 4 gap-voids →
  141 resolved trades (+1 censored). Exit mix SL 94 / TP 46 / TIMEOUT 1.
- RESULT: **GATE FAIL.** Pooled net −0.4742R, bootstrap 95% CI [−0.7090, −0.2351];
  pooled gross −0.0103R [−0.2443, +0.2244] — no edge BEFORE costs; WR 33.3%
  [26.1, 41.5] = exactly the zero-cost 2R breakeven. All four pairs net-negative;
  halves stably negative; robust to spread ×0.5 and swap ×0.
- Key mechanical finding: the boundary fill is a BETTER entry price than row 17's
  confirming close (gross improved −0.105R → −0.010R) but it is also the TIGHTEST
  possible structural stop for the same zone (mean R_abs ≈ 2 pips), so the frozen
  1-pip spread became 0.438R/trade (vs 0.228R in row 17) — the mechanism that
  improved the entry doubled the cost burden per R. Net moved −0.333R → −0.474R.
- **Phase 2 NOT triggered** (prereg §9): no worker, no bot, no demo deployment.
  Cloudflare credentials supplied with the task were never used and are not stored
  anywhere in this repository.

**Stage summary:**

- AUTOCAL-1 = FAIL. Scoreboard row 18: 18 tests, 0 PASS. Fifth SMC-family failure;
  the fill mechanism was the last untested degree of freedom of the 1h-bias +
  15m-zone skeleton and did not rescue it.
- Artifacts: results/AUTOCAL_audit.jsonl(.gz) + AUTOCAL_summary.json +
  AUTOCAL_REPORT.md. Everything reproducible from the committed data + JSONL.
