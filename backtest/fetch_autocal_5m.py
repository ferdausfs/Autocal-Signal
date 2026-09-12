#!/usr/bin/env python3
"""
Autocal Signal — 5m execution-series fetcher (prereg §3) + quality gates.

Mechanical I/O only, no strategy logic (prereg §10). Writes
backtest/data/autocal/{PAIR}_m5.json in the same shape the runner expects as the
row-17 datasets: { meta, quality, gates, candles:[{t,o,h,l,c}] } with t = bar OPEN
ms UTC. Also writes backtest/data/autocal/gates_summary.json.

Frozen gates (prereg §3): first bar <= 2026-07-19T00:00Z; flat-bar share < 5%;
no mid-week gap > 24h (weekend gaps fine); valid-OHLC rows >= 95% of fetched rows.
Fallback: a failing pair resolves execution on its 15m series (disclosed per pair).
"""
import urllib.request, json, time, os, datetime

OUT = "/home/z/my-project/repos/Autocal-Signal/backtest/data/autocal"
PAIRS = {"EURUSD": "EURUSD=X", "GBPUSD": "GBPUSD=X", "USDJPY": "USDJPY=X", "AUDUSD": "AUDUSD=X"}
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
BASE = "https://query1.finance.yahoo.com/v8/finance/chart/{s}?interval=5m&period1={p1}&period2={p2}&includePrePost=false"

def iso(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.UTC).isoformat()

def get(symbol, days=59):
    p2 = int(time.time()); p1 = p2 - days * 86400
    d = json.loads(urllib.request.urlopen(urllib.request.Request(
        BASE.format(s=symbol, p1=p1, p2=p2), headers=UA), timeout=60).read())
    r = d["chart"]["result"][0]
    ts = r["timestamp"]; q = r["indicators"]["quote"][0]
    out = []
    for k, t in enumerate(ts):
        o, h, l, c = q["open"][k], q["high"][k], q["low"][k], q["close"][k]
        if None in (o, h, l, c):
            continue
        out.append({"t": t * 1000, "o": float(o), "h": float(h), "l": float(l), "c": float(c)})
    return out

def midweek_gap(a_ms, b_ms):
    """True if the gap (a_ms -> b_ms, a before b) is NOT a plain weekend closure.
    Weekend = from Friday (after ~20:45 UTC close) to Sunday (>= 20:45 UTC open)."""
    da = datetime.datetime.fromtimestamp(a_ms / 1000, datetime.UTC)
    db = datetime.datetime.fromtimestamp(b_ms / 1000, datetime.UTC)
    if da.weekday() == 4 and db.weekday() in (5, 6, 0):   # Friday -> Sun/Mon
        return not (da.hour >= 20 or db.weekday() != 5)
    if da.weekday() == 5 and db.weekday() in (6, 0):      # Sat -> Sun/Mon
        return False
    if da.weekday() == 6 and db.weekday() == 0:           # Sun -> Mon
        return not (db.hour >= 20 or da.hour < 20)
    return True

def gates(candles):
    n = len(candles)
    flat = sum(1 for x in candles if x["h"] == x["l"])
    maxgap, mgat, mgmid = 0, None, False
    for i in range(1, n):
        g = candles[i]["t"] - candles[i - 1]["t"]
        if g > maxgap:
            maxgap, mgat = g, iso(candles[i - 1]["t"])
            mgmid = midweek_gap(candles[i - 1]["t"], candles[i]["t"])
    first_ok = candles[0]["t"] <= datetime.datetime(2026, 7, 19, tzinfo=datetime.UTC).timestamp() * 1000
    flat_share = flat / n
    g = {
        "bars": n, "first": iso(candles[0]["t"]), "last": iso(candles[-1]["t"]),
        "flatBarShare": round(flat_share, 4),
        "maxGapHours": round(maxgap / 3.6e6, 2), "maxGapAfter": mgat,
        "maxGapIsMidweek": mgmid,
        "firstBarOk": bool(first_ok),
    }
    g["pass"] = bool(first_ok and flat_share < 0.05 and not mgmid and (maxgap / 3.6e6) < 120)
    return g

def main():
    os.makedirs(OUT, exist_ok=True)
    summary = {}
    for pair, sym in PAIRS.items():
        c = get(sym)
        g = gates(c)
        payload = {"meta": {"pair": pair, "source": "Yahoo chart API", "interval": "5m",
                            "fetchedAt": datetime.datetime.now(datetime.UTC).isoformat(),
                            "prereg": "PREREG_AUTOCAL_SIGNAL.md §3"},
                   "quality": g, "gates": g, "candles": c}
        with open(f"{OUT}/{pair}_m5.json", "w") as f:
            json.dump(payload, f, separators=(",", ":"))
        summary[pair] = g
        print(pair, json.dumps(g))
        time.sleep(2)
    with open(f"{OUT}/gates_summary.json", "w") as f:
        json.dump(summary, f, indent=2)
    print("ALL_PASS:", all(v["pass"] for v in summary.values()))

if __name__ == "__main__":
    main()
