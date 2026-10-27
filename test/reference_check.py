import sys
import numpy as np
import pandas as pd

path = sys.argv[1]
df = pd.read_csv(path, parse_dates=["date"]).sort_values("date").reset_index(drop=True)
close = df["close"].to_numpy()
r = np.concatenate([[0.0], close[1:] / close[:-1] - 1])
cost = 0.001
W = 20


def summ(x, ppy):
    x = np.asarray(x)
    eq = np.cumprod(1 + x)
    peak = np.maximum.accumulate(np.concatenate([[1.0], eq]))[1:]
    dd = (eq / peak - 1).min()
    n = len(x)
    return dict(
        cumulative=eq[-1] - 1,
        cagr=eq[-1] ** (ppy / n) - 1,
        annVol=x.std(ddof=1) * np.sqrt(ppy),
        sharpe=x.mean() / x.std(ddof=1) * np.sqrt(ppy),
        maxDrawdown=dd,
    )


v = pd.Series(r ** 2).rolling(W).mean().to_numpy()
start = W
split = start + int((len(r) - start) * 0.7)
c = np.nanmean(v[start:split])
w = np.zeros(len(r))
for t in range(start, len(r) - 1):
    w[t + 1] = min(1.0, c / v[t])
frm = start + 1
bh = r[frm:]
ww = w[frm:]
prev = np.concatenate([[0.0], ww[:-1]])
strat = ww * bh - cost * np.abs(ww - prev)
sp = split - frm
print("daily c", c)
print(" OOS bh", summ(bh[sp:], 252))
print(" OOS st", summ(strat[sp:], 252))
print(" IS  bh", summ(bh[:sp], 252))
print(" IS  st", summ(strat[:sp], 252))

m = df.assign(ym=df["date"].dt.to_period("M"))
prev_close = df["close"].shift(1)
m["r"] = df["close"] / prev_close - 1
m["r2"] = m["r"].fillna(0) ** 2
g = m.groupby("ym")
first_prev = prev_close.groupby(m["ym"]).first().fillna(close[0])
last = g["close"].last()
ret = (last / first_prev.reindex(last.index) - 1).to_numpy()
rv = g["r2"].sum().to_numpy()
n = len(ret)
ms = 1
msplit = ms + int((n - ms) * 0.7)
raw = np.array([1 / rv[mm - 1] if rv[mm - 1] > 0 else 0.0 for mm in range(ms, n)])
trainR = ret[ms:msplit]
trainRaw = raw[: msplit - ms] * trainR
cm = trainR.std(ddof=1) / trainRaw.std(ddof=1)
wm = np.minimum(np.inf, cm * raw)
prevw = np.concatenate([[1.0], wm[:-1]])
stratm = wm * ret[ms:] - cost * np.abs(wm - prevw)
oos = slice(msplit - ms, None)
print("monthly c", cm)
print(" OOS bh", summ(ret[ms:][oos], 12))
print(" OOS st", summ(stratm[oos], 12))
print(" IS  bh", summ(ret[ms:msplit], 12))
print(" IS  st", summ(stratm[: msplit - ms], 12))

from scipy import stats as sst
from statsmodels.stats.diagnostic import acorr_ljungbox
rr = r[1:]
print("stats mean", rr.mean(), "sd", rr.std(ddof=1))
print("stats skew", sst.skew(rr, bias=True), "exkurt", sst.kurtosis(rr, bias=True))
jb = sst.jarque_bera(rr)
print("stats JB", jb.statistic, jb.pvalue)
sq = rr ** 2
lb = acorr_ljungbox(sq, lags=[10], return_df=True)
print("stats LB sq", lb["lb_stat"].iloc[0], lb["lb_pvalue"].iloc[0])
