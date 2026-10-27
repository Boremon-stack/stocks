import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCsv, compareSipVsVol, paperStudy, dailyReturns, describe, ljungBox } from '../public/js/backtest.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const stamp = new Date().toISOString().slice(0, 10);
const rf = 0.065;
const studyFrom = '2018-12-01';
const cmpOpts = {
  startDate: '2019-01-02',
  months: 240,
  rebalance: 'monthly',
  pool: 1000000,
  sip: 10000,
  window: 20,
  cost: 0.001,
  cashRate: 0.065,
  minExposure: 0,
  maxExposure: 1,
};
const indices = [
  { key: 'nifty', file: 'public/data/nifty.csv', name: 'Nifty 50' },
  { key: 'banknifty', file: 'public/data/banknifty.csv', name: 'Bank Nifty' },
];

const pct = (x) => (x == null || Number.isNaN(x) ? 'n/a' : `${(x * 100).toFixed(2)}%`);
const num = (x) => (x == null || Number.isNaN(x) ? 'n/a' : x.toFixed(2));
const sci = (x) => (x == null || Number.isNaN(x) ? 'n/a' : x.toExponential(2));
const rs = (x) => `Rs ${Math.round(x).toLocaleString('en-IN')}`;
const capLabel = (c) => (c == null ? 'none' : pct(c));

const results = {};
for (const ix of indices) {
  const rows = parseCsv(readFileSync(`${root}${ix.file}`, 'utf8'));
  const cmp = compareSipVsVol(rows, cmpOpts);
  const studyRows = rows.filter((d) => d.date >= studyFrom);
  const study = paperStudy(studyRows, { rf });
  const r = dailyReturns(studyRows.map((d) => d.close)).slice(1);
  results[ix.key] = {
    name: ix.name,
    rows: rows.length,
    from: rows[0].date,
    to: rows[rows.length - 1].date,
    cmp,
    study,
    daily: { returns: describe(r), ljungBoxSq: ljungBox(r.map((x) => x * x), 10) },
  };
}

const testRaw = (() => {
  try {
    return execFileSync(process.execPath, ['--test', 'test/backtest.test.mjs'], { cwd: root, encoding: 'utf8' });
  } catch (err) {
    return err.stdout ?? '';
  }
})();
const count = (label) => {
  const m = testRaw.match(new RegExp(`(?:\\u2139|#) ${label} (\\d+)`));
  return m ? Number(m[1]) : null;
};
const tests = { pass: count('pass'), fail: count('fail') };

let python = 'unavailable';
try {
  python = execFileSync(
    'python',
    ['-c', 'import pandas, numpy, scipy, statsmodels; print(pandas.__version__, numpy.__version__, scipy.__version__, statsmodels.__version__)'],
    { cwd: root, encoding: 'utf8' },
  ).trim();
} catch {
  python = 'unavailable';
}

mkdirSync(`${root}logs`, { recursive: true });
const base = `${root}logs/study-${stamp}`;
const last = results.nifty.to;

const options = { compare: cmpOpts, study: { rf, from: studyFrom } };
const indexJson = Object.fromEntries(
  indices.map((ix) => {
    const x = results[ix.key];
    const { series, ...compare } = x.cmp;
    return [ix.key, { name: x.name, rows: x.rows, from: x.from, to: x.to, compare, study: x.study, daily: x.daily }];
  }),
);

writeFileSync(`${root}logs/test-${stamp}.txt`, testRaw);
writeFileSync(
  `${base}.json`,
  JSON.stringify({ generated: stamp, options, indices: indexJson, tests, python }, null, 2),
);

const L = [];
const table = (head, rows) => {
  L.push(`| ${head.join(' | ')} |`, `| ${head.map((_, i) => (i === 0 ? '---' : '---:')).join(' | ')} |`);
  for (const row of rows) L.push(`| ${row.join(' | ')} |`);
  L.push('');
};

L.push(`# Past results study log, ${stamp}`, '');
L.push(
  `Data are daily closes of ^NSEI and ^NSEBANK from Yahoo Finance, 2019-01 to ${last}, price indices without dividends. ` +
    'Pool Rs 10,00,000; monthly SIP Rs 10,000 against the volatility-based plan (20-day window, exposure reset monthly, ' +
    'between 0% and 100% of the pool, expanding average variance as the reference, cost 0.10% per unit of exposure change, ' +
    'idle cash and risk-free 6.50% a year). Raw prices are not committed except the bundled public/data CSVs.',
  '',
);

L.push('## SIP against volatility-based plan', '');
for (const ix of indices) {
  const x = results[ix.key];
  const s = x.cmp.sip;
  const v = x.cmp.vol;
  const row = (label, f) => [label, f(s), f(v)];
  L.push(`### ${x.name}`, '');
  table(
    ['Metric', 'Monthly SIP', 'Volatility-based'],
    [
      row('Final value', (m) => rs(m.final)),
      row('Profit or loss', (m) => rs(m.profit)),
      row('Return on the pool', (m) => pct(m.returnPct)),
      row('Maximum drawdown (trough)', (m) => `${pct(m.maxDrawdown)} (${m.troughDate})`),
      row('Longest time below a high (trading days)', (m) => String(m.longestUnderwaterDays)),
      row('Worst day', (m) => pct(m.worstDay)),
      row('Best day', (m) => pct(m.bestDay)),
      row('Average share in the index', (m) => pct(m.avgExposure)),
      row('Annual volatility', (m) => pct(m.annVol)),
      row('Sharpe ratio', (m) => num(m.sharpe)),
      row('Costs paid', (m) => rs(m.costTotal)),
    ],
  );
  L.push(
    `Period ${x.cmp.period.from} to ${x.cmp.period.to}, ${x.cmp.period.days} trading days, SIP purchases ${s.purchases}, ` +
      `return on money put in (per year) ${pct(s.moneyWeightedReturn)}.`,
    '',
  );
}

L.push('## Paper statistics', '');
for (const ix of indices) {
  const x = results[ix.key];
  const st = x.study;
  const pr = st.persistence;
  const pa = st.paper;
  L.push(`### ${x.name}`, '');

  L.push('#### Persistence (levels and logs)', '');
  table(
    ['Statistic', 'Levels', 'Logs'],
    [
      ['Observations', String(pr.rv.n), String(pr.logRv.n)],
      ['Correlation', num(pr.rv.corr), num(pr.logRv.corr)],
      ['Slope', num(pr.rv.slope), num(pr.logRv.slope)],
      ['t of slope', num(pr.rv.tSlope), num(pr.logRv.tSlope)],
      ['R2', num(pr.rv.r2), num(pr.logRv.r2)],
    ],
  );

  const pd = st.predictability;
  const pt = st.predictabilityTrimmed;
  L.push('#### Predictability (excess return on lagged variance)', '');
  table(
    ['Statistic', 'Value'],
    [
      ['Observations', String(pd.n)],
      ['Correlation', num(pd.corr)],
      ['Slope', num(pd.slope)],
      ['t of slope', num(pd.tSlope)],
      ['R2', num(pd.r2)],
      ['Excluding the highest 5% of last-month variance', `correlation ${num(pt.corr)}, slope ${num(pt.slope)}, t ${num(pt.tSlope)}, R2 ${num(pt.r2)}, ${pt.dropped} months dropped`],
    ],
  );

  L.push('#### Quintile groups by lagged variance', '');
  table(
    ['Group', 'Months', 'Avg last-month variance', 'Avg variance', 'Avg excess return', 'Return/variance'],
    st.quintiles.map((g) => [
      String(g.group),
      String(g.n),
      sci(g.avgLagRv),
      sci(g.avgRv),
      pct(g.avgExcess),
      num(g.meanVarianceRatio),
    ]),
  );

  L.push('#### Managed versus original regression', '');
  table(
    ['Statistic', 'Value'],
    [
      ['Alpha, annual', pct(pa.alphaAnnual)],
      ['Beta', num(pa.beta)],
      ['t(alpha)', num(pa.tAlpha)],
      ['R2', num(pa.r2)],
      ['Appraisal ratio, annual', num(pa.appraisalAnnual)],
      ['Sharpe original', num(pa.sharpeOriginal)],
      ['Sharpe managed', num(pa.sharpeManaged)],
      ['Sharpe increase', pct(pa.sharpeIncrease)],
      ['Sharpe from alpha formula', num(pa.sharpeCombined)],
      ['Utility gain', pct(pa.utilityGain)],
      ['Monthly sd, original', pct(pa.sdOriginal)],
      ['Monthly sd, managed', pct(pa.sdManaged)],
      ['c', sci(pa.c)],
      ['Max weight', pct(pa.maxWeight)],
    ],
  );

  L.push('#### Cost and cap rows', '');
  table(
    ['Cap', 'Cost (bp)', 'Alpha, annual', 't(alpha)'],
    st.costs.map((c) => [capLabel(c.cap), num(c.cost * 10000), pct(c.alphaAnnual), num(c.tAlpha)]),
  );
}

L.push('## Daily return statistics', '');
table(
  [
    'Index',
    'Days',
    'Mean',
    'SD',
    'Skewness',
    'Excess kurtosis',
    'Jarque-Bera (p)',
    'Ljung-Box Q(10) on squared returns (p)',
  ],
  indices.map((ix) => {
    const d = results[ix.key].daily;
    return [
      results[ix.key].name,
      String(d.returns.n),
      pct(d.returns.mean),
      pct(d.returns.sd),
      num(d.returns.skewness),
      num(d.returns.excessKurtosis),
      sci(d.returns.jbPValue),
      sci(d.ljungBoxSq.pValue),
    ];
  }),
);

L.push('## Independent check', '');
L.push(
  `The tests in test/backtest.test.mjs, run with node --test, report ${tests.pass ?? 'an unparsed number of'} passing and ` +
    `${tests.fail ?? 'an unparsed number of'} failing tests. ` +
    'The tests compare the JS engine with independent pandas, scipy and statsmodels reference fixtures in test/. ' +
    'Regenerate them with python test/reference_compare.py and python test/reference_study.py. ' +
    `Python package versions (pandas, numpy, scipy, statsmodels): ${python}.`,
  '',
);

L.push('## Limits', '');
L.push(
  'One sample period (2019 to 2026, about 94 months), price indices without dividends, no taxes, a single cost assumption, ' +
    'and small-sample statistics with low power. Results depend on the period and the assumptions above and are not investment advice.',
  '',
);

const md = L.join('\n');
writeFileSync(`${base}.md`, md);
console.log(md);
