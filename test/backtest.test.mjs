import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseCsv, dailyReturns, rollingVariance, summarize, backtest, describe, ljungBox, WINDOW } from '../public/js/backtest.js';
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

test('daily mode matches the independent pandas reference (Nifty 50)', () => {
  const bt = backtest(nifty, { mode: 'daily', cost: 0.001, rf: 0 });
  close(bt.c, 0.00020485598099273465, 1e-12);
  close(bt.outOfSample.strategy.cumulative, 0.4411495261900438, 1e-9);
  close(bt.outOfSample.strategy.cagr, 0.06794094295750197, 1e-9);
  close(bt.outOfSample.strategy.sharpe, 0.5520308298080705, 1e-9);
  close(bt.outOfSample.buyHold.maxDrawdown, -0.17229752584963576, 1e-9);
  close(bt.insample.strategy.maxDrawdown, -0.41459987948769816, 1e-9);
});

test('monthly paper mode matches the independent pandas reference (Nifty 50)', () => {
  const bt = backtest(nifty, { mode: 'monthly', cost: 0.001, rf: 0 });
  close(bt.c, 0.0017218713273474211, 1e-12);
  close(bt.outOfSample.strategy.cagr, 0.13480160777372951, 1e-9);
  close(bt.outOfSample.buyHold.cagr, 0.09311743706093556, 1e-9);
  close(bt.outOfSample.strategy.annVol, 0.2496911515707396, 1e-9);
  close(bt.outOfSample.strategy.maxDrawdown, -0.3657823792715307, 1e-9);
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

test('return statistics match the pandas and scipy reference (Nifty 50)', () => {
  const r = dailyReturns(nifty.map((d) => d.close)).slice(1);
  const d = describe(r);
  close(d.mean, 0.00042942943109954804, 1e-12);
  close(d.sd, 0.012911073563241927, 1e-12);
  close(d.skewness, 0.05940399903960896, 1e-9);
  close(d.excessKurtosis, 16.018516632065694, 1e-7);
  close(d.jarqueBera, 50113.20683981643, 1e-3);
  const lb = ljungBox(r.map((x) => x * x), 10);
  close(lb.q, 1356.7242885610754, 1e-6);
  close(lb.pValue / 2.184056128428781e-285, 1, 1e-6);
});
