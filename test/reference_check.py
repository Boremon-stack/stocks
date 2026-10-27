"""Independent pandas/numpy/statsmodels implementation of the strategy.

Usage: python test/reference_check.py PRICES.csv OUT.json [rf] [cost]

It does not import or share any code with public/js/backtest.js. The JS tests
compare the engine against the JSON this script writes.
"""
import json
import sys

import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy import stats as sst
from statsmodels.stats.diagnostic import acorr_ljungbox

path = sys.argv[1]
out_path = sys.argv[2]
rf = float(sys.argv[3]) if len(sys.argv) > 3 else 0.065
cost = float(sys.argv[4]) if len(sys.argv) > 4 else 0.001

df = pd.read_csv(path, parse_dates=["date"]).sort_values("date").reset_index(drop=True)
close = df["close"].to_numpy()
W = 20


def summ(x, ppy):
    x = np.asarray(x)
    eq = np.cumprod(1 + x)
    peak = np.maximum.accumulate(np.concatenate([[1.0], eq]))[1:]
    sd = x.std(ddof=1)
    return dict(
        periods=len(x),
        cumulative=float(eq[-1] - 1),
        cagr=float(eq[-1] ** (ppy / len(x)) - 1),
        annVol=float(sd * np.sqrt(ppy)),
        sharpe=float((x.mean() - rf / ppy) / sd * np.sqrt(ppy)),
        maxDrawdown=float((eq / peak - 1).min()),
    )


def paper_test(managed_excess, original_excess, ppy):
    y = np.asarray(managed_excess)
    x = np.asarray(original_excess)
    res = sm.OLS(y, sm.add_constant(x)).fit()
    alpha, beta = res.params
    rmse = float(np.sqrt(res.ssr / (len(y) - 2)))
    sr_old = x.mean() / x.std(ddof=1)
    app = alpha / rmse
    sr_new = np.sqrt(sr_old**2 + app**2)
    return dict(
        n=len(y),
        alphaAnnual=float(alpha * ppy),
        beta=float(beta),
        tAlpha=float(res.tvalues[0]),
        r2=float(res.rsquared),
        rmse=rmse,
        appraisalAnnual=float(app * np.sqrt(ppy)),
        sharpeOriginal=float(sr_old * np.sqrt(ppy)),
        sharpeCombined=float(sr_new * np.sqrt(ppy)),
        utilityGain=float((sr_new**2 - sr_old**2) / sr_old**2) if sr_old > 0 else None,
    )


r = np.concatenate([[0.0], close[1:] / close[:-1] - 1])

# ---- daily rule (the 20-day workflow) ----
INITIAL = 100000.0


def value_path(returns, fees):
    v = INITIAL
    total = 0.0
    for x, f in zip(returns, fees):
        total += v * f
        v *= 1 + x
    return float(v), float(total)


def run_daily(window, lo, hi):
    v = pd.Series(r**2).rolling(window).mean().to_numpy()
    start = window
    split = start + int((len(r) - start) * 0.7)
    c_d = float(np.nanmean(v[start:split]))
    w = np.zeros(len(r))
    for t in range(start, len(r) - 1):
        w[t + 1] = min(hi, max(lo, c_d / v[t]))
    frm = start + 1
    bh = r[frm:]
    ww = w[frm:]
    prev = np.concatenate([[0.0], ww[:-1]])
    fee = cost * np.abs(ww - prev)
    strat = ww * bh - fee
    sp = split - frm
    rfd = rf / 252
    final_st, total_cost = value_path(strat, fee)
    final_bh, _ = value_path(bh, np.zeros(len(bh)))
    vol0 = float(np.sqrt(v[frm - 1] * 252))
    return dict(
        c=c_d,
        window=window,
        oos_bh=summ(bh[sp:], 252),
        oos_st=summ(strat[sp:], 252),
        is_bh=summ(bh[:sp], 252),
        is_st=summ(strat[:sp], 252),
        reg_full=paper_test(strat - rfd, bh - rfd, 252),
        reg_test=paper_test(strat[sp:] - rfd, bh[sp:] - rfd, 252),
        final_strategy_value=final_st,
        final_buyhold_value=final_bh,
        total_cost=total_cost,
        first_vol=vol0,
        first_weight=float(ww[0]),
        mean_weight=float(ww.mean()),
        min_weight=float(ww.min()),
        max_weight=float(ww.max()),
    )


daily = run_daily(W, 0.0, 1.0)
daily_alt = run_daily(40, 0.2, 0.9)

# ---- monthly paper rule: equations (1) and (2) ----
d = df.assign(ym=df["date"].dt.to_period("M"))
d["r"] = df["close"].pct_change()
prev_close = df["close"].shift(1)
first_prev = prev_close.groupby(d["ym"]).first().fillna(close[0])
last = d.groupby("ym")["close"].last()
ret = (last / first_prev.reindex(last.index) - 1).to_numpy()
rv = np.array(
    [
        float(((g["r"].dropna() - g["r"].dropna().mean()) ** 2).sum())
        for _, g in d.groupby("ym")
    ]
)
excess = ret - rf / 12
n = len(ret) - 1
msplit = 1 + int(n * 0.7)
raw = np.array([1 / rv[m - 1] if rv[m - 1] > 0 else 0.0 for m in range(1, len(ret))])


def monthly_run(upto):
    f = excess[1:upto]
    c = f.std(ddof=1) / (raw[: upto - 1] * f).std(ddof=1)
    wm = c * raw
    prevw = np.concatenate([[1.0], wm[:-1]])
    managed = wm * excess[1:] - cost * np.abs(wm - prevw)
    return float(c), managed


c_m, managed = monthly_run(msplit)
c_full, managed_full = monthly_run(len(ret))
st_total = managed + rf / 12
bhm = ret[1:]
ms = msplit - 1
final_m, total_cost_m = value_path(st_total, cost * np.abs(c_m * raw - np.concatenate([[1.0], (c_m * raw)[:-1]])))
final_bh_m, _ = value_path(bhm, np.zeros(len(bhm)))
monthly = dict(
    final_strategy_value=final_m,
    final_buyhold_value=final_bh_m,
    total_cost=total_cost_m,
    c=c_m,
    c_full=c_full,
    oos_bh=summ(bhm[ms:], 12),
    oos_st=summ(st_total[ms:], 12),
    is_bh=summ(bhm[:ms], 12),
    is_st=summ(st_total[:ms], 12),
    reg_full=paper_test(managed, excess[1:], 12),
    reg_test=paper_test(managed[ms:], excess[1:][ms:], 12),
    reg_full_normalized_full_sample=paper_test(managed_full, excess[1:], 12),
)

# ---- return statistics ----
rr = r[1:]
lb = acorr_ljungbox(rr**2, lags=[10], return_df=True)
jb = sst.jarque_bera(rr)
stats = dict(
    mean=float(rr.mean()),
    sd=float(rr.std(ddof=1)),
    skewness=float(sst.skew(rr, bias=True)),
    excessKurtosis=float(sst.kurtosis(rr, bias=True)),
    jarqueBera=float(jb.statistic),
    ljungBoxQ=float(lb["lb_stat"].iloc[0]),
    ljungBoxP=float(lb["lb_pvalue"].iloc[0]),
)

result = dict(rows=len(df), rf=rf, cost=cost, initial=INITIAL, daily=daily, daily_alt=daily_alt, monthly=monthly, stats=stats)
with open(out_path, "w") as fh:
    json.dump(result, fh, indent=2)
print(f"wrote {out_path}")
print("daily OOS managed CAGR", daily["oos_st"]["cagr"], "bh", daily["oos_bh"]["cagr"])
print("monthly OOS managed CAGR", monthly["oos_st"]["cagr"], "bh", monthly["oos_bh"]["cagr"])
print("monthly full-sample alpha (annual)", monthly["reg_full"]["alphaAnnual"], "beta", monthly["reg_full"]["beta"])
