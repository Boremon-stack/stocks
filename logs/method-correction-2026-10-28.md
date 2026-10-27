# Correction: the product now implements the owner's own method, 2026-10-28

Earlier versions of this site compared two plans on a Rs 10,00,000 pool: a monthly SIP that sat mostly in cash and a volatility plan that held a share of the pool. That is not the experiment in the owner's Python script, so its figures were answers to a different question. They are withdrawn.

## What the site implements now

`nifty_volatility_backtest_v2.py` (the owner's script) is the specification. Every month Rs 10,000 is added to both plans on the first trading day of the month. The plain plan invests it at once. The volatility-managed plan rebalances on that day to a target share of its money in the index. The target comes from the previous calendar month's realized variance (the sum of squared daily returns), as 1/RV divided by the average of all earlier months' 1/RV, capped at 100%. Idle cash earns 0%. Metrics are the script's own: time-weighted CAGR from cash-flow-neutral daily returns, annualized volatility, Sharpe with a zero risk-free rate, and maximum drawdown on a unitized NAV.

## Data

Both indices use the official NSE files supplied by the owner (`NIFTY50_2020-2025_merged.csv`, `NIFTYBANK_2020-2025_merged.csv`; 1,491 rows each, 2020-01-01 to 2025-12-31, including six special weekend sessions in each file). The earlier Yahoo Finance closes were identical to the NSE closes on every common date (Nifty 50: 1,486 dates, Bank Nifty: 1,485 dates, maximum difference 0.00), so the closing prices were not the cause of the error. Yahoo omitted five of the six weekend sessions for Nifty 50 and all six for Bank Nifty.

## Verification

- The JavaScript engine (`dcaVsVm`) reproduces the owner's script output row for row: all 1,491 rows and every numeric column of `backtest_daily.csv`, and `summary_metrics.csv`, at 1e-9, for the default settings and for an alternative set (Rs 20,000 a month, 80% cap, 5 bp cost), on Nifty 50, and for the default settings on Bank Nifty (`test/dcavm.test.mjs`, fixtures in `test/fixtures/user`).
- The extras (drawdown episodes, investments, trade lists, money-weighted return, the constant-target control) are compared with an independent pandas implementation (`test/reference_dcavm_extras.py`).
- The page checks itself: the All data tab accepts the owner's `backtest_daily.csv` or `backtest_monthly.csv` and reports every difference.

## Results (owner's method, Nifty 50 and Bank Nifty, 2020 to 2025, Rs 10,000 a month)

| | Plain DCA | Volatility-managed |
| --- | ---: | ---: |
| Nifty 50 ending equity | Rs 11,02,351 | Rs 10,47,456 |
| Nifty 50 CAGR / Sharpe / maximum drawdown | 13.78% / 0.81 / -38.44% | 14.43% / 1.15 / -14.14% |
| Bank Nifty ending equity | Rs 11,38,937 | Rs 11,37,458 |
| Bank Nifty CAGR / Sharpe / maximum drawdown | 11.03% / 0.56 / -47.86% | 13.63% / 0.80 / -26.76% |

Against a plan holding a constant target equal to the volatility plan's average target, the volatility plan ended Rs 24,336 higher on Nifty 50 (Sharpe +0.34, drawdown 18.2 points shallower) and Rs 69,906 higher on Bank Nifty (Sharpe +0.23, drawdown 14.9 points shallower).

The earlier statement that the volatility signal adds very little came from the pool design and does not apply to this method.

## Limits

About 72 monthly observations. Price indices without dividends. Cash earns nothing. The first two months have a target of 0 by construction, because the method needs an earlier month. The owner describes the method as a practical adaptation, not an exact replication of Moreira and Muir (2017). The results are one historical sample path with no significance test.
