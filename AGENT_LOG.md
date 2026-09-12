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
