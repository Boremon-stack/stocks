# Audit of the product against Moreira and Muir (2017), 2026-10-28

Four read-only auditors each read a quarter of the paper PDF (76 PDF pages) and compared it with the engine and its specification. Their claims were treated as leads. The ones that decide results were checked against the PDF directly (printed pages 42 to 46: Tables I, II, IV and V).

## Findings that were real, and what changed

| # | Finding | Paper reference | Status |
| --- | --- | --- | --- |
| 1 | Alpha t-statistics were classical. The paper's tables use heteroskedasticity-robust standard errors. | Table I note, p.42 | Fixed: HC1 t-statistics (`tAlphaRobust`, `tBetaRobust`) added and shown. |
| 2 | The product's reference level was the running average of variance. The paper fixes a constant c so the managed series has the unmanaged standard deviation over the whole sample. | p.8, footnote 6 | Fixed: calibration `paper` is now the default; `average` stays as an option. The constant is shown and labelled as using hindsight. |
| 3 | The paper's cost exercise (alpha after cost = alpha minus cost x average absolute weight change x 12; break-even cost) and weight percentiles were missing. | Tables IV and V, pp.45 to 46 | Fixed: added to the statistics, with the four rows (realized variance, realized volatility, cap 1.5, no leverage). |
| 4 | The volatility plan was modelled as a constant weight with daily compounding, so trades could not be counted and costs ignored drift. | eq (1) is a monthly scaled return | Fixed: trade ledger with units held between month-end resets; fee on every trade. |
| 5 | The volatility plan's entry fee was counted twice in the cost total. | n/a (own accounting) | Fixed. |
| 6 | The monthly SIP draws on the same pool and starts almost entirely in cash, so the gap to the volatility plan mixed exposure level with timing. | n/a (own design) | Fixed: a constant-share control with the same average exposure is shown as "Is the volatility signal doing anything?". |
| 7 | Page and landing copy said the maths "follows the paper" and offered "more or less" of the pool. | n/a | Fixed; a "How this differs from the paper" list was added. |

## Findings that remain open, and are disclosed on the page

- Indices are price indices without dividends; the paper uses total returns. No Nifty total-return series was available.
- The paper scales excess returns over a risk-free rate. No Indian risk-free series was reachable, so the rate is an explicit input with default 0.
- The plan cannot borrow, so it holds at most 100% of the pool. That is the paper's "No Leverage" row, whose alpha is 2.12% against 4.86% unconstrained (Table IV, p.45).
- The sample is about 94 monthly observations against 1,065. The page states this beside every statistic.
- Not implemented: expected-variance scaling, the rebalancing-horizon test, recession betas, the VAR exercise, option-based leverage, multifactor portfolios.

## An auditor claim that was wrong

One auditor ranked it a high-impact deviation that caps do not re-solve c. The paper does the same: its capped rows keep the unconstrained row's median weight (0.93, Table V, p.46). No change was made.

## Replication on the paper's own data (Ken French Mkt-RF, local only)

`logs/paper-replication-2026-10-27.md` runs the product's own code path on 1926-08 to 2015-04, which gives the paper's N = 1,065. Results close to the paper: alpha 4.93% against 4.86%, standard error 1.57 against 1.56, Sharpe 0.52 against 0.52, appraisal ratio 0.33 against 0.34, and the No Leverage row (average absolute weight change 0.16, weights 0.93 / 1 / 1 / 1).

Differences not explained: the 99th percentile weight (7.27 against 6.39); the realized-volatility alpha (3.44 here; the paper prints 3.85 in Table IV and 3.30 in Table V for the same row); the 50% leverage row's average absolute weight change (0.29 here; the paper prints 0.16, identical to the row above it, and its break-even of 161 bp follows from 0.16). The engine's weights for that row match Table V exactly, so the paper's printed turnover cannot be reproduced from its own weights.
