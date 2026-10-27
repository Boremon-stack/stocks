"""Independent pandas/scipy implementation of the SIP versus volatility-based comparison.

Usage: python test/reference_compare.py PRICES.csv OUT.json [months] [monthly|daily] [startDate]

Written from the specification only; it shares no code with public/js/backtest.js.
"""
import json
import sys

import numpy as np
import pandas as pd
from scipy.optimize import brentq

path, out_path = sys.argv[1], sys.argv[2]
MONTHS = int(sys.argv[3]) if len(sys.argv) > 3 else 60
REBALANCE = sys.argv[4] if len(sys.argv) > 4 else 'monthly'
START = sys.argv[5] if len(sys.argv) > 5 else None
POOL, SIP, WINDOW, LO, HI = 1_000_000.0, 10_000.0, 20, 0.0, 1.0
COST, CASH = 0.001, 0.065

df = pd.read_csv(path, parse_dates=["date"]).sort_values("date").reset_index(drop=True)
P = df["close"].to_numpy()
dates = df["date"].dt.strftime("%Y-%m-%d").tolist()
n = len(P)
r = np.concatenate([[0.0], P[1:] / P[:-1] - 1])
rfd = CASH / 252

v = pd.Series(np.concatenate([[np.nan], r[1:] ** 2])).rolling(WINDOW).mean().to_numpy()
cbar = np.full(n, np.nan)
cbar[WINDOW:] = pd.Series(v[WINDOW:]).expanding().mean().to_numpy()

last = dates[-1]
total = int(last[:4]) * 12 + (int(last[5:7]) - 1) - (MONTHS - 1)
start_date = START or f"{total // 12}-{total % 12 + 1:02d}-01"
s0 = next((i for i, d in enumerate(dates) if d >= start_date), n - 1)
s0 = max(s0, WINDOW)

W = np.zeros(n)
for t in range(s0, n - 1):
    reset = REBALANCE == "daily" or t == s0 or dates[t + 1][:7] != dates[t][:7]
    W[t + 1] = min(HI, max(LO, cbar[t] / v[t])) if reset else W[t]

vol_vals, vol_exp, sip_vals, sip_exp = [], [], [], []
V = POOL
vol_cost = 0.0
cash, units, sip_cost, purchases = POOL, 0.0, 0.0, 0
flows = []
for i in range(s0, n):
    if i > s0:
        fee = COST * abs(W[i] - W[i - 1])
        vol_cost += V * fee
        V *= 1 + W[i] * r[i] + (1 - W[i]) * rfd - fee
        cash *= 1 + rfd
        vol_vals.append(V)
        vol_exp.append(W[i])
    else:
        first_fee = POOL * COST * W[s0 + 1]
        vol_cost += first_fee
        vol_vals.append(POOL - first_fee)
        vol_exp.append(W[s0 + 1])
    if i == s0 or dates[i][:7] != dates[i - 1][:7]:
        a = min(SIP, cash)
        fee_amt = COST * a
        units += (a - fee_amt) / P[i]
        cash -= a
        sip_cost += fee_amt
        purchases += 1
        flows.append((pd.Timestamp(dates[i]).value / 86400e9, -a))
    val = cash + units * P[i]
    sip_vals.append(val)
    sip_exp.append(units * P[i] / val)

flows.append((pd.Timestamp(dates[-1]).value / 86400e9, units * P[-1]))
t0 = flows[0][0]
mwr = brentq(lambda x: sum(a / (1 + x) ** ((t - t0) / 365) for t, a in flows), -0.99, 10)


def summary(values, exposure, cost_total):
    values = np.asarray(values)
    rets = values[1:] / values[:-1] - 1
    peak = np.maximum.accumulate(np.concatenate([[POOL], values]))[1:]
    dd = values / peak - 1
    run = longest = 0
    for x in dd:
        run = run + 1 if x < 0 else 0
        longest = max(longest, run)
    sd = rets.std(ddof=1)
    return dict(
        final=float(values[-1]),
        profit=float(values[-1] - POOL),
        returnPct=float(values[-1] / POOL - 1),
        maxDrawdown=float(dd.min()),
        troughDate=dates[s0 + int(dd.argmin())],
        longestUnderwaterDays=int(longest),
        worstDay=float(rets.min()),
        bestDay=float(rets.max()),
        costTotal=float(cost_total),
        avgExposure=float(np.mean(exposure)),
        annVol=float(sd * np.sqrt(252)),
        sharpe=float((rets.mean() - rfd) / sd * np.sqrt(252)),
    ), rets


vol_sum, vol_rets = summary(vol_vals, vol_exp, vol_cost)
sip_sum, _ = summary(sip_vals, sip_exp, sip_cost)
sip_sum["invested"] = float(-sum(a for _, a in flows[:-1]))
sip_sum["purchases"] = purchases
sip_sum["moneyWeightedReturn"] = float(mwr)

bh_ex = r[s0 + 1 : s0 + 1 + len(vol_rets)] - rfd
v_ex = vol_rets - rfd
import statsmodels.api as sm

res = sm.OLS(v_ex, sm.add_constant(bh_ex)).fit()
alpha, beta = res.params
rmse = float(np.sqrt(res.ssr / (len(v_ex) - 2)))
sr_old = bh_ex.mean() / bh_ex.std(ddof=1)
app = alpha / rmse

result = dict(
    months=MONTHS,
    rebalance=REBALANCE,
    rows=n,
    s0=int(s0),
    from_=dates[s0],
    to=dates[-1],
    days=int(n - s0),
    niftyChange=float(P[-1] / P[s0] - 1),
    sip=sip_sum,
    vol=vol_sum,
    regression=dict(
        alphaAnnual=float(alpha * 252),
        beta=float(beta),
        appraisalAnnual=float(app * np.sqrt(252)),
        sharpeOriginal=float(sr_old * np.sqrt(252)),
    ),
    first_weight=float(vol_exp[0]),
    mean_weight=float(np.mean(vol_exp)),
    min_weight=float(np.min(vol_exp)),
    max_weight=float(np.max(vol_exp)),
    last_sip_value=float(sip_vals[-1]),
    last_vol_value=float(vol_vals[-1]),
)
with open(out_path, "w") as fh:
    json.dump(result, fh, indent=2)
print("period", result["from_"], "to", result["to"], "days", result["days"], "SIP purchases", purchases)
print("SIP final", round(sip_sum["final"]), "profit", round(sip_sum["profit"]), "maxDD", round(sip_sum["maxDrawdown"], 4))
print("VOL final", round(vol_sum["final"]), "profit", round(vol_sum["profit"]), "maxDD", round(vol_sum["maxDrawdown"], 4))
