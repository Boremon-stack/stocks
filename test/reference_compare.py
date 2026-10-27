"""Independent reference for the SIP versus volatility-based comparison.

Usage: python test/reference_compare.py PRICES.csv OUT.json [months] [monthly|daily] [startDate|-] [variance|volatility] [paper|average]

Written from SPEC_compare_v2.md and SPEC_v3_additions.md only. Uses numpy, pandas and scipy.
"""
import json
import math
import sys

import numpy as np
import pandas as pd
from scipy.optimize import brentq

path, out_path = sys.argv[1], sys.argv[2]
MONTHS = int(sys.argv[3]) if len(sys.argv) > 3 else 60
REBALANCE = sys.argv[4] if len(sys.argv) > 4 else "monthly"
START = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] != "-" else None
SCALING = sys.argv[6] if len(sys.argv) > 6 else "variance"
CALIBRATION = sys.argv[7] if len(sys.argv) > 7 else "paper"
if REBALANCE not in ("monthly", "daily"):
    raise SystemExit(f"rebalance must be monthly or daily, got {REBALANCE}")
if SCALING not in ("variance", "volatility"):
    raise SystemExit(f"scaling must be variance or volatility, got {SCALING}")
if CALIBRATION not in ("paper", "average"):
    raise SystemExit(f"calibration must be paper or average, got {CALIBRATION}")

POOL, SIP, WINDOW = 1_000_000.0, 10_000.0, 20
MIN_EXPOSURE, MAX_EXPOSURE = 0.0, 1.0
LO, HI = min(MIN_EXPOSURE, MAX_EXPOSURE), MAX_EXPOSURE
COST, CASH_RATE = 0.001, 0.0
RFD = CASH_RATE / 252
ANN = 252

df = pd.read_csv(path, parse_dates=["date"]).sort_values("date").reset_index(drop=True)
P = df["close"].to_numpy(dtype=float)
dates = df["date"].dt.strftime("%Y-%m-%d").tolist()
n = len(P)

r = np.zeros(n)
r[1:] = P[1:] / P[:-1] - 1

v = np.full(n, np.nan)
for t in range(WINDOW, n):
    v[t] = np.mean(r[t - WINDOW + 1 : t + 1] ** 2)

cbar = np.full(n, np.nan)
cbar[WINDOW:] = np.cumsum(v[WINDOW:]) / np.arange(1, n - WINDOW + 1)

last = dates[-1]
first_month_index = int(last[:4]) * 12 + (int(last[5:7]) - 1) - (MONTHS - 1)
start_date = START or f"{first_month_index // 12}-{first_month_index % 12 + 1:02d}-01"
s0 = next((i for i, d in enumerate(dates) if d >= start_date), n - 1)
s0 = max(s0, WINDOW)
L = n - s0


def is_reset(i):
    if i > n - 2:
        return False
    if i == s0 or REBALANCE == "daily":
        return True
    return dates[i + 1][:7] != dates[i][:7]


def raw(i):
    if not v[i] > 0:
        return math.inf
    return 1 / v[i] if SCALING == "variance" else 1 / math.sqrt(v[i])


def raw_average(i):
    if not v[i] > 0:
        return math.inf
    ratio = cbar[i] / v[i]
    return ratio if SCALING == "variance" else math.sqrt(ratio)


c_const = None
if CALIBRATION == "paper":
    f_list, g_list = [], []
    prev_reset = s0 if is_reset(s0) else None
    for s in range(s0 + 1, n):
        if prev_reset is not None and v[prev_reset] > 0:
            f_s = r[s] - RFD
            f_list.append(f_s)
            g_list.append(raw(prev_reset) * f_s)
        if is_reset(s):
            prev_reset = s
    c_const = float(np.std(f_list, ddof=1) / np.std(g_list, ddof=1))


def uncapped(i):
    if CALIBRATION == "paper":
        return c_const * raw(i)
    return raw_average(i)


def clamp(u):
    return min(HI, max(LO, u))


def irr(flows):
    t0 = pd.Timestamp(flows[0][0])
    ts = np.array([(pd.Timestamp(d) - t0).days / 365 for d, _ in flows])
    cf = np.array([a for _, a in flows])
    try:
        return brentq(lambda rate: float(np.sum(cf * (1 + rate) ** (-ts))), -0.99, 10)
    except ValueError:
        return None


def run_ledger(share_at):
    cash, units = POOL, 0.0
    gain = interest = fees = 0.0
    trades, rows = [], []
    resets = 0
    for i in range(s0, n):
        if i > s0:
            iv = cash * RFD
            cash += iv
            interest += iv
            gain += units * (P[i] - P[i - 1])
        fee_today, signed = 0.0, 0.0
        if is_reset(i):
            resets += 1
            target = share_at(i)
            value_before = cash + units * P[i]
            delta = target * value_before - units * P[i]
            if abs(delta) >= 1e-9:
                if delta > 0:
                    a = min(delta, cash / (1 + COST))
                    fee = COST * a
                    units += a / P[i]
                    cash -= a + fee
                    side, signed = "buy", a
                else:
                    a = -delta
                    fee = COST * a
                    units -= a / P[i]
                    cash += a - fee
                    side, signed = "sell", -a
                fees += fee
                fee_today = fee
                trades.append(dict(
                    date=dates[i], side=side, amount=float(a), price=float(P[i]), fee=float(fee),
                    units=float(a / P[i]),
                    shareAfter=float(units * P[i] / (cash + units * P[i])),
                ))
        value, in_index = cash + units * P[i], units * P[i]
        rows.append(dict(value=value, inIndex=in_index, share=in_index / value, fee=fee_today, signed=signed))
    return dict(cash=cash, units=units, gain=gain, interest=interest, fees=fees,
                trades=trades, rows=rows, resets=resets)


def run_sip():
    cash, units = POOL, 0.0
    gain = interest = fees = 0.0
    purchases, rows = [], []
    for i in range(s0, n):
        if i > s0:
            iv = cash * RFD
            cash += iv
            interest += iv
            gain += units * (P[i] - P[i - 1])
        fee_today, buy_today = 0.0, 0.0
        if i == s0 or dates[i][:7] != dates[i - 1][:7]:
            a = min(SIP, cash / (1 + COST))
            fee = COST * a
            units += a / P[i]
            cash -= a + fee
            fees += fee
            fee_today, buy_today = fee, a
            purchases.append(dict(date=dates[i], amount=float(a), price=float(P[i]), fee=float(fee), units=float(a / P[i])))
        value, in_index = cash + units * P[i], units * P[i]
        rows.append(dict(value=value, inIndex=in_index, share=in_index / value, fee=fee_today, buy=buy_today))
    return dict(cash=cash, units=units, gain=gain, interest=interest, fees=fees, purchases=purchases, rows=rows)


def dd_series(vals):
    peak = np.maximum.accumulate(np.concatenate([[POOL], vals]))[1:]
    return vals / peak - 1


def episodes(dd):
    out, k = [], 0
    while k < L:
        if dd[k] < 0:
            start = k
            while k < L and dd[k] < 0:
                k += 1
            seg = dd[start:k]
            j = int(np.argmin(seg))
            out.append(dict(
                peakIdx=start - 1 if start > 0 else 0, troughIdx=start + j,
                endIdx=k if k < L else None, depth=float(seg[j]), under=k - start,
            ))
        else:
            k += 1
    return out


def episode_json(e):
    rec = e["endIdx"] is not None
    return dict(
        peakDate=dates[s0 + e["peakIdx"]], troughDate=dates[s0 + e["troughIdx"]],
        endDate=dates[s0 + e["endIdx"]] if rec else None, depth=e["depth"],
        tradingDaysToTrough=e["troughIdx"] - e["peakIdx"],
        tradingDaysToRecover=(e["endIdx"] - e["troughIdx"]) if rec else None,
        tradingDaysUnder=e["under"],
    )


def plan_metrics(vals, shares, fees, gain, interest):
    rho = vals[1:] / vals[:-1] - 1
    final = float(vals[-1])
    years = (pd.Timestamp(dates[-1]) - pd.Timestamp(dates[s0])).days / 365.25
    cagr = (final / POOL) ** (1 / years) - 1
    mean_d, sd_d = float(rho.mean()), float(rho.std(ddof=1))
    sharpe = (mean_d - RFD) / sd_d * math.sqrt(ANN) if sd_d != 0 else 0.0
    dd = dd_series(vals)
    mdd = float(dd.min())
    eps = episodes(dd)
    top = sorted(eps, key=lambda e: e["depth"])[:3]
    profit = final - POOL
    residual = gain + interest - fees - profit
    assert abs(residual) < 1e-6, residual
    out = dict(
        final=final, profit=profit, returnPct=final / POOL - 1, cagr=float(cagr),
        annVol=sd_d * math.sqrt(ANN), sharpe=float(sharpe),
        calmar=float(cagr / abs(mdd)) if mdd != 0 else None,
        sharpeParts=dict(meanDaily=mean_d, sdDaily=sd_d, rfd=RFD, years=years,
                         annReturnArithmetic=mean_d * ANN),
        maxDrawdown=mdd, troughDate=dates[s0 + int(np.argmin(dd))],
        longestUnderwaterDays=max((e["under"] for e in eps), default=0),
        worstDay=float(rho.min()), bestDay=float(rho.max()),
        avgExposure=float(np.mean(shares)), costTotal=float(fees),
        drawdownEpisodes=[episode_json(e) for e in top],
        components=dict(indexGain=float(gain), interest=float(interest), costs=float(fees)),
        residual=float(residual),
    )
    return out, dd, rho


def trade_investments(led):
    tr = led["trades"]
    bought = float(sum(t["amount"] for t in tr if t["side"] == "buy"))
    sold = float(sum(t["amount"] for t in tr if t["side"] == "sell"))
    inn = np.array([row["inIndex"] for row in led["rows"]])
    shares = np.array([row["share"] for row in led["rows"]])
    return dict(
        trades=len(tr),
        buys=sum(t["side"] == "buy" for t in tr),
        sells=sum(t["side"] == "sell" for t in tr),
        totalBought=bought, totalSold=sold, netPutIn=bought - sold, turnover=bought + sold,
        fees=float(led["fees"]), averageInIndex=float(np.mean(inn)), peakInIndex=float(np.max(inn)),
        lowestInIndex=float(np.min(inn)), finalIndexValue=float(led["units"] * P[-1]),
        cashLeft=float(led["cash"]), resets=led["resets"], averageShare=float(np.mean(shares)),
    )


def weight_stats(x):
    x = np.asarray(x, dtype=float)
    return dict(
        p50=float(np.percentile(x, 50)), p75=float(np.percentile(x, 75)),
        p90=float(np.percentile(x, 90)), p99=float(np.percentile(x, 99)),
        max=float(x.max()), min=float(x.min()), mean=float(x.mean()),
    )


def diff(a, b):
    return None if a is None or b is None else a - b


decisions = []


def vol_share(i):
    u = uncapped(i)
    w = clamp(u)
    decisions.append((i, u, w))
    return w


vol = run_ledger(vol_share)
sip = run_sip()
vol_shares = np.array([row["share"] for row in vol["rows"]])
control_share = clamp(float(np.mean(vol_shares)))
control = run_ledger(lambda i: control_share)

vol_vals = np.array([row["value"] for row in vol["rows"]])
sip_vals = np.array([row["value"] for row in sip["rows"]])
ctl_vals = np.array([row["value"] for row in control["rows"]])

vol_out, vol_dd, vol_rho = plan_metrics(vol_vals, vol_shares, vol["fees"], vol["gain"], vol["interest"])
sip_out, sip_dd, _ = plan_metrics(sip_vals, np.array([row["share"] for row in sip["rows"]]), sip["fees"], sip["gain"], sip["interest"])
ctl_out, ctl_dd, _ = plan_metrics(ctl_vals, np.array([row["share"] for row in control["rows"]]), control["fees"], control["gain"], control["interest"])

vol_out["investments"] = trade_investments(vol)
vol_out["tradeList"] = vol["trades"]

us = np.array([u for _, u, _ in decisions], dtype=float)
ws = np.array([w for _, _, w in decisions], dtype=float)
vol_out["weights"] = dict(
    count=len(decisions), uncapped=weight_stats(us), capped=weight_stats(ws),
    shareAtCap=float(np.mean(us >= HI)),
)
vol_out["avgAbsWeightChange"] = float(np.mean(np.abs(np.diff(ws)))) if len(ws) >= 2 else None

ctl_out["share"] = control_share
ctl_out["investments"] = trade_investments(control)
ctl_out["tradeList"] = control["trades"]

timing = dict(
    finalDiff=vol_out["final"] - ctl_out["final"],
    sharpeDiff=diff(vol_out["sharpe"], ctl_out["sharpe"]),
    maxDrawdownDiff=vol_out["maxDrawdown"] - ctl_out["maxDrawdown"],
    calmarDiff=diff(vol_out["calmar"], ctl_out["calmar"]),
)

total_sip = float(sum(p["amount"] for p in sip["purchases"]))
sip_flows = [(p["date"], -(p["amount"] + p["fee"])) for p in sip["purchases"]] + [(dates[-1], sip["units"] * P[-1])]
sip_out["investments"] = dict(
    purchases=len(sip["purchases"]), perPurchase=SIP, totalPutIn=total_sip, fees=float(sip["fees"]),
    units=float(sip["units"]), averageBuyPrice=total_sip / sip["units"] if sip["units"] > 0 else None,
    finalIndexValue=float(sip["units"] * P[-1]), cashLeft=float(sip["cash"]),
    moneyWeightedReturn=irr(sip_flows),
)
sip_out["purchaseList"] = sip["purchases"]

rho_v = vol_rho
y = rho_v - RFD
x = r[s0 + 1 : n] - RFD
m = len(y)
X = np.column_stack([np.ones(m), x])
coef, *_ = np.linalg.lstsq(X, y, rcond=None)
alpha, beta = float(coef[0]), float(coef[1])
resid = y - X @ coef
ssr = float(resid @ resid)
sst = float(((y - y.mean()) ** 2).sum())
sigma2 = ssr / (m - 2)
rmse = math.sqrt(sigma2)
t_alpha = alpha / math.sqrt(sigma2 * np.linalg.inv(X.T @ X)[0, 0])
sr_old = float(x.mean() / x.std(ddof=1))
app = alpha / rmse
sr_new = math.sqrt(sr_old ** 2 + app ** 2)
regression = dict(
    alphaAnnual=alpha * ANN, beta=beta, tAlpha=float(t_alpha), r2=1 - ssr / sst,
    rmse=rmse, appraisalAnnual=app * math.sqrt(ANN),
    sharpeOriginal=sr_old * math.sqrt(ANN), sharpeCombined=sr_new * math.sqrt(ANN),
    utilityGain=(sr_new ** 2 - sr_old ** 2) / sr_old ** 2 if sr_old > 0 else None,
)

days = []
for k, i in enumerate(range(s0, n)):
    vr, sr, cr = vol["rows"][k], sip["rows"][k], control["rows"][k]
    days.append(dict(
        date=dates[i], close=float(P[i]), vol=math.sqrt(v[i] * ANN),
        volWeight=vr["share"], sipExposure=sr["share"],
        volInIndex=vr["inIndex"], sipInIndex=sr["inIndex"], sipValue=sr["value"], volValue=vr["value"],
        sipCost=sr["fee"], volCost=vr["fee"], volTrade=vr["signed"], sipBuy=sr["buy"],
        sipDd=float(sip_dd[k]), volDd=float(vol_dd[k]),
        ctlValue=cr["value"], ctlDd=float(ctl_dd[k]), ctlInIndex=cr["inIndex"],
    ))

for name, plan in (("sip", sip_out), ("vol", vol_out), ("control", ctl_out)):
    print(name, "identity residual", plan.pop("residual"))

result = dict(
    months=MONTHS, rebalance=REBALANCE, rows=n, s0=int(s0), from_=dates[s0], to=dates[-1],
    days=L, niftyChange=float(P[-1] / P[s0] - 1),
    first_weight=vol["trades"][0]["shareAfter"] if vol["trades"] else None,
    mean_weight=float(np.mean(vol_shares)), min_weight=float(np.min(vol_shares)),
    max_weight=float(np.max(vol_shares)),
    last_sip_value=float(sip_vals[-1]), last_vol_value=float(vol_vals[-1]),
    scaling=SCALING, calibration=CALIBRATION, c=c_const,
    sip=sip_out, vol=vol_out, control=ctl_out, timingEffect=timing, regression=regression,
    series_head=days[:3], series_tail=days[-3:],
)


def clean(o):
    if isinstance(o, dict):
        return {k: clean(x) for k, x in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(x) for x in o]
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (float, np.floating)):
        f = float(o)
        return f if math.isfinite(f) else None
    return o


with open(out_path, "w") as fh:
    json.dump(clean(result), fh, indent=2)
print("period", result["from_"], "to", result["to"], "days", result["days"], "SIP purchases", len(sip["purchases"]))
print("c", c_const, "control share", control_share, "no-trade resets (vol)", vol["resets"] - len(vol["trades"]))
print("SIP final", round(sip_out["final"]), "profit", round(sip_out["profit"]), "maxDD", round(sip_out["maxDrawdown"], 4))
print("VOL final", round(vol_out["final"]), "profit", round(vol_out["profit"]), "maxDD", round(vol_out["maxDrawdown"], 4))
print("CONTROL final", round(ctl_out["final"]), "profit", round(ctl_out["profit"]), "maxDD", round(ctl_out["maxDrawdown"], 4))
