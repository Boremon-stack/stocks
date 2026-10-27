import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseCsv, parseCsvDetailed, toIsoDate, dailyReturns, rollingVariance, summarize, backtest, describe, ljungBox, ols, WINDOW } from '../public/js/backtest.js';
import { cpuRun, createCompute } from '../public/js/compute.js';

const load = (name) => parseCsv(readFileSync(new URL(`../local-data/${name}`, import.meta.url), 'utf8'));
const nifty = load('nifty50.csv');
const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test('every NSE dataset parses with long history', () => {
  for (const f of readdirSync(new URL('../local-data/', import.meta.url))) {
    if (!f.endsWith('.csv')) continue;
    const rows = load(f);
    assert.ok(rows.length > 1000, `${f} has ${rows.length} rows`);
    assert.ok(rows.every((r) => r.close > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.date)));
  }
});

test('parser rejects a file without date and close columns', () => {
  assert.throws(() => parseCsv('a,b\n1,2'), /date and close/);
});

test('daily returns follow r = P_t / P_{t-1} - 1', () => {
  const r = dailyReturns([100, 103, 99]);
  close(r[1], 0.03, 1e-12);
  close(r[2], 99 / 103 - 1, 1e-12);
});

test('rolling variance is the mean of the last 20 squared returns', () => {
  const r = Array.from({ length: 25 }, (_, i) => (i % 2 ? 0.01 : -0.01));
  const v = rollingVariance(r);
  assert.ok(Number.isNaN(v[WINDOW - 2]));
  close(v[WINDOW - 1], 0.0001, 1e-12);
});

test('summarize: zero drawdown on a rising series, drawdown on a fall', () => {
  assert.equal(summarize([0.01, 0.02, 0.03]).maxDrawdown, 0);
  close(summarize([0.1, -0.5]).maxDrawdown, -0.5, 1e-12);
});

test('daily exposure is capped and uses only information up to t-1', () => {
  const bt = backtest(nifty, { mode: 'daily', maxExposure: 1 });
  assert.ok(bt.series.every((d) => d.weight >= 0 && d.weight <= 1));
  const r = dailyReturns(nifty.map((d) => d.close));
  const v = rollingVariance(r);
  const idx = bt.series.findIndex((d) => d.date === nifty[WINDOW + 5].date);
  close(bt.series[idx].weight, Math.min(1, bt.c / v[WINDOW + 4]), 1e-12);
});

test('split is about 70% and the test period is non-empty', () => {
  const bt = backtest(nifty, { mode: 'daily' });
  const share = bt.split / bt.series.length;
  assert.ok(Math.abs(share - 0.7) < 0.02, `share ${share}`);
  assert.ok(bt.outOfSample.buyHold.periods > 0);
});

test('costs never raise managed return', () => {
  const free = backtest(nifty, { mode: 'daily', cost: 0 }).outOfSample.strategy.cumulative;
  const costly = backtest(nifty, { mode: 'daily', cost: 0.001 }).outOfSample.strategy.cumulative;
  assert.ok(costly <= free);
});

test('cpu kernel computes a*x + y', () => {
  const out = cpuRun('saxpy', Float32Array.from([1, 2]), Float32Array.from([10, 20]), { a: 3 });
  assert.deepEqual([...out], [13, 26]);
});

test('compute falls back to cpu outside a browser', () => {
  assert.equal(createCompute({ prefer: 'gpu' }).backend, 'cpu');
});


const ref = JSON.parse(readFileSync(new URL('./reference_nifty50.json', import.meta.url), 'utf8'));
const opts = { cost: ref.cost, rf: ref.rf };
const METRICS = ['periods', 'cumulative', 'cagr', 'annVol', 'sharpe', 'maxDrawdown'];
const REG = ['n', 'alphaAnnual', 'beta', 'tAlpha', 'r2', 'rmse', 'appraisalAnnual', 'sharpeOriginal', 'sharpeCombined', 'utilityGain'];
const same = (got, want, keys, label) => {
  for (const k of keys) {
    if (want[k] === null) assert.equal(got[k], null, label + '.' + k);
    else close(got[k], want[k], Math.max(1e-9, Math.abs(want[k]) * 1e-9));
  }
};

for (const mode of ['daily', 'monthly']) {
  test(`${mode} mode matches the independent pandas reference field by field (Nifty 50)`, () => {
    const bt = backtest(nifty, { ...opts, mode });
    const want = ref[mode];
    close(bt.c, want.c, Math.abs(want.c) * 1e-9);
    same(bt.outOfSample.buyHold, want.oos_bh, METRICS, 'oos_bh');
    same(bt.outOfSample.strategy, want.oos_st, METRICS, 'oos_st');
    same(bt.insample.buyHold, want.is_bh, METRICS, 'is_bh');
    same(bt.insample.strategy, want.is_st, METRICS, 'is_st');
    same(bt.regression.full, want.reg_full, REG, 'reg_full');
    same(bt.regression.test, want.reg_test, REG, 'reg_test');
  });
}

test('monthly mode with full-sample normalisation (the paper) matches the reference', () => {
  const bt = backtest(nifty, { ...opts, mode: 'monthly', normalize: 'full' });
  close(bt.c, ref.monthly.c_full, Math.abs(ref.monthly.c_full) * 1e-9);
  same(bt.regression.full, ref.monthly.reg_full_normalized_full_sample, REG, 'reg_full_fullc');
});

test('return statistics match the pandas and scipy reference (Nifty 50)', () => {
  const r = dailyReturns(nifty.map((d) => d.close)).slice(1);
  const d = describe(r);
  const lb = ljungBox(r.map((x) => x * x), 10);
  close(d.mean, ref.stats.mean, 1e-12);
  close(d.sd, ref.stats.sd, 1e-12);
  close(d.skewness, ref.stats.skewness, 1e-9);
  close(d.excessKurtosis, ref.stats.excessKurtosis, 1e-7);
  close(d.jarqueBera / ref.stats.jarqueBera, 1, 1e-9);
  close(lb.q / ref.stats.ljungBoxQ, 1, 1e-9);
  close(lb.pValue / ref.stats.ljungBoxP, 1, 1e-6);
});

test('paper regression recovers a known alpha and beta', () => {
  const x = Array.from({ length: 50 }, (_, i) => Math.sin(i) * 0.02);
  const y = x.map((v, i) => 0.004 + 0.6 * v + (i % 2 ? 1e-4 : -1e-4));
  const reg = ols(y, x);
  close(reg.alpha, 0.004, 2e-4);
  close(reg.beta, 0.6, 2e-2);
});

test('parser reads an NSE-style quoted, newest-first, DD-Mon-YYYY file', () => {
  const nse = [
    '"Date","Open","High","Low","Close","Shares Traded","Turnover (₹ Cr)"',
    '"29-Oct-2025","25,900.00","26,000.00","25,800.00","25,953.90","300,000","1,000.00"',
    '"28-Oct-2025","25,800.00","25,900.00","25,700.00","25,850.10","310,000","1,100.00"',
    '"27-Oct-2025","25,700.00","25,800.00","25,600.00","25,750.55","290,000","950.00"',
  ].join('\n');
  const { rows, notes } = parseCsvDetailed(nse);
  assert.deepEqual(rows.map((r) => r.date), ['2025-10-27', '2025-10-28', '2025-10-29']);
  close(rows[2].close, 25953.9, 1e-9);
  assert.ok(notes.some((n) => /sorted oldest first/.test(n)));
});

test('parser picks Close, not PREV. CLOSE, and drops duplicate dates', () => {
  const text = 'Date,PREV. CLOSE,close\n01-Jan-2025,10,11\n02-Jan-2025,11,12\n02-Jan-2025,11,13\n';
  const { rows, notes } = parseCsvDetailed(text);
  assert.deepEqual(rows.map((r) => r.close), [11, 13]);
  assert.ok(notes.some((n) => /duplicate/.test(n)));
});

test('date formats normalise to ISO, day first for numeric dates', () => {
  assert.equal(toIsoDate('27-10-2025'), '2025-10-27');
  assert.equal(toIsoDate('27/10/2025'), '2025-10-27');
  assert.equal(toIsoDate('27-OCT-2025'), '2025-10-27');
  assert.equal(toIsoDate('2025-10-27 00:00:00'), '2025-10-27');
  assert.equal(toIsoDate('31-02-2025'), null);
});

test('a reversed file gives the same backtest as the same file in order', () => {
  const asc = nifty.slice(-400);
  const csv = (rows) => 'Date,Close\n' + rows.map((r) => r.date + ',' + r.close).join('\n');
  const a = backtest(parseCsv(csv(asc)), { mode: 'daily' });
  const b = backtest(parseCsv(csv([...asc].reverse())), { mode: 'daily' });
  close(a.outOfSample.strategy.cagr, b.outOfSample.strategy.cagr, 1e-12);
});

test('cash earning the risk-free rate raises the daily strategy return when rf > 0', () => {
  const base = backtest(nifty, { mode: 'daily', rf: 0.065, cashRf: false }).outOfSample.strategy.cagr;
  const withCash = backtest(nifty, { mode: 'daily', rf: 0.065, cashRf: true }).outOfSample.strategy.cagr;
  assert.ok(withCash > base);
});

test('rupee portfolio values and total cost match the reference (daily and monthly)', () => {
  for (const mode of ['daily', 'monthly']) {
    const bt = backtest(nifty, { ...opts, mode, initial: ref.initial });
    const want = ref[mode];
    const last = bt.series.at(-1);
    close(last.stratValue / want.final_strategy_value, 1, 1e-9);
    close(last.bhValue / want.final_buyhold_value, 1, 1e-9);
    close(bt.costs.total / want.total_cost, 1, 1e-9);
  }
});

test('custom window, minimum and maximum exposure match the reference', () => {
  const bt = backtest(nifty, { ...opts, mode: 'daily', window: 40, minExposure: 0.2, maxExposure: 0.9 });
  const want = ref.daily_alt;
  close(bt.c, want.c, want.c * 1e-9);
  same(bt.outOfSample.strategy, want.oos_st, METRICS, 'alt oos_st');
  same(bt.regression.full, want.reg_full, REG, 'alt reg_full');
  const w = bt.series.map((d) => d.weight);
  close(Math.min(...w), want.min_weight, 1e-12);
  close(Math.max(...w), want.max_weight, 1e-12);
  close(w.reduce((a, b) => a + b, 0) / w.length, want.mean_weight, 1e-12);
  close(bt.series[0].vol, want.first_vol, 1e-12);
  assert.ok(w.every((x) => x >= 0.2 - 1e-12 && x <= 0.9 + 1e-12));
});

test('a zero cost run pays zero cost and a higher cost pays more', () => {
  const none = backtest(nifty, { ...opts, mode: 'daily', cost: 0 }).costs.total;
  const some = backtest(nifty, { ...opts, mode: 'daily', cost: 0.002 }).costs.total;
  assert.equal(none, 0);
  assert.ok(some > backtest(nifty, { ...opts, mode: 'daily', cost: 0.001 }).costs.total);
});

test('portfolio value follows the initial investment linearly', () => {
  const a = backtest(nifty, { ...opts, mode: 'daily', initial: 100000 }).series.at(-1).stratValue;
  const b = backtest(nifty, { ...opts, mode: 'daily', initial: 250000 }).series.at(-1).stratValue;
  close(b / a, 2.5, 1e-9);
});

import { existsSync } from 'node:fs';
const frenchPath = new URL('../local-data/french_mkt.json', import.meta.url);
test('engine reproduces the paper market result on the paper data (alpha, beta, appraisal)', { skip: !existsSync(frenchPath) }, async () => {
  const { volManage, paperTest } = await import('../public/js/backtest.js');
  const months = JSON.parse(readFileSync(frenchPath, 'utf8')).months.filter((m) => m.ym <= '201512');
  const excess = months.map((m) => m.excess);
  const out = volManage(excess, months.map((m) => m.rv), { normalize: 'full', cost: 0 });
  const t = paperTest(out.managed.slice(1), excess.slice(1), 12);
  close(t.alphaAnnual, 0.0486, 0.002);
  close(t.beta, 0.6, 0.02);
  close(t.appraisalAnnual, 0.34, 0.02);
});

import { compareSipVsVol } from '../public/js/backtest.js';
const bundled = (name) => parseCsv(readFileSync(new URL(`../public/data/${name}.csv`, import.meta.url), 'utf8'));
const nifty5y = bundled('nifty');
const bank = bundled('banknifty');
const SUMMARY = ['final', 'profit', 'returnPct', 'maxDrawdown', 'longestUnderwaterDays', 'worstDay', 'bestDay', 'costTotal', 'avgExposure', 'annVol', 'sharpe'];

const CONFIGS = [
  ['nifty', nifty5y, 60, 'monthly', null],
  ['nifty', nifty5y, 60, 'daily', null],
  ['nifty', nifty5y, 24, 'monthly', null],
  ['nifty', nifty5y, 0, 'monthly', '2019-01-02'],
  ['nifty', nifty5y, 0, 'daily', '2019-01-02'],
  ['banknifty', bank, 0, 'monthly', '2019-01-02'],
];
for (const [name, rows, months, rebalance, startDate] of CONFIGS) {
  test(`SIP versus volatility plan matches the pandas reference (${name}, ${months || 'max'} months, ${rebalance} reset)`, () => {
    const want = JSON.parse(readFileSync(new URL(`./reference_compare_${name}_${months}_${rebalance}.json`, import.meta.url), 'utf8'));
    const got = compareSipVsVol(rows, { months: months || 120, rebalance, startDate });
    assert.equal(got.period.from, want.from_);
    assert.equal(got.period.to, want.to);
    assert.equal(got.period.days, want.days);
    close(got.period.niftyChange, want.niftyChange, 1e-12);
    for (const who of ['sip', 'vol']) {
      for (const k of SUMMARY) close(got[who][k], want[who][k], Math.max(1e-9, Math.abs(want[who][k]) * 1e-9));
      assert.equal(got[who].troughDate, want[who].troughDate, who + ' trough');
    }
    close(got.sip.invested, want.sip.invested, 1e-6);
    assert.equal(got.sip.purchases, want.sip.purchases);
    close(got.sip.moneyWeightedReturn, want.sip.moneyWeightedReturn, 1e-9);
    for (const k of ['alphaAnnual', 'beta', 'appraisalAnnual', 'sharpeOriginal']) close(got.regression[k], want.regression[k], Math.max(1e-9, Math.abs(want.regression[k]) * 1e-9));
    const w = got.series.map((d) => d.volWeight);
    close(w[0], want.first_weight, 1e-12);
    close(Math.min(...w), want.min_weight, 1e-12);
    close(Math.max(...w), want.max_weight, 1e-12);
    close(w.reduce((x, y) => x + y, 0) / w.length, want.mean_weight, 1e-12);
    close(got.series.at(-1).sipValue, want.last_sip_value, 1e-6);
    close(got.series.at(-1).volValue, want.last_vol_value, 1e-6);
  });
}

test('SIP makes one purchase a month of exactly the monthly amount and the pool never goes negative', () => {
  const got = compareSipVsVol(nifty5y, { months: 60, sip: 10000 });
  assert.equal(got.sip.purchases, 60);
  close(got.sip.invested, 600000, 1e-6);
  assert.ok(got.series.every((d) => d.sipValue > 0 && d.volValue > 0));
});

test('monthly reset changes the weight at most once per calendar month', () => {
  const got = compareSipVsVol(nifty5y, { months: 60, rebalance: 'monthly' });
  const changes = new Map();
  for (let i = 1; i < got.series.length; i++) {
    if (got.series[i].volWeight !== got.series[i - 1].volWeight) {
      const key = got.series[i].date.slice(0, 7);
      changes.set(key, (changes.get(key) ?? 0) + 1);
    }
  }
  assert.ok([...changes.values()].every((n) => n === 1));
});

test('the volatility plan holds less when the 20-day volatility is high', () => {
  const got = compareSipVsVol(nifty5y, { months: 60, rebalance: 'daily' });
  const hi = got.series.filter((d) => d.vol > 0.25).map((d) => d.volWeight);
  const lo = got.series.filter((d) => d.vol < 0.1).map((d) => d.volWeight);
  assert.ok(hi.length > 5 && lo.length > 5);
  assert.ok(hi.reduce((a, b) => a + b, 0) / hi.length < lo.reduce((a, b) => a + b, 0) / lo.length);
});

import { paperStudy } from '../public/js/backtest.js';
const relClose = (got, want, rel = 1e-9) => close(got, want, Math.max(1e-10, Math.abs(want) * rel));

for (const [name, rows] of [['nifty', nifty5y], ['banknifty', bank]]) {
  test(`paper statistics match the pandas and statsmodels reference (${name}, 2019 to 2026)`, () => {
    const want = JSON.parse(readFileSync(new URL(`./reference_study_${name}.json`, import.meta.url), 'utf8'));
    const got = paperStudy(rows.filter((d) => d.date >= '2018-12-01'), { rf: want.rf });
    assert.equal(got.n, want.n);
    assert.equal(got.from, want.from_);
    assert.equal(got.to, want.to);
    for (const grp of ['rv', 'logRv']) for (const k of ['n', 'corr', 'slope', 'tSlope', 'r2']) relClose(got.persistence[grp][k], want.persistence[grp][k]);
    for (const k of ['n', 'corr', 'slope', 'tSlope', 'r2']) relClose(got.predictability[k], want.predictability[k]);
    for (const k of ['n', 'dropped', 'trimmedShare']) assert.equal(got.predictabilityTrimmed[k], want.predictabilityTrimmed[k]);
    for (const k of ['corr', 'slope', 'tSlope', 'r2']) relClose(got.predictabilityTrimmed[k], want.predictabilityTrimmed[k]);
    got.quintiles.forEach((q, i) => {
      for (const k of ['group', 'n', 'avgLagRv', 'avgRv', 'avgExcess', 'meanVarianceRatio']) relClose(q[k], want.quintiles[i][k]);
    });
    for (const k of ['alphaAnnual', 'beta', 'tAlpha', 'r2', 'appraisalAnnual', 'sharpeOriginal', 'sharpeCombined', 'utilityGain', 'c', 'sdOriginal', 'sdManaged', 'sharpeManaged', 'sharpeIncrease', 'maxWeight', 'meanWeight']) {
      relClose(got.paper[k], want.paper[k]);
    }
    got.costs.forEach((c, i) => {
      assert.equal(c.cap, want.costs[i].cap);
      relClose(c.alphaAnnual, want.costs[i].alphaAnnual);
      relClose(c.appraisalAnnual, want.costs[i].appraisalAnnual);
    });
  });
}

test('the managed series has the original volatility by construction (paper normalisation)', () => {
  const s = paperStudy(nifty5y.filter((d) => d.date >= '2018-12-01'));
  relClose(s.paper.sdManaged, s.paper.sdOriginal, 1e-9);
});

test('quintile groups partition the months exactly and are ordered by lagged variance', () => {
  const s = paperStudy(nifty5y.filter((d) => d.date >= '2018-12-01'));
  assert.equal(s.quintiles.reduce((a, q) => a + q.n, 0), s.n);
  for (let i = 1; i < s.quintiles.length; i++) assert.ok(s.quintiles[i].avgLagRv > s.quintiles[i - 1].avgLagRv);
});

import { isoDateOrNull } from '../public/js/backtest.js';
test('isoDateOrNull accepts real ISO dates only', () => {
  assert.equal(isoDateOrNull('2019-01-01'), '2019-01-01');
  assert.equal(isoDateOrNull('2019-02-30'), null);
  assert.equal(isoDateOrNull('01-01-2019'), null);
  assert.equal(isoDateOrNull(undefined), null);
  assert.equal(isoDateOrNull(20190101), null);
});

test('the API routes honour the start and from dates (through a real handler call)', async () => {
  const csv = readFileSync(new URL('../public/data/nifty.csv', import.meta.url), 'utf8');
  const call = async (path, body) => {
    const handler = (await import(path)).default;
    let out;
    await handler({ method: 'POST', body }, { status: () => ({ json: (v) => (out = v) }) });
    return out;
  };
  const cmp = await call('../api/compare.js', { csv, start: '2019-01-02' });
  assert.ok(cmp.period.from >= '2019-01-01' && cmp.period.from <= '2019-01-05', cmp.period.from);
  const st = await call('../api/study.js', { csv, from: '2018-12-01' });
  assert.equal(st.study.n, 94);
});
