#!/usr/bin/env python3
"""Independent reference for the dcaVsVm extras.

Usage:
  python test/reference_dcavm_extras.py <csv> <out.json> [monthly] [maxExposure] [costBps]

The owner's script supplies the daily frame (prices, contributions, VM targets).
Every extra, the DCA and VM ledgers and the control plan are computed here.
The owner's equities and returns and summary metrics are used only as checks.
"""
import importlib.util
import math
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import brentq

OWNER_SCRIPT = Path("C:/Users/seal/AppData/Local/Temp/claude/user_ref/user_script.py")
TRADING_DAYS = 252
TOL = 1e-9


def load_owner():
    spec = importlib.util.spec_from_file_location("owner_script", OWNER_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def iso(ts):
    return pd.Timestamp(ts).strftime("%Y-%m-%d")


def finish_returns(equity, contrib):
    ret = np.full(len(equity), np.nan)
    for i in range(1, len(equity)):
        if equity[i - 1] > 0:
            ret[i] = (equity[i] - contrib[i]) / equity[i - 1] - 1.0
    return ret


def simulate_dca(dates, prices, contrib, cost_bps):
    n = len(prices)
    shares = cash = 0.0
    eq = np.zeros(n)
    sh = np.zeros(n)
    fee = np.zeros(n)
    buy = np.zeros(n)
    bought_shares = np.zeros(n)
    for i in range(n):
        p = prices[i]
        cash += contrib[i]
        buy[i] = cash
        fee[i] = cash * cost_bps / 10000.0
        bought_shares[i] = max(cash - fee[i], 0.0) / p
        shares += bought_shares[i]
        cash = 0.0
        sh[i] = shares
        eq[i] = shares * p + cash
    return {
        "equity": eq, "shares": sh, "cash": np.zeros(n), "fee": fee, "buy": buy,
        "shares_bought": bought_shares, "returns": finish_returns(eq, contrib), "trades": [],
    }


def simulate_vm(dates, prices, contrib, targets, cost_bps):
    n = len(prices)
    shares = cash = 0.0
    eq = np.zeros(n)
    sh = np.zeros(n)
    cs = np.zeros(n)
    fee = np.zeros(n)
    buy = np.zeros(n)
    bought_shares = np.zeros(n)
    trades = []
    for i in range(n):
        p = prices[i]
        c = contrib[i]
        cash += c
        if c > 0:
            current = shares * p
            trade = (shares * p + cash) * targets[i] - current
            side = None
            value = 0.0
            f = 0.0
            if trade > 0:
                side = "buy"
                value = min(trade, cash)
                f = value * cost_bps / 10000.0
                bought_shares[i] = max(value - f, 0.0) / p
                shares += bought_shares[i]
                cash -= value
                buy[i] = value
            elif trade < 0:
                side = "sell"
                value = min(-trade, current)
                f = value * cost_bps / 10000.0
                shares -= value / p
                cash += value - f
            fee[i] = f
            if side is not None and abs(trade) > TOL:
                after = shares * p
                trades.append({
                    "date": iso(dates[i]), "side": side, "value": float(value), "price": float(p),
                    "fee": float(f), "shareAfter": float(after / (after + cash)), "target": float(targets[i]),
                })
        eq[i] = shares * p + cash
        sh[i] = shares
        cs[i] = cash
    return {
        "equity": eq, "shares": sh, "cash": cs, "fee": fee, "buy": buy,
        "shares_bought": bought_shares, "returns": finish_returns(eq, contrib), "trades": trades,
    }


def drawdown_episodes(dd, dates):
    underwater = dd < 0
    n = len(dd)
    runs = []
    i = 0
    while i < n:
        if underwater[i]:
            s = i
            while i + 1 < n and underwater[i + 1]:
                i += 1
            runs.append((s, i))
        i += 1
    episodes = []
    for s, e in runs:
        peak = s - 1
        trough = s + int(np.argmin(dd[s:e + 1]))
        recovered = e + 1 < n
        rec = e + 1
        episodes.append({
            "peakDate": iso(dates[peak]),
            "troughDate": iso(dates[trough]),
            "endDate": iso(dates[rec]) if recovered else None,
            "depth": float(dd[trough]),
            "tradingDaysToTrough": trough - peak,
            "tradingDaysToRecover": (rec - trough) if recovered else None,
            "tradingDaysUnder": e - s + 1,
        })
    episodes.sort(key=lambda x: x["depth"])
    longest = max((e - s + 1 for s, e in runs), default=0)
    return episodes[:3], longest


def money_weighted_return(dates, contrib, ending):
    cf = -contrib.astype(float)
    cf[-1] += ending
    t = np.array([(pd.Timestamp(d) - pd.Timestamp(dates[0])).days for d in dates]) / 365.0
    mask = cf != 0
    f = lambda r: float(np.sum(cf[mask] * (1.0 + r) ** (-t[mask])))
    try:
        return float(brentq(f, -0.99, 10.0))
    except ValueError:
        return None


def plan_metrics(sim, dates, prices, contrib):
    eq = sim["equity"]
    r = sim["returns"][1:]
    growth = np.cumprod(1.0 + r)
    years = len(r) / TRADING_DAYS
    g_last = growth[-1]
    cagr = g_last ** (1.0 / years) - 1.0 if years > 0 and g_last > 0 else float("nan")
    ann_vol = np.std(r, ddof=1) * math.sqrt(TRADING_DAYS)
    sharpe = np.mean(r) * TRADING_DAYS / ann_vol if ann_vol > 0 else float("nan")
    nav = np.concatenate([[1.0], growth])
    dd = nav / np.maximum.accumulate(nav) - 1.0
    max_dd = float(dd.min())
    ending = float(eq[-1])
    total_contrib = float(contrib.sum())
    episodes, longest = drawdown_episodes(dd, dates)
    return {
        "endingEquity": ending,
        "totalContributions": total_contrib,
        "profit": ending - total_contrib,
        "twrCumulative": float(g_last - 1.0),
        "twrCagr": float(cagr),
        "annVol": float(ann_vol),
        "sharpe": float(sharpe),
        "maxDrawdown": max_dd,
        "calmar": float(cagr / abs(max_dd)) if max_dd != 0 else None,
        "troughDate": iso(dates[int(np.argmin(dd))]),
        "longestUnderwaterDays": longest,
        "drawdownEpisodes": episodes,
        "worstDay": float(r.min()),
        "bestDay": float(r.max()),
        "avgExposure": float(np.mean(sim["shares"] * prices / eq)),
        "costTotal": float(sim["fee"].sum()),
        "moneyWeightedReturn": money_weighted_return(dates, contrib, ending),
    }


def dca_block(sim, dates, prices, contrib, monthly):
    metrics = plan_metrics(sim, dates, prices, contrib)
    idx = np.where(contrib > 0)[0]
    total_bought = float(sim["buy"].sum())
    shares_bought_total = float(sim["shares_bought"].sum())
    metrics["investments"] = {
        "purchases": int(len(idx)),
        "perPurchase": float(monthly),
        "totalContributions": float(contrib.sum()),
        "totalBought": total_bought,
        "fees": float(sim["fee"].sum()),
        "totalShares": float(sim["shares"][-1]),
        "averageBuyPrice": total_bought / shares_bought_total,
        "finalIndexValue": float(sim["shares"][-1] * prices[-1]),
        "cashLeft": float(sim["cash"][-1]),
    }
    metrics["purchaseList"] = [
        {
            "date": iso(dates[i]), "amount": float(sim["buy"][i]), "price": float(prices[i]),
            "fee": float(sim["fee"][i]), "shares": float(sim["shares_bought"][i]),
        }
        for i in idx
    ]
    return metrics


def vm_investments(sim, prices, targets, contrib_idx, dates, contrib):
    trades = sim["trades"]
    value_series = sim["shares"] * prices
    bought = sum(t["value"] for t in trades if t["side"] == "buy")
    sold = sum(t["value"] for t in trades if t["side"] == "sell")
    return {
        "contributions": int(len(contrib_idx)),
        "totalContributions": float(contrib.sum()),
        "rebalances": int(len(contrib_idx)),
        "trades": len(trades),
        "buys": sum(1 for t in trades if t["side"] == "buy"),
        "sells": sum(1 for t in trades if t["side"] == "sell"),
        "totalBought": float(bought),
        "totalSold": float(sold),
        "turnover": float(bought + sold),
        "fees": float(sim["fee"].sum()),
        "averageTargetExposure": float(np.mean(targets[contrib_idx])),
        "averageInIndex": float(value_series.mean()),
        "peakInIndex": float(value_series.max()),
        "lowestInIndex": float(value_series.min()),
        "finalIndexValue": float(value_series[-1]),
        "cashLeft": float(sim["cash"][-1]),
    }


def vm_block(sim, dates, prices, contrib, targets, contrib_idx):
    metrics = plan_metrics(sim, dates, prices, contrib)
    metrics["investments"] = vm_investments(sim, prices, targets, contrib_idx, dates, contrib)
    metrics["tradeList"] = sim["trades"]
    return metrics


def check(name, got, want):
    if not np.allclose(np.asarray(got, dtype=float), np.asarray(want, dtype=float),
                       rtol=1e-9, atol=1e-9, equal_nan=True):
        raise SystemExit(f"self-check failed: {name}")


def clean(o):
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [clean(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (float, np.floating)):
        return float(o) if math.isfinite(float(o)) else None
    return o


def main(argv):
    csv_path, out_path = argv[1], argv[2]
    monthly = float(argv[3]) if len(argv) > 3 else 10000.0
    max_exposure = float(argv[4]) if len(argv) > 4 else 1.0
    cost_bps = float(argv[5]) if len(argv) > 5 else 0.0

    owner = load_owner()
    prices_series = owner.load_prices(csv_path)
    daily, _, owner_metrics = owner.run_backtest(
        prices_series, monthly_amount=monthly, max_exposure=max_exposure, cost_bps=cost_bps
    )

    dates = list(daily.index)
    prices = daily["Price"].to_numpy(dtype=float)
    contrib = daily["DCA_contribution"].to_numpy(dtype=float)
    targets = daily["VM_target_exposure"].to_numpy(dtype=float)
    contrib_idx = np.where(contrib > 0)[0]

    dca = simulate_dca(dates, prices, contrib, cost_bps)
    vm = simulate_vm(dates, prices, contrib, targets, cost_bps)
    check("DCA equity", dca["equity"], daily["DCA_equity"])
    check("VM equity", vm["equity"], daily["VM_equity"])
    check("DCA return", dca["returns"], daily["DCA_return"])
    check("VM return", vm["returns"], daily["VM_return"])

    constant = float(np.mean(targets[contrib_idx]))
    ctl_targets = np.full(len(prices), constant)
    ctl = simulate_vm(dates, prices, contrib, ctl_targets, cost_bps)

    dca_out = dca_block(dca, dates, prices, contrib, monthly)
    vm_out = vm_block(vm, dates, prices, contrib, targets, contrib_idx)
    ctl_out = vm_block(ctl, dates, prices, contrib, ctl_targets, contrib_idx)
    ctl_out["share"] = constant

    for plan_out, row in ((dca_out, 0), (vm_out, 1)):
        check("ending equity", plan_out["endingEquity"], owner_metrics.iloc[row]["Ending equity (INR)"])
        check("twr cagr", plan_out["twrCagr"], owner_metrics.iloc[row]["TWR CAGR"])
        check("ann vol", plan_out["annVol"], owner_metrics.iloc[row]["Annualized volatility"])
        check("sharpe", plan_out["sharpe"], owner_metrics.iloc[row]["Sharpe (risk-free=0)"])
        check("max dd", plan_out["maxDrawdown"], owner_metrics.iloc[row]["Maximum drawdown"])

    timing = {
        "endingEquityDiff": vm_out["endingEquity"] - ctl_out["endingEquity"],
        "sharpeDiff": vm_out["sharpe"] - ctl_out["sharpe"],
        "maxDrawdownDiff": vm_out["maxDrawdown"] - ctl_out["maxDrawdown"],
        "twrCagrDiff": vm_out["twrCagr"] - ctl_out["twrCagr"],
    }

    result = clean({"dca": dca_out, "vm": vm_out, "control": ctl_out, "timingEffect": timing})
    Path(out_path).write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")

    print(f"params: monthly={monthly} maxExposure={max_exposure} costBps={cost_bps}")
    print(f"vm endingEquity: {vm_out['endingEquity']!r}")
    print(f"control endingEquity: {ctl_out['endingEquity']!r}")
    print(f"vm trades={vm_out['investments']['trades']} buys={vm_out['investments']['buys']} "
          f"sells={vm_out['investments']['sells']}")
    print(f"vm totalBought={vm_out['investments']['totalBought']!r} totalSold={vm_out['investments']['totalSold']!r}")
    print(f"control.share: {constant!r}")
    print(f"timingEffect: {timing}")
    print(f"dca moneyWeightedReturn: {dca_out['moneyWeightedReturn']!r}")
    print(f"dca first episode: {dca_out['drawdownEpisodes'][0]}")
    print(f"vm first episode: {vm_out['drawdownEpisodes'][0]}")
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main(sys.argv)
