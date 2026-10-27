import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCsv, dcaVsVm, paperStudy } from '../public/js/backtest.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const stamp = new Date().toISOString().slice(0, 10);
const opts = { monthly: 10000, maxExposure: 1, costBps: 0 };
const indices = [
  { key: 'nifty', name: 'Nifty 50', file: 'public/data/nifty50.csv' },
  { key: 'banknifty', name: 'Bank Nifty', file: 'public/data/banknifty.csv' },
];
const testFiles = ['test/backtest.test.mjs', 'test/dcavm.test.mjs'];

const isNil = (x) => x == null || Number.isNaN(x);
const pct = (x) => (isNil(x) ? 'n/a' : `${(x * 100).toFixed(2)}%`);
const num = (x) => (isNil(x) ? 'n/a' : x.toFixed(2));
const sci = (x) => (isNil(x) ? 'n/a' : x.toExponential(2));
const grp = (x) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(x) + 0);
const inr = (x) => (isNil(x) ? 'n/a' : grp(x));
const rs = (x) => (isNil(x) ? 'n/a' : `Rs ${grp(x)}`);
const signedInr = (x) => `${x < 0 ? '-' : '+'}Rs ${grp(Math.abs(x))}`;
const signedPct = (x) => `${x < 0 ? '-' : '+'}${pct(Math.abs(x))}`;
const signedNum = (x) => `${x < 0 ? '-' : '+'}${num(Math.abs(x))}`;
const pts = (x) => (isNil(x) ? 'n/a' : x.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const str = (x) => (x == null ? 'n/a' : String(x));
const dash = '-';

const table = (L, head, rows) => {
  L.push(`| ${head.join(' | ')} |`, `| ${head.map((_, i) => (i === 0 ? '---' : '---:')).join(' | ')} |`);
  for (const r of rows) L.push(`| ${r.join(' | ')} |`);
  L.push('');
};

const results = indices.map((ix) => {
  const rows = parseCsv(readFileSync(`${root}${ix.file}`, 'utf8'));
  return { ...ix, run: dcaVsVm(rows, opts), study: paperStudy(rows, { rf: 0 }) };
});

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

const L = [];
const period = results[0].run.period;
L.push(`# Owner method study log, ${stamp}`, '');
L.push(
  'Method: monthly dollar-cost averaging (DCA) against a volatility-managed plan (VM) on the same monthly contributions. ' +
    'Each plan receives Rs 10,000 on the first trading day of each month (monthly 10,000, maximum exposure 100%, cost 0 bp). ' +
    "DCA buys the full amount at once. VM sets its target share of the index from last month's realized variance, " +
    'scaled by the mean of earlier scaled values and capped at the maximum exposure, and rebalances to that share on each contribution day. ' +
    'Idle cash earns 0%. Data are daily closes from the NSE official files in public/data, price indices without dividends, ' +
    `${period.from} to ${period.to}.`,
  '',
);

L.push('## 1. Summary metrics (owner script columns)', '');
for (const r of results) {
  L.push(`### ${r.name}`, '');
  const sum = (m) => [
    inr(m.endingEquity),
    inr(m.totalContributions),
    inr(m.profit),
    pct(m.twrCumulative),
    pct(m.twrCagr),
    pct(m.annVol),
    num(m.sharpe),
    pct(m.maxDrawdown),
  ];
  table(
    L,
    ['Strategy', 'Ending equity (INR)', 'Total contributions (INR)', 'Profit vs contributions (INR)', 'TWR cumulative return', 'TWR CAGR', 'Annualized volatility', 'Sharpe (risk-free=0)', 'Maximum drawdown'],
    [
      ['DCA', ...sum(r.run.metrics.dca)],
      ['VM', ...sum(r.run.metrics.vm)],
    ],
  );
}

L.push('## 2. Extras by plan', '');
for (const r of results) {
  const ep = (m) => m.drawdownEpisodes[0] ?? null;
  const row = (label, f) => [label, f(r.run.metrics.dca), f(r.run.metrics.vm)];
  L.push(`### ${r.name}`, '');
  table(L, ['Metric', 'DCA', 'VM'], [
    row('Calmar ratio (CAGR over max drawdown)', (m) => num(m.calmar)),
    row('Deepest drawdown', (m) => (ep(m) ? pct(ep(m).depth) : 'n/a')),
    row('Deepest drawdown: peak date', (m) => str(ep(m)?.peakDate)),
    row('Deepest drawdown: low date', (m) => str(ep(m)?.troughDate)),
    row('Deepest drawdown: recovery date', (m) => (ep(m) ? (ep(m).endDate ?? 'not recovered') : 'n/a')),
    row('Trading days, peak to low', (m) => str(ep(m)?.tradingDaysToTrough)),
    row('Trading days, low to recovery', (m) => (ep(m) ? (ep(m).tradingDaysToRecover == null ? 'not recovered' : String(ep(m).tradingDaysToRecover)) : 'n/a')),
    row('Longest time underwater (trading days)', (m) => String(m.longestUnderwaterDays)),
    row('Worst day', (m) => pct(m.worstDay)),
    row('Best day', (m) => pct(m.bestDay)),
    row('Average share in the index', (m) => pct(m.avgExposure)),
    row('Money-weighted return, per year', (m) => pct(m.moneyWeightedReturn)),
  ]);
  const d = r.run.metrics.dca.investments;
  const v = r.run.metrics.vm.investments;
  table(L, ['Investments', 'DCA', 'VM'], [
    ['DCA purchases', String(d.purchases), dash],
    ['VM contributions', dash, String(v.contributions)],
    ['VM rebalances', dash, String(v.rebalances)],
    ['Total put in (INR)', rs(d.totalContributions), rs(v.totalContributions)],
    ['Average buy price (index points)', pts(d.averageBuyPrice), dash],
    ['VM trades', dash, String(v.trades)],
    ['VM buys', dash, String(v.buys)],
    ['VM sells', dash, String(v.sells)],
    ['Total bought (INR)', rs(d.totalBought), rs(v.totalBought)],
    ['Total sold (INR)', dash, rs(v.totalSold)],
    ['Turnover, bought plus sold (INR)', dash, rs(v.turnover)],
    ['Average target exposure', dash, pct(v.averageTargetExposure)],
    ['Average money in the index (INR)', dash, rs(v.averageInIndex)],
    ['Costs paid (INR)', rs(d.fees), rs(v.fees)],
  ]);
}

L.push('## 3. Constant-target control and timing effect', '');
for (const r of results) {
  const vmM = r.run.metrics.vm;
  const c = r.run.control;
  const t = r.run.timingEffect;
  L.push(`### ${r.name}`, '');
  table(L, ['Metric', 'VM', 'Constant-target control'], [
    ['Target share', pct(r.run.metrics.vm.investments.averageTargetExposure), pct(c.share)],
    ['Ending equity (INR)', rs(vmM.endingEquity), rs(c.endingEquity)],
    ['TWR CAGR', pct(vmM.twrCagr), pct(c.twrCagr)],
    ['Sharpe (risk-free=0)', num(vmM.sharpe), num(c.sharpe)],
    ['Maximum drawdown', pct(vmM.maxDrawdown), pct(c.maxDrawdown)],
    ['Calmar ratio', num(vmM.calmar), num(c.calmar)],
  ]);
  table(L, ['Timing effect (VM minus control)', 'Value'], [
    ['Ending equity (INR)', signedInr(t.endingEquityDiff)],
    ['TWR CAGR', signedPct(t.twrCagrDiff)],
    ['Sharpe', signedNum(t.sharpeDiff)],
    ['Maximum drawdown (positive means shallower)', signedPct(t.maxDrawdownDiff)],
  ]);
  L.push(
    'The control holds one constant target share equal to the average target exposure of the VM plan, so the differences above isolate the effect of the monthly timing on this one sample path, with no significance test.',
    '',
  );
}

L.push('## 4. Paper statistics (paperStudy, rf 0)', '');
for (const r of results) {
  const st = r.study;
  const pa = st.paper;
  const pr = st.persistence;
  const pd = st.predictability;
  const pt = st.predictabilityTrimmed;
  const w = pa.weights;
  L.push(`### ${r.name}`, '');
  L.push(`Sample ${st.from} to ${st.to}, ${st.n} monthly observations.`, '');
  table(L, ['Statistic', 'Value'], [
    ['Alpha, annual', pct(pa.alphaAnnual)],
    ['t(alpha)', num(pa.tAlpha)],
    ['Robust t(alpha)', num(pa.tAlphaRobust)],
    ['Appraisal ratio, annual', num(pa.appraisalAnnual)],
    ['Sharpe original', num(pa.sharpeOriginal)],
    ['Sharpe managed', num(pa.sharpeManaged)],
    ['Break-even cost (bp per unit of exposure change)', num(pa.breakEvenBp)],
    ['Constant c', sci(pa.c)],
    ['Max weight', pct(pa.maxWeight)],
    ['Weight p50 / p75 / p90 / p99 / max', [w.p50, w.p75, w.p90, w.p99, w.max].map(pct).join(' / ')],
  ]);
  table(L, ['Persistence of variance', 'Levels', 'Logs'], [
    ['Correlation', num(pr.rv.corr), num(pr.logRv.corr)],
    ['t of slope', num(pr.rv.tSlope), num(pr.logRv.tSlope)],
    ['R2', num(pr.rv.r2), num(pr.logRv.r2)],
  ]);
  table(L, ['Predictability (excess return on lagged variance)', 'Value'], [
    ['t of slope', num(pd.tSlope)],
    ['Correlation', num(pd.corr)],
    ['R2', num(pd.r2)],
    [`Trimmed (highest ${pt.trimmedShare * 100}% of lagged variance removed, ${pt.dropped} months)`, `t ${num(pt.tSlope)}, correlation ${num(pt.corr)}, R2 ${num(pt.r2)}`],
  ]);
  table(L, ['Variant', 'Alpha, annual', 'Robust t(alpha)', 'Appraisal ratio, annual', 'Sharpe managed', 'Break-even cost (bp)', 'Weight p50', 'Weight p99'],
    st.variants.map((v) => [
      v.label,
      pct(v.alphaAnnual),
      num(v.tAlphaRobust),
      num(v.appraisalAnnual),
      num(v.sharpeManaged),
      num(v.breakEvenBp),
      pct(v.weights.p50),
      pct(v.weights.p99),
    ]),
  );
}

L.push('## Independent checks', '');
L.push(
  'The engine daily rows and summary metrics agree with the owner Python script outputs with 0 differences at 1e-9 for Nifty 50, ' +
    'both the default run and the alternative parameter set (monthly 20,000, maximum exposure 0.8, cost 5 bp), and for Bank Nifty (default run). ' +
    'Fixtures are in test/fixtures/user; the comparison is in test/dcavm.test.mjs. ' +
    'The extras (Calmar, drawdown episodes, time underwater, money-weighted return, investment counts) agree with an independent pandas implementation ' +
    '(test/reference_dcavm_extras.py and test/reference_dcavm_extras_bank.json). ' +
    `Running node --test test/backtest.test.mjs test/dcavm.test.mjs reports ${tests.pass ?? 'an unparsed number of'} passing and ` +
    `${tests.fail ?? 'an unparsed number of'} failing tests; the raw output is in logs/test-${stamp}.txt.`,
  '',
);

L.push('## Limits', '');
L.push(
  `${results.map((r) => `${r.run.period.months} monthly observations for ${r.name}`).join(' and ')}, ` +
    `from ${period.from} to ${period.to}, so every statistic rests on one short sample. ` +
    'Price indices exclude dividends, so index returns are understated against total return. ' +
    'Cash earns 0%. The first two months have target 0 by construction, because no prior month variance exists yet. ' +
    'The method is a practical adaptation of Moreira and Muir (2017), not an exact replication of that paper. ' +
    'No taxes or slippage beyond the cost input (0 bp here). Results are a historical back-test, not investment advice.',
  '',
);

for (const f of ['logs/study-2026-10-27.md', 'logs/study-2026-10-27.json', 'logs/test-2026-10-27.txt']) {
  rmSync(`${root}${f}`, { force: true });
}
mkdirSync(`${root}logs`, { recursive: true });
const md = L.join('\n');
writeFileSync(`${root}logs/study-${stamp}.md`, md);
writeFileSync(`${root}logs/test-${stamp}.txt`, testRaw);
writeFileSync(
  `${root}logs/study-${stamp}.json`,
  JSON.stringify(
    {
      generated: stamp,
      options: opts,
      tests,
      indices: Object.fromEntries(
        results.map((r) => [
          r.key,
          {
            name: r.name,
            file: r.file,
            params: r.run.params,
            period: r.run.period,
            metrics: r.run.metrics,
            control: { ...r.run.control, tradeList: undefined },
            timingEffect: r.run.timingEffect,
            paper: r.study,
          },
        ]),
      ),
    },
    null,
    2,
  ),
);
console.log(md);
