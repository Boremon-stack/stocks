"""Independent pandas/statsmodels implementation of the paper's statistics.

Usage: python test/reference_study.py PRICES.csv OUT.json [rf]

Written from the paper's equations only; it shares no code with public/js/backtest.js.
"""
import json
import sys

import numpy as np
import pandas as pd
import statsmodels.api as sm

path, out_path = sys.argv[1], sys.argv[2]
rf = float(sys.argv[3]) if len(sys.argv) > 3 else 0.065
FROM = sys.argv[4] if len(sys.argv) > 4 else None

df = pd.read_csv(path, parse_dates=["date"]).sort_values("date").reset_index(drop=True)
if FROM:
    df = df[df["date"] >= FROM].reset_index(drop=True)
close = df["close"].to_numpy()
d = df.assign(ym=df["date"].dt.to_period("M"))
d["r"] = df["close"].pct_change()
prev_close = df["close"].shift(1)
first_prev = prev_close.groupby(d["ym"]).first().fillna(close[0])
last = d.groupby("ym")["close"].last()
ret = (last / first_prev.reindex(last.index) - 1).to_numpy()
rv = np.array([float(((g["r"].dropna() - g["r"].dropna().mean()) ** 2).sum()) for _, g in d.groupby("ym")])
keys = [str(k) for k in last.index]
excess = ret - rf / 12
m = len(ret)


def slope(y, x):
    res = sm.OLS(y, sm.add_constant(x)).fit()
    return dict(
        n=len(y),
        corr=float(np.corrcoef(x, y)[0, 1]),
        slope=float(res.params[1]),
        tSlope=float(res.tvalues[1]),
        r2=float(res.rsquared),
    )


def paper_test(y, x):
    res = sm.OLS(y, sm.add_constant(x)).fit()
    alpha, beta = res.params
    rmse = float(np.sqrt(res.ssr / (len(y) - 2)))
    sr_old = x.mean() / x.std(ddof=1)
    app = alpha / rmse
    sr_new = np.sqrt(sr_old**2 + app**2)
    return dict(
        alphaAnnual=float(alpha * 12),
        beta=float(beta),
        tAlpha=float(res.tvalues[0]),
        r2=float(res.rsquared),
        appraisalAnnual=float(app * np.sqrt(12)),
        sharpeOriginal=float(sr_old * np.sqrt(12)),
        sharpeCombined=float(sr_new * np.sqrt(12)),
        utilityGain=float((sr_new**2 - sr_old**2) / sr_old**2) if sr_old > 0 else None,
    )


persistence = dict(rv=slope(rv[1:], rv[:-1]), logRv=slope(np.log(rv[1:]), np.log(rv[:-1])))
predictability = slope(excess[1:], rv[:-1])

order = sorted(range(1, m), key=lambda t: (rv[t - 1], t))
n_all = m - 1
k_drop = max(1, int(np.floor(0.05 * n_all)))
kept = np.array(order[: len(order) - k_drop])
predictability_trimmed = dict(trimmedShare=0.05, dropped=k_drop, **slope(excess[kept], rv[kept - 1]))
quintiles = []
for g, chunk in enumerate(np.array_split(np.array(order), 5)):
    quintiles.append(
        dict(
            group=g + 1,
            n=int(len(chunk)),
            avgLagRv=float(np.mean(rv[chunk - 1])),
            avgRv=float(np.mean(rv[chunk])),
            avgExcess=float(np.mean(excess[chunk])),
            meanVarianceRatio=float(np.mean(excess[chunk]) / np.mean(rv[chunk])),
        )
    )


def managed_series(cost, cap):
    f = excess[1:]
    raw = np.array([1 / rv[t - 1] if rv[t - 1] > 0 else 0.0 for t in range(1, m)])
    c = f.std(ddof=1) / (raw * f).std(ddof=1)
    w = np.minimum(cap, c * raw)
    prev = np.concatenate([[1.0], w[:-1]])
    return c, w, w * f - cost * np.abs(w - prev)


c, w, managed = managed_series(0.0, np.inf)
original = excess[1:]
sd_o, sd_m = original.std(ddof=1), managed.std(ddof=1)
sr_m = managed.mean() / sd_m * np.sqrt(12)
paper = paper_test(managed, original)
paper.update(
    c=float(c),
    sdOriginal=float(sd_o),
    sdManaged=float(sd_m),
    sharpeManaged=float(sr_m),
    sharpeIncrease=float(sr_m / paper["sharpeOriginal"] - 1),
    maxWeight=float(w.max()),
    meanWeight=float(w.mean()),
)

costs = []
for cap in [np.inf, 1.5, 1.0]:
    for cost in [0.0, 0.0001, 0.001, 0.002]:
        _, ww, mg = managed_series(cost, cap)
        t = paper_test(mg, original)
        costs.append(dict(cap=None if np.isinf(cap) else cap, cost=cost, alphaAnnual=t["alphaAnnual"], tAlpha=t["tAlpha"], appraisalAnnual=t["appraisalAnnual"]))

result = dict(n=m - 1, from_=keys[1], to=keys[-1], rf=rf, persistence=persistence, predictability=predictability, predictabilityTrimmed=predictability_trimmed, quintiles=quintiles, paper=paper, costs=costs)
with open(out_path, "w") as fh:
    json.dump(result, fh, indent=2)
print("study", path, "months", m - 1, "alpha", round(paper["alphaAnnual"], 5), "t", round(paper["tAlpha"], 3))
