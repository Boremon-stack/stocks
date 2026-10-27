import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCsv, compareSipVsVol, paperStudy, dailyReturns, describe, ljungBox } from '../public/js/backtest.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const stamp = new Date().toISOString().slice(0, 10);
const rf = 0;
const studyFrom = '2018-12-01';
const cmpOpts = {
  startDate: '2019-01-02',
  months: 240,
  rebalance: 'monthly',
  pool: 1000000,
  sip: 10000,
  window: 20,
  cost: 0.001,
  cashRate: 0,
  minExposure: 0,
  maxExposure: 1,
  scaling: 'variance',
  calibration: 'paper',
};
const avgOpts = { ...cmpOpts, calibration: 'average' };
const indices = [
  { key: 'nifty', file: 'public/data/nifty.csv', name: 'Nifty 50' },
  { key: 'banknifty', file: 'public/data/banknifty.csv', name: 'Bank Nifty' },
];
const testFiles = ['test/backtest.test.mjs', 'test/compare_closed_form.test.mjs'];

const isNil = (x) => x == null || Number.isNaN(x);
const pct = (x) => (isNil(x) ? 'n/a' : `${(x * 100).toFixed(2)}%`);
const pct4 = (x) => (isNil(x) ? 'n/a' : `${(x * 100).toFixed(4)}%`);
const signedPct = (x) => (isNil(x) ? 'n/a' : `${x < 0 ? '-' : '+'}${(Math.abs(x) * 100).toFixed(2)}%`);
const num = (x) => (isNil(x) ? 'n/a' : x.toFixed(2));
const signedNum = (x) => (isNil(x) ? 'n/a' : `${x < 0 ? '-' : '+'}${Math.abs(x).toFixed(2)}`);
const sci = (x) => (isNil(x) ? 'n/a' : x.toExponential(2));
const rs = (x) => (isNil(x) ? 'n/a' : `Rs ${(Math.round(x) + 0).toLocaleString('en-IN')}`);
const signedRs = (x) => (isNil(x) ? 'n/a' : `${x < 0 ? '-' : '+'}Rs ${(Math.round(Math.abs(x)) + 0).toLocaleString('en-IN')}`);
const pts = (x) => (isNil(x) ? 'n/a' : x.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const days = (x) => (isNil(x) ? 'n/a' : String(x));
const capLabel = (c) => (c == null ? 'none' : pct(c));
const rateText = (x) => (x ? `${(x * 100).toFixed(2)}% a year` : '0%');
const ep = (m) => m.drawdownEpisodes[0] ?? null;

const results = {};
for (const ix of indices) {
  const rows = parseCsv(readFileSync(`${root}${ix.file}`, 'utf8'));
  const cmp = compareSipVsVol(rows, cmpOpts);
  const cmpAvg = compareSipVsVol(rows, avgOpts);
  const studyRows = rows.filter((d) => d.date >= studyFrom);
  const study = paperStudy(studyRows, { rf });
  const r = dailyReturns(studyRows.map((d) => d.close)).slice(1);
  results[ix.key] = {
    name: ix.name,
    rows: rows.length,
    from: rows[0].date,
    to: rows[rows.length - 1].date,
    cmp,
    cmpAvg,
    study,
    daily: { returns: describe(r), ljungBoxSq: ljungBox(r.map((x) => x * x), 10) },
  };
}

const testRaw = (() => {
  try {
    return execFileSync(process.execPath, ['--test', ...testFiles], { cwd: root, encoding: 'utf8' });
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
const first = results.nifty.cmp.period.from;
const last = results.nifty.to;

const options = { compare: cmpOpts, compareAverage: avgOpts, study: { rf, from: studyFrom } };
const indexJson = Object.fromEntries(
  indices.map((ix) => {
    const x = results[ix.key];
    const strip = ({ series, ...rest }) => rest;
    return [
      ix.key,
      {
        name: x.name,
        rows: x.rows,
        from: x.from,
        to: x.to,
        compare: strip(x.cmp),
        compareAverage: strip(x.cmpAvg),
        study: x.study,
        daily: x.daily,
      },
    ];
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

const resultRows = (row) => [
  row('Final value', (m) => rs(m.final)),
  row('Profit or loss', (m) => rs(m.profit)),
  row('Return on the pool', (m) => pct(m.returnPct)),
  row('CAGR', (m) => pct(m.cagr)),
  row('Calmar ratio (CAGR over max drawdown)', (m) => num(m.calmar)),
  row('Maximum drawdown (trough)', (m) => `${pct(m.maxDrawdown)} (${m.troughDate})`),
  row('Drawdown peak date', (m) => ep(m)?.peakDate ?? 'n/a'),
  row('Drawdown trough date', (m) => ep(m)?.troughDate ?? 'n/a'),
  row('Drawdown recovered on', (m) => (ep(m) ? (ep(m).endDate ?? 'not recovered') : 'n/a')),
  row('Trading days, peak to trough', (m) => days(ep(m)?.tradingDaysToTrough)),
  row('Trading days, trough to recovery', (m) =>
    ep(m) ? (ep(m).tradingDaysToRecover == null ? 'not recovered' : String(ep(m).tradingDaysToRecover)) : 'n/a',
  ),
  row('Longest time below a high (trading days)', (m) => String(m.longestUnderwaterDays)),
  row('Worst day', (m) => pct(m.worstDay)),
  row('Best day', (m) => pct(m.bestDay)),
  row('Average share in the index', (m) => pct(m.avgExposure)),
  row('Annual volatility', (m) => pct(m.annVol)),
  row('Mean daily return', (m) => pct4(m.sharpeParts.meanDaily)),
  row('Standard deviation of daily return', (m) => pct4(m.sharpeParts.sdDaily)),
  row('Sharpe ratio', (m) => num(m.sharpe)),
  row('Costs paid', (m) => rs(m.costTotal)),
];

const investmentRows = (cmp) => {
  const s = cmp.sip.investments;
  const v = cmp.vol.investments;
  const dash = '-';
  return [
    ['SIP purchases', String(s.purchases), dash],
    ['Volatility trades', dash, String(v.trades)],
    ['Amount per SIP purchase', rs(s.perPurchase), dash],
    ['Buys', dash, String(v.buys)],
    ['Sells', dash, String(v.sells)],
    ['Total put in (SIP)', rs(s.totalPutIn), dash],
    ['Total bought', dash, rs(v.totalBought)],
    ['Total sold', dash, rs(v.totalSold)],
    ['Net put in', rs(s.totalPutIn), rs(v.netPutIn)],
    ['Turnover (bought plus sold)', dash, rs(v.turnover)],
    ['Average buy price (index points)', pts(s.averageBuyPrice), dash],
    ['Index holding at end', rs(s.finalIndexValue), rs(v.finalIndexValue)],
    ['Cash left', rs(s.cashLeft), rs(v.cashLeft)],
    ['Money-weighted return, per year', pct(s.moneyWeightedReturn), dash],
    ['Average money in index', dash, rs(v.averageInIndex)],
    ['Peak money in index', dash, rs(v.peakInIndex)],
    ['Lowest money in index', dash, rs(v.lowestInIndex)],
    ['Resets (monthly decisions)', dash, String(v.resets)],
  ];
};

const calibrationBlock = (cmp, heading) => {
  const s = cmp.sip;
  L.push(`#### ${heading}`, '');
  table(
    ['Metric', 'Monthly SIP', 'Volatility-based'],
    resultRows((label, f) => [label, f(s), f(cmp.vol)]),
  );
  L.push('#### Investments', '');
  table(['Item', 'Monthly SIP', 'Volatility-based'], investmentRows(cmp));
  L.push(
    `Period ${cmp.period.from} to ${cmp.period.to}, ${cmp.period.days} trading days, SIP purchases ${cmp.sip.investments.purchases}, ` +
      `return on money put in (per year) ${pct(cmp.sip.investments.moneyWeightedReturn)}.`,
    '',
  );
};

L.push(`# Past results study log, ${stamp}`, '');
L.push(
  `Data are daily closes of ^NSEI and ^NSEBANK from Yahoo Finance, ${first} to ${last}, price indices without dividends. ` +
    'Both plans start from a pool of Rs 10,00,000, and the monthly SIP of Rs 10,000 is drawn from that same pool. ' +
    'The volatility plan sets its share of the pool at each monthly reset from the 20-day realized variance, ' +
    'capped at 100% of the pool with no leverage and 0% as the floor, and pays a cost of 0.10% per unit of exposure change. ' +
    'Two calibrations are reported. The paper calibration sets one constant c over the whole period (the paper\'s normalisation, which uses hindsight). ' +
    'The running-average calibration uses the expanding average of past variance as the reference instead. ' +
    `Idle cash earns ${rateText(cmpOpts.cashRate)} and the risk-free rate is ${rateText(rf)}. ` +
    'The 100% cap follows the paper\'s No Leverage variant (Table IV, p.45: alpha 2.12% against 4.86% unconstrained). ' +
    'Raw prices are not committed except the bundled public/data CSVs.',
  '',
);

L.push('## SIP against volatility-based plan', '');
for (const ix of indices) {
  const x = results[ix.key];
  L.push(`### ${x.name}`, '');
  calibrationBlock(x.cmp, 'Paper calibration (constant c over the whole period)');
  calibrationBlock(x.cmpAvg, 'Running-average calibration (expanding average variance as reference)');
}

L.push('## Is the volatility signal doing anything?', '');
for (const ix of indices) {
  const x = results[ix.key];
  const line = (label, cmp) => {
    const t = cmp.timingEffect;
    return [
      label,
      pct(cmp.control.share),
      signedRs(t.finalDiff),
      signedNum(t.sharpeDiff),
      signedPct(t.maxDrawdownDiff),
      signedNum(t.calmarDiff),
    ];
  };
  L.push(`### ${x.name}`, '');
  table(
    [
      'Calibration',
      'Control share (constant)',
      'Final value, volatility minus control',
      'Sharpe, difference',
      'Max drawdown, difference (positive means shallower)',
      'Calmar, difference',
    ],
    [line('Paper', x.cmp), line('Running average', x.cmpAvg)],
  );
  L.push(
    'The control holds a constant share equal to the volatility plan average share; positive differences favour the volatility plan, and the figures describe one sample path with no significance test.',
    '',
  );
}

L.push('## Paper statistics', '');
for (const ix of indices) {
  const x = results[ix.key];
  const st = x.study;
  const pr = st.persistence;
  const pa = st.paper;
  const w = pa.weights;
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

  L.push('#### Managed versus original regression (zero cost, c over the full sample)', '');
  table(
    ['Statistic', 'Value'],
    [
      ['Alpha, annual', pct(pa.alphaAnnual)],
      ['Beta', num(pa.beta)],
      ['t(alpha)', num(pa.tAlpha)],
      ['Robust t(alpha)', num(pa.tAlphaRobust)],
      ['R2', num(pa.r2)],
      ['Appraisal ratio, annual', num(pa.appraisalAnnual)],
      ['Sharpe original', num(pa.sharpeOriginal)],
      ['Sharpe managed', num(pa.sharpeManaged)],
      ['Sharpe increase', pct(pa.sharpeIncrease)],
      ['Sharpe from alpha formula', num(pa.sharpeCombined)],
      ['Utility gain', pct(pa.utilityGain)],
      ['Monthly sd, original', pct(pa.sdOriginal)],
      ['Monthly sd, managed', pct(pa.sdManaged)],
      ['Expected return, annual (managed)', pct(pa.expectedReturnAnnual)],
      ['c', sci(pa.c)],
      ['Max weight', pct(pa.maxWeight)],
      ['Average absolute weight change per month', pct(pa.avgAbsWeightChange)],
      ['Alpha after 1 bp cost, annual', pct(pa.alphaAfterCost['1'])],
      ['Alpha after 10 bp cost, annual', pct(pa.alphaAfterCost['10'])],
      ['Alpha after 14 bp cost, annual', pct(pa.alphaAfterCost['14'])],
      ['Break-even cost (bp per unit of exposure change)', num(pa.breakEvenBp)],
    ],
  );

  L.push('#### Weight percentiles (uncapped, share of the pool)', '');
  table(
    ['Series', 'p50', 'p75', 'p90', 'p99', 'max'],
    [['Monthly weight', pct(w.p50), pct(w.p75), pct(w.p90), pct(w.p99), pct(w.max)]],
  );

  L.push('#### Variants', '');
  table(
    ['Variant', 'Alpha, annual', 'Robust t(alpha)', 'Appraisal ratio, annual', 'Sharpe managed', 'Average absolute weight change', 'Break-even cost (bp)', 'Weight p50', 'Weight p99'],
    st.variants.map((v) => [
      v.label,
      pct(v.alphaAnnual),
      num(v.tAlphaRobust),
      num(v.appraisalAnnual),
      num(v.sharpeManaged),
      pct(v.avgAbsWeightChange),
      num(v.breakEvenBp),
      pct(v.weights.p50),
      pct(v.weights.p99),
    ]),
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
  'The tests in test/backtest.test.mjs and test/compare_closed_form.test.mjs compare the JS engine with independent pandas, scipy and statsmodels implementations ' +
    '(test/reference_compare.py and test/reference_study.py), field by field. ' +
    `Running node --test test/backtest.test.mjs test/compare_closed_form.test.mjs reports ${tests.pass ?? 'an unparsed number of'} passing and ` +
    `${tests.fail ?? 'an unparsed number of'} failing tests; the raw output is in logs/test-${stamp}.txt. ` +
    'Regenerate the fixtures with python test/reference_compare.py and python test/reference_study.py. ' +
    `Python package versions (pandas, numpy, scipy, statsmodels): ${python}.`,
  '',
);

L.push('## Limits', '');
L.push(
  `One sample period (${first} to ${last}): ${results.nifty.study.n} monthly observations for Nifty 50 and ${results.banknifty.study.n} for Bank Nifty, ` +
    "against the paper's 1,065, so the paper statistics have low power. " +
    'The constant c is set over the whole period with hindsight, as in the paper. ' +
    'The cap is 100% of the pool, which is the paper\'s No Leverage variant. ' +
    'Idle cash and the risk-free rate are 0%. ' +
    'Price indices exclude dividends, so index returns are understated against total return. ' +
    'The SIP is funded from the same pool, and the paper statistics are computed at zero cost with costs shown separately. ' +
    'One cost assumption (0.10% per unit of exposure change) drives the cost rows, with the alpha-after-cost rows at 1, 10 and 14 bp. ' +
    'No taxes. Results depend on the period and these assumptions and are not investment advice.',
  '',
);

const md = L.join('\n');
writeFileSync(`${base}.md`, md);
console.log(md);
