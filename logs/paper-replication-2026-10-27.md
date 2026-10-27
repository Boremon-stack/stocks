# Paper replication, Moreira and Muir (2017), market factor, 2026-10-27

Ken French's monthly Mkt-RF and the realized variance computed from the same series' daily Mkt-RF, run through the product's own code path (`paperStudyFromMonthly` in `public/js/backtest.js`). The French data is the paper's own data, used here only for validation; it is local and git-ignored, not hosted, and not part of the product. Published values are transcribed from the printed pages of the paper (Moreira and Muir (2017), printed pages: Table I p.42, Table II p.43, Table IV p.45, Table V p.46). Engine values are rounded to the paper's printed decimals before differencing. A row matches when the difference is within 1.5 units of the last printed digit. Nothing was tuned to make numbers match.

## Sample A, every month to December 2015: 192608 to 201512, 1073 managed months

### Tables I and II, market factor

| Quantity | Paper | This engine | Difference | Verdict |
| --- | ---: | ---: | ---: | --- |
| Alpha (% per year) | 4.86 | 4.88 | +0.02 | differs |
| Alpha robust s.e. (% per year) | 1.56 | 1.56 | +0.00 | matches |
| Beta | 0.61 | 0.60 | -0.01 | matches |
| Beta robust s.e. | 0.05 | 0.05 | +0.00 | matches |
| Observations (N) | 1065 | 1073 | +8 | differs |
| R-squared | 0.37 | 0.36 | -0.01 | matches |
| RMSE (% per year) | 51.39 | 51.68 | +0.29 | differs |
| Original Sharpe ratio | 0.42 | 0.42 | +0.00 | matches |
| Vol-managed Sharpe ratio | 0.51 | 0.51 | +0.00 | matches |
| Appraisal ratio | 0.33 | 0.33 | +0.00 | matches |

### Table IV, weights, returns, costs and break-even

| Quantity | Paper | This engine | Difference | Verdict |
| --- | ---: | ---: | ---: | --- |
| IV Realized Variance: |dw| (avg absolute weight change) | 0.73 | 0.75 | +0.02 | differs |
| IV Realized Variance: E[R] (% per year) | 9.47 | 9.54 | +0.07 | differs |
| IV Realized Variance: alpha (% per year) | 4.86 | 4.88 | +0.02 | differs |
| IV Realized Variance: alpha after 1bp cost (% per year) | 4.77 | 4.79 | +0.02 | differs |
| IV Realized Variance: alpha after 10bp cost (% per year) | 3.98 | 3.98 | +0.00 | matches |
| IV Realized Variance: alpha after 14bp cost (% per year) | 3.63 | 3.62 | -0.01 | matches |
| IV Realized Variance: break-even cost (bp) | 56 | 54 | -2 | differs |
| IV Realized Volatility: |dw| (avg absolute weight change) | 0.38 | 0.39 | +0.01 | matches |
| IV Realized Volatility: E[R] (% per year) | 9.84 | 9.93 | +0.09 | differs |
| IV Realized Volatility: alpha (% per year) | 3.85 | 3.38 | -0.47 | differs |
| IV Realized Volatility: alpha after 1bp cost (% per year) | 3.80 | 3.34 | -0.46 | differs |
| IV Realized Volatility: alpha after 10bp cost (% per year) | 3.39 | 2.92 | -0.47 | differs |
| IV Realized Volatility: alpha after 14bp cost (% per year) | 3.21 | 2.73 | -0.48 | differs |
| IV Realized Volatility: break-even cost (bp) | 84 | 73 | -11 | differs |
| IV No Leverage: |dw| (avg absolute weight change) | 0.16 | 0.16 | +0.00 | matches |
| IV No Leverage: E[R] (% per year) | 5.61 | 5.46 | -0.15 | differs |
| IV No Leverage: alpha (% per year) | 2.12 | 2.05 | -0.07 | differs |
| IV No Leverage: alpha after 1bp cost (% per year) | 2.10 | 2.03 | -0.07 | differs |
| IV No Leverage: alpha after 10bp cost (% per year) | 1.93 | 1.85 | -0.08 | differs |
| IV No Leverage: alpha after 14bp cost (% per year) | 1.85 | 1.77 | -0.08 | differs |
| IV No Leverage: break-even cost (bp) | 110 | 104 | -6 | differs |
| IV 50% Leverage: |dw| (avg absolute weight change) | 0.16 | 0.29 | +0.13 | differs |
| IV 50% Leverage: E[R] (% per year) | 7.18 | 7.07 | -0.11 | differs |
| IV 50% Leverage: alpha (% per year) | 3.10 | 3.11 | +0.01 | matches |
| IV 50% Leverage: alpha after 1bp cost (% per year) | 3.08 | 3.07 | -0.01 | matches |
| IV 50% Leverage: alpha after 10bp cost (% per year) | 2.91 | 2.76 | -0.15 | differs |
| IV 50% Leverage: alpha after 14bp cost (% per year) | 2.83 | 2.62 | -0.21 | differs |
| IV 50% Leverage: break-even cost (bp) | 161 | 90 | -71 | differs |
| Expected Variance (not implemented in this engine) | - | not implemented | - | not implemented |

### Table V, Panel A, weights, alpha, Sharpe and appraisal

| Quantity | Paper | This engine | Difference | Verdict |
| --- | ---: | ---: | ---: | --- |
| V Realized Variance: weight P50 | 0.93 | 0.94 | +0.01 | matches |
| V Realized Variance: weight P75 | 1.59 | 1.62 | +0.03 | differs |
| V Realized Variance: weight P90 | 2.64 | 2.71 | +0.07 | differs |
| V Realized Variance: weight P99 | 6.39 | 7.27 | +0.88 | differs |
| V Realized Variance: alpha (% per year) | 4.86 | 4.88 | +0.02 | differs |
| V Realized Variance: alpha s.e. (% per year) | 1.56 | 1.56 | +0.00 | matches |
| V Realized Variance: Sharpe ratio | 0.52 | 0.51 | -0.01 | matches |
| V Realized Variance: appraisal ratio | 0.34 | 0.33 | -0.01 | matches |
| V Realized Volatility: weight P50 | 1.23 | 1.24 | +0.01 | matches |
| V Realized Volatility: weight P75 | 1.61 | 1.64 | +0.03 | differs |
| V Realized Volatility: weight P90 | 2.08 | 2.12 | +0.04 | differs |
| V Realized Volatility: weight P99 | 3.36 | 3.47 | +0.11 | differs |
| V Realized Volatility: alpha (% per year) | 3.30 | 3.38 | +0.08 | differs |
| V Realized Volatility: alpha s.e. (% per year) | 1.02 | 1.02 | +0.00 | matches |
| V Realized Volatility: Sharpe ratio | 0.53 | 0.53 | +0.00 | matches |
| V Realized Volatility: appraisal ratio | 0.33 | 0.34 | +0.01 | matches |
| V No Leverage: weight P50 | 0.93 | 0.94 | +0.01 | matches |
| V No Leverage: weight P75 | 1.00 | 1.00 | +0.00 | matches |
| V No Leverage: weight P90 | 1.00 | 1.00 | +0.00 | matches |
| V No Leverage: weight P99 | 1.00 | 1.00 | +0.00 | matches |
| V No Leverage: alpha (% per year) | 2.12 | 2.05 | -0.07 | differs |
| V No Leverage: alpha s.e. (% per year) | 0.71 | 0.71 | +0.00 | matches |
| V No Leverage: Sharpe ratio | 0.52 | 0.51 | -0.01 | matches |
| V No Leverage: appraisal ratio | 0.30 | 0.30 | +0.00 | matches |
| V 50% Leverage: weight P50 | 0.93 | 0.94 | +0.01 | matches |
| V 50% Leverage: weight P75 | 1.50 | 1.50 | +0.00 | matches |
| V 50% Leverage: weight P90 | 1.50 | 1.50 | +0.00 | matches |
| V 50% Leverage: weight P99 | 1.50 | 1.50 | +0.00 | matches |
| V 50% Leverage: alpha (% per year) | 3.10 | 3.11 | +0.01 | matches |
| V 50% Leverage: alpha s.e. (% per year) | 0.98 | 0.96 | -0.02 | differs |
| V 50% Leverage: Sharpe ratio | 0.53 | 0.53 | +0.00 | matches |
| V 50% Leverage: appraisal ratio | 0.33 | 0.34 | +0.01 | matches |
| Expected Variance (not implemented in this engine) | - | not implemented | - | not implemented |

## Sample B, every month to April 2015: 192608 to 201504, 1065 managed months

### Tables I and II, market factor

| Quantity | Paper | This engine | Difference | Verdict |
| --- | ---: | ---: | ---: | --- |
| Alpha (% per year) | 4.86 | 4.93 | +0.07 | differs |
| Alpha robust s.e. (% per year) | 1.56 | 1.57 | +0.01 | matches |
| Beta | 0.61 | 0.60 | -0.01 | matches |
| Beta robust s.e. | 0.05 | 0.05 | +0.00 | matches |
| Observations (N) | 1065 | 1065 | +0 | matches |
| R-squared | 0.37 | 0.36 | -0.01 | matches |
| RMSE (% per year) | 51.39 | 51.79 | +0.40 | differs |
| Original Sharpe ratio | 0.42 | 0.42 | +0.00 | matches |
| Vol-managed Sharpe ratio | 0.51 | 0.52 | +0.01 | matches |
| Appraisal ratio | 0.33 | 0.33 | +0.00 | matches |

### Table IV, weights, returns, costs and break-even

| Quantity | Paper | This engine | Difference | Verdict |
| --- | ---: | ---: | ---: | --- |
| IV Realized Variance: |dw| (avg absolute weight change) | 0.73 | 0.75 | +0.02 | differs |
| IV Realized Variance: E[R] (% per year) | 9.47 | 9.64 | +0.17 | differs |
| IV Realized Variance: alpha (% per year) | 4.86 | 4.93 | +0.07 | differs |
| IV Realized Variance: alpha after 1bp cost (% per year) | 4.77 | 4.84 | +0.07 | differs |
| IV Realized Variance: alpha after 10bp cost (% per year) | 3.98 | 4.03 | +0.05 | differs |
| IV Realized Variance: alpha after 14bp cost (% per year) | 3.63 | 3.67 | +0.04 | differs |
| IV Realized Variance: break-even cost (bp) | 56 | 55 | -1 | matches |
| IV Realized Volatility: |dw| (avg absolute weight change) | 0.38 | 0.39 | +0.01 | matches |
| IV Realized Volatility: E[R] (% per year) | 9.84 | 10.04 | +0.20 | differs |
| IV Realized Volatility: alpha (% per year) | 3.85 | 3.44 | -0.41 | differs |
| IV Realized Volatility: alpha after 1bp cost (% per year) | 3.80 | 3.39 | -0.41 | differs |
| IV Realized Volatility: alpha after 10bp cost (% per year) | 3.39 | 2.97 | -0.42 | differs |
| IV Realized Volatility: alpha after 14bp cost (% per year) | 3.21 | 2.78 | -0.43 | differs |
| IV Realized Volatility: break-even cost (bp) | 84 | 74 | -10 | differs |
| IV No Leverage: |dw| (avg absolute weight change) | 0.16 | 0.16 | +0.00 | matches |
| IV No Leverage: E[R] (% per year) | 5.61 | 5.54 | -0.07 | differs |
| IV No Leverage: alpha (% per year) | 2.12 | 2.10 | -0.02 | differs |
| IV No Leverage: alpha after 1bp cost (% per year) | 2.10 | 2.08 | -0.02 | differs |
| IV No Leverage: alpha after 10bp cost (% per year) | 1.93 | 1.90 | -0.03 | differs |
| IV No Leverage: alpha after 14bp cost (% per year) | 1.85 | 1.82 | -0.03 | differs |
| IV No Leverage: break-even cost (bp) | 110 | 107 | -3 | differs |
| IV 50% Leverage: |dw| (avg absolute weight change) | 0.16 | 0.29 | +0.13 | differs |
| IV 50% Leverage: E[R] (% per year) | 7.18 | 7.16 | -0.02 | differs |
| IV 50% Leverage: alpha (% per year) | 3.10 | 3.16 | +0.06 | differs |
| IV 50% Leverage: alpha after 1bp cost (% per year) | 3.08 | 3.13 | +0.05 | differs |
| IV 50% Leverage: alpha after 10bp cost (% per year) | 2.91 | 2.81 | -0.10 | differs |
| IV 50% Leverage: alpha after 14bp cost (% per year) | 2.83 | 2.68 | -0.15 | differs |
| IV 50% Leverage: break-even cost (bp) | 161 | 91 | -70 | differs |
| Expected Variance (not implemented in this engine) | - | not implemented | - | not implemented |

### Table V, Panel A, weights, alpha, Sharpe and appraisal

| Quantity | Paper | This engine | Difference | Verdict |
| --- | ---: | ---: | ---: | --- |
| V Realized Variance: weight P50 | 0.93 | 0.94 | +0.01 | matches |
| V Realized Variance: weight P75 | 1.59 | 1.62 | +0.03 | differs |
| V Realized Variance: weight P90 | 2.64 | 2.71 | +0.07 | differs |
| V Realized Variance: weight P99 | 6.39 | 7.27 | +0.88 | differs |
| V Realized Variance: alpha (% per year) | 4.86 | 4.93 | +0.07 | differs |
| V Realized Variance: alpha s.e. (% per year) | 1.56 | 1.57 | +0.01 | matches |
| V Realized Variance: Sharpe ratio | 0.52 | 0.52 | +0.00 | matches |
| V Realized Variance: appraisal ratio | 0.34 | 0.33 | -0.01 | matches |
| V Realized Volatility: weight P50 | 1.23 | 1.25 | +0.02 | differs |
| V Realized Volatility: weight P75 | 1.61 | 1.64 | +0.03 | differs |
| V Realized Volatility: weight P90 | 2.08 | 2.12 | +0.04 | differs |
| V Realized Volatility: weight P99 | 3.36 | 3.47 | +0.11 | differs |
| V Realized Volatility: alpha (% per year) | 3.30 | 3.44 | +0.14 | differs |
| V Realized Volatility: alpha s.e. (% per year) | 1.02 | 1.03 | +0.01 | matches |
| V Realized Volatility: Sharpe ratio | 0.53 | 0.54 | +0.01 | matches |
| V Realized Volatility: appraisal ratio | 0.33 | 0.34 | +0.01 | matches |
| V No Leverage: weight P50 | 0.93 | 0.94 | +0.01 | matches |
| V No Leverage: weight P75 | 1.00 | 1.00 | +0.00 | matches |
| V No Leverage: weight P90 | 1.00 | 1.00 | +0.00 | matches |
| V No Leverage: weight P99 | 1.00 | 1.00 | +0.00 | matches |
| V No Leverage: alpha (% per year) | 2.12 | 2.10 | -0.02 | differs |
| V No Leverage: alpha s.e. (% per year) | 0.71 | 0.72 | +0.01 | matches |
| V No Leverage: Sharpe ratio | 0.52 | 0.52 | +0.00 | matches |
| V No Leverage: appraisal ratio | 0.30 | 0.30 | +0.00 | matches |
| V 50% Leverage: weight P50 | 0.93 | 0.94 | +0.01 | matches |
| V 50% Leverage: weight P75 | 1.50 | 1.50 | +0.00 | matches |
| V 50% Leverage: weight P90 | 1.50 | 1.50 | +0.00 | matches |
| V 50% Leverage: weight P99 | 1.50 | 1.50 | +0.00 | matches |
| V 50% Leverage: alpha (% per year) | 3.10 | 3.16 | +0.06 | differs |
| V 50% Leverage: alpha s.e. (% per year) | 0.98 | 0.96 | -0.02 | differs |
| V 50% Leverage: Sharpe ratio | 0.53 | 0.54 | +0.01 | matches |
| V 50% Leverage: appraisal ratio | 0.33 | 0.34 | +0.01 | matches |
| Expected Variance (not implemented in this engine) | - | not implemented | - | not implemented |

## Summary

### Sample A, every month to December 2015

35 of 70 compared quantities match.

Differs:

- Alpha (% per year): paper 4.86, this engine 4.88
- Observations (N): paper 1065, this engine 1073
- RMSE (% per year): paper 51.39, this engine 51.68
- IV Realized Variance: |dw| (avg absolute weight change): paper 0.73, this engine 0.75
- IV Realized Variance: E[R] (% per year): paper 9.47, this engine 9.54
- IV Realized Variance: alpha (% per year): paper 4.86, this engine 4.88
- IV Realized Variance: alpha after 1bp cost (% per year): paper 4.77, this engine 4.79
- IV Realized Variance: break-even cost (bp): paper 56, this engine 54
- IV Realized Volatility: E[R] (% per year): paper 9.84, this engine 9.93
- IV Realized Volatility: alpha (% per year): paper 3.85, this engine 3.38
- IV Realized Volatility: alpha after 1bp cost (% per year): paper 3.80, this engine 3.34
- IV Realized Volatility: alpha after 10bp cost (% per year): paper 3.39, this engine 2.92
- IV Realized Volatility: alpha after 14bp cost (% per year): paper 3.21, this engine 2.73
- IV Realized Volatility: break-even cost (bp): paper 84, this engine 73
- IV No Leverage: E[R] (% per year): paper 5.61, this engine 5.46
- IV No Leverage: alpha (% per year): paper 2.12, this engine 2.05
- IV No Leverage: alpha after 1bp cost (% per year): paper 2.10, this engine 2.03
- IV No Leverage: alpha after 10bp cost (% per year): paper 1.93, this engine 1.85
- IV No Leverage: alpha after 14bp cost (% per year): paper 1.85, this engine 1.77
- IV No Leverage: break-even cost (bp): paper 110, this engine 104
- IV 50% Leverage: |dw| (avg absolute weight change): paper 0.16, this engine 0.29
- IV 50% Leverage: E[R] (% per year): paper 7.18, this engine 7.07
- IV 50% Leverage: alpha after 10bp cost (% per year): paper 2.91, this engine 2.76
- IV 50% Leverage: alpha after 14bp cost (% per year): paper 2.83, this engine 2.62
- IV 50% Leverage: break-even cost (bp): paper 161, this engine 90
- V Realized Variance: weight P75: paper 1.59, this engine 1.62
- V Realized Variance: weight P90: paper 2.64, this engine 2.71
- V Realized Variance: weight P99: paper 6.39, this engine 7.27
- V Realized Variance: alpha (% per year): paper 4.86, this engine 4.88
- V Realized Volatility: weight P75: paper 1.61, this engine 1.64
- V Realized Volatility: weight P90: paper 2.08, this engine 2.12
- V Realized Volatility: weight P99: paper 3.36, this engine 3.47
- V Realized Volatility: alpha (% per year): paper 3.30, this engine 3.38
- V No Leverage: alpha (% per year): paper 2.12, this engine 2.05
- V 50% Leverage: alpha s.e. (% per year): paper 0.98, this engine 0.96

### Sample B, every month to April 2015

31 of 70 compared quantities match.

Differs:

- Alpha (% per year): paper 4.86, this engine 4.93
- RMSE (% per year): paper 51.39, this engine 51.79
- IV Realized Variance: |dw| (avg absolute weight change): paper 0.73, this engine 0.75
- IV Realized Variance: E[R] (% per year): paper 9.47, this engine 9.64
- IV Realized Variance: alpha (% per year): paper 4.86, this engine 4.93
- IV Realized Variance: alpha after 1bp cost (% per year): paper 4.77, this engine 4.84
- IV Realized Variance: alpha after 10bp cost (% per year): paper 3.98, this engine 4.03
- IV Realized Variance: alpha after 14bp cost (% per year): paper 3.63, this engine 3.67
- IV Realized Volatility: E[R] (% per year): paper 9.84, this engine 10.04
- IV Realized Volatility: alpha (% per year): paper 3.85, this engine 3.44
- IV Realized Volatility: alpha after 1bp cost (% per year): paper 3.80, this engine 3.39
- IV Realized Volatility: alpha after 10bp cost (% per year): paper 3.39, this engine 2.97
- IV Realized Volatility: alpha after 14bp cost (% per year): paper 3.21, this engine 2.78
- IV Realized Volatility: break-even cost (bp): paper 84, this engine 74
- IV No Leverage: E[R] (% per year): paper 5.61, this engine 5.54
- IV No Leverage: alpha (% per year): paper 2.12, this engine 2.10
- IV No Leverage: alpha after 1bp cost (% per year): paper 2.10, this engine 2.08
- IV No Leverage: alpha after 10bp cost (% per year): paper 1.93, this engine 1.90
- IV No Leverage: alpha after 14bp cost (% per year): paper 1.85, this engine 1.82
- IV No Leverage: break-even cost (bp): paper 110, this engine 107
- IV 50% Leverage: |dw| (avg absolute weight change): paper 0.16, this engine 0.29
- IV 50% Leverage: E[R] (% per year): paper 7.18, this engine 7.16
- IV 50% Leverage: alpha (% per year): paper 3.10, this engine 3.16
- IV 50% Leverage: alpha after 1bp cost (% per year): paper 3.08, this engine 3.13
- IV 50% Leverage: alpha after 10bp cost (% per year): paper 2.91, this engine 2.81
- IV 50% Leverage: alpha after 14bp cost (% per year): paper 2.83, this engine 2.68
- IV 50% Leverage: break-even cost (bp): paper 161, this engine 91
- V Realized Variance: weight P75: paper 1.59, this engine 1.62
- V Realized Variance: weight P90: paper 2.64, this engine 2.71
- V Realized Variance: weight P99: paper 6.39, this engine 7.27
- V Realized Variance: alpha (% per year): paper 4.86, this engine 4.93
- V Realized Volatility: weight P50: paper 1.23, this engine 1.25
- V Realized Volatility: weight P75: paper 1.61, this engine 1.64
- V Realized Volatility: weight P90: paper 2.08, this engine 2.12
- V Realized Volatility: weight P99: paper 3.36, this engine 3.47
- V Realized Volatility: alpha (% per year): paper 3.30, this engine 3.44
- V No Leverage: alpha (% per year): paper 2.12, this engine 2.10
- V 50% Leverage: alpha (% per year): paper 3.10, this engine 3.16
- V 50% Leverage: alpha s.e. (% per year): paper 0.98, this engine 0.96

## Limits

- Data vintage: Ken French's files have been revised since 2015, so differences can come from revisions in the input, not from the engine.
- The paper prints the Realized Volatility alpha as 3.85 in Table IV and 3.30 in Table V, and swaps those two values for the expected-variance row. Both printed values are compared here, one per table.
- The engine has no expected-variance row. It is listed as not implemented and is not counted in the match totals.
- Equality is checked to printed precision only. The verdict says the engine's value agrees with the printed digits, not that the underlying values are identical.
- Sample B's end month (2015-04) is inferred from the paper's N = 1,065. N is compared as an integer.
- Weights printed as "1" in Table V are compared at two decimals, as 1.00.
- Costs and leverage caps follow the paper's Table IV variants. The paper's Table IV no-leverage row uses the cap at 1.0, and the 50% row uses the cap at 1.5.
