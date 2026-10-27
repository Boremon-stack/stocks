import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, backtest, dailyReturns, describe, acf, ljungBox } from '../public/js/backtest.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataFile = `${root}local-data/nifty50.csv`;
const stamp = new Date().toISOString().slice(0, 10);
const opts = { cost: 0.001, rf: 0.065 };

const rows = parseCsv(readFileSync(dataFile, 'utf8'));
const r = dailyReturns(rows.map((d) => d.close)).slice(1);
const stats = {
  returns: describe(r),
  acfAbs: acf(r.map(Math.abs), 10),
  acfSq: acf(r.map((x) => x * x), 10),
  ljungBoxSq: ljungBox(r.map((x) => x * x), 10),
};

const runs = {
  daily: backtest(rows, { ...opts, mode: 'daily', maxExposure: 1 }),
  monthly: backtest(rows, { ...opts, mode: 'monthly' }),
};

const pct = (x) => `${(x * 100).toFixed(2)}%`;
const f2 = (x) => x.toFixed(2);
const table = (run) => {
  const o = run.outOfSample;
  const i = run.insample;
  const line = (label, g) =>
    `| ${label} | ${g(i.buyHold)} | ${g(i.strategy)} | ${g(o.buyHold)} | ${g(o.strategy)} |`;
  return [
    '| Metric | Train B&H | Train managed | Test B&H | Test managed |',
    '| --- | ---: | ---: | ---: | ---: |',
    line('CAGR', (s) => pct(s.cagr)),
    line('Cumulative', (s) => pct(s.cumulative)),
    line('Volatility, annual', (s) => pct(s.annVol)),
    line('Sharpe', (s) => f2(s.sharpe)),
    line('Max drawdown', (s) => pct(s.maxDrawdown)),
  ].join('\n');
};

const refOut = join(tmpdir(), 'volatility-lab-reference-nifty50.json');
execFileSync('python', ['test/reference_check.py', dataFile, refOut, String(opts.rf), String(opts.cost)], { cwd: root, encoding: 'utf8' });
const refJson = JSON.parse(readFileSync(refOut, 'utf8'));

const p4 = (x) => `${(x * 100).toFixed(4)}%`;
const d6 = (a, b) => (Math.abs(a - b) * 100).toFixed(6);
const indRow = (label, engine, pandas) => `| ${label} | ${p4(engine)} | ${p4(pandas)} | ${d6(engine, pandas)} |`;
const independent = [
  '| Quantity | Engine (JS) | pandas | Difference, pp |',
  '| --- | ---: | ---: | ---: |',
  indRow('Daily rule, test CAGR (managed)', runs.daily.outOfSample.strategy.cagr, refJson.daily.oos_st.cagr),
  indRow('Paper rule, test CAGR (managed)', runs.monthly.outOfSample.strategy.cagr, refJson.monthly.oos_st.cagr),
  indRow('Paper rule, annualised alpha, full sample', runs.monthly.regression.full.alphaAnnual, refJson.monthly.reg_full.alphaAnnual),
].join('\n');

mkdirSync(`${root}logs`, { recursive: true });
const base = `${root}logs/nifty50-${stamp}`;

writeFileSync(
  `${base}.json`,
  JSON.stringify(
    {
      dataset: 'nifty50 (NSE ^NSEI daily closes, local-data, not redistributed)',
      rows: rows.length,
      from: rows[0].date,
      to: rows[rows.length - 1].date,
      options: opts,
      stats,
      runs: Object.fromEntries(
        Object.entries(runs).map(([k, v]) => [
          k,
          { c: v.c, split: v.split, splitDate: v.series[v.split]?.date, insample: v.insample, outOfSample: v.outOfSample },
        ]),
      ),
    },
    null,
    2,
  ),
);

const md = `# Nifty 50 train and test log, ${stamp}

Dataset: NSE ^NSEI daily closes, ${rows.length} rows, ${rows[0].date} to ${rows[rows.length - 1].date}. Raw prices are not committed. Options: cost ${pct(opts.cost)} per unit of exposure change, risk-free ${pct(opts.rf)} a year. Train is the first 70% of returns; test is the last 30%.

## Daily rule (20-day window, capped at 100%)

Constant c = ${runs.daily.c.toExponential(4)}, fixed on the train period. Test starts ${runs.daily.series[runs.daily.split]?.date}.

${table(runs.daily)}

## Paper rule (monthly, uncapped)

Constant c = ${runs.monthly.c.toExponential(4)}, fixed on the train period. Test starts ${runs.monthly.series[runs.monthly.split]?.date}.

${table(runs.monthly)}

## Return statistics (full sample, daily)

| Statistic | Value |
| --- | ---: |
| Observations | ${stats.returns.n} |
| Mean | ${stats.returns.mean.toExponential(3)} |
| Std dev | ${stats.returns.sd.toFixed(5)} |
| Skewness | ${f2(stats.returns.skewness)} |
| Excess kurtosis | ${f2(stats.returns.excessKurtosis)} |
| Jarque-Bera | ${stats.returns.jarqueBera.toFixed(1)} (p ${stats.returns.jbPValue.toExponential(2)}) |
| Ljung-Box Q(10) on r² | ${stats.ljungBoxSq.q.toFixed(1)} (p ${stats.ljungBoxSq.pValue.toExponential(2)}) |

Excess kurtosis and the Ljung-Box result show fat tails and volatility clustering, which is the reason the rule is worth testing.

## Independent check

The engine was compared with a pandas/statsmodels implementation (\`test/reference_check.py\`).

${independent}

## Limits

One dataset, one split, one cost assumption, and a test window of roughly four years. Results depend on the window and are not investment advice.
`;

writeFileSync(`${base}.md`, md);
console.log(`wrote ${base}.md and ${base}.json`);
