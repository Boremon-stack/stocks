# Paper replication log, 2026-10-27

Reproduces the market result of Moreira and Muir (2017) with this repository's engine function `volManage` and `paperTest`, on Ken French's monthly Mkt-RF and the same data's daily Mkt-RF for realized variance (paper equations 1 and 2: excess return scaled by the inverse of the previous month's demeaned realized variance, with c chosen so the managed series has the buy-and-hold standard deviation over the full sample). No transaction costs, no leverage cap.

French data is used only here, as the paper's own data for validation. It is not hosted, not part of the product, and is git-ignored.

## Market factor, 192608 to 201512, 1073 months

| Quantity | Paper | This engine |
| --- | ---: | ---: |
| Annualised alpha | 4.86% | 4.88% |
| Beta | 0.6 | 0.60 |
| Annualised appraisal ratio | 0.34 (abstract 0.33) | 0.33 |
| Mean-variance utility gain | 65% | 61.91% |
| Sharpe ratio increase | 25% | 23.04% |

Standard deviation, original 5.39% per month and managed 5.39% per month (equal by construction). Largest weight 16.85x. Original Sharpe 0.42, managed Sharpe 0.51, new Sharpe from the alpha formula 0.53. Alpha t-statistic 3.07, R-squared 0.36.

## All available months, 192608 to 202609

Alpha 4.51%, beta 0.60, appraisal ratio 0.31, Sharpe increase 14.39%.

## Limits

Alpha, beta and the appraisal ratio match the paper to rounding. The utility gain and the Sharpe increase come out about 3 and 2 points below the published 65% and 25%. This run does not isolate the cause; candidate sources are later revisions of French's files and the first month used (the managed series starts one month after the sample). Costs and caps are off, as in the paper's main table.
