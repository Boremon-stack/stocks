import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSipVsVol } from '../public/js/backtest.js';

const POOL = 1_000_000;
const SIP = 10_000;
const price = (i) => 100 * (1 + 0.01 * Math.sin(i / 3)) * (1 + 0.002 * i);

function weekdaysBetween(fromISO, toISO) {
  const end = new Date(`${toISO}T00:00:00Z`);
  let count = 0;
  for (let d = new Date(`${fromISO}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

function makeRows(startISO, n, closeFn) {
  const rows = [];
  const d = new Date(`${startISO}T00:00:00Z`);
  while (rows.length < n) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      rows.push({ date: d.toISOString().slice(0, 10), close: closeFn(rows.length) });
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return rows;
}

// 6 warm-up weekdays (21 Feb to 28 Feb), then trading from 3 Mar.
const ONE_MONTH = makeRows('2025-02-21', weekdaysBetween('2025-02-21', '2025-03-28'), price);
const THREE_MONTHS = makeRows('2025-02-21', weekdaysBetween('2025-02-21', '2025-05-30'), price);

const BASE = {
  window: 3,
  startDate: '2025-03-03',
  rebalance: 'monthly',
  cost: 0,
  cashRate: 0,
  pool: POOL,
  sip: SIP,
  minExposure: 0,
  maxExposure: 1,
};

const run = (rows, options) => compareSipVsVol(rows, { ...BASE, ...options });

const startIndex = (rows) => rows.findIndex((r) => r.date >= '2025-03-03');

function near(actual, expected, abs = 1e-6, rel = 0) {
  const tol = Math.max(abs, rel * Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual} (tol ${tol})`);
}

function monthEndDates(rows, s0) {
  const out = new Set();
  for (let i = s0; i <= rows.length - 2; i++) {
    if (rows[i + 1].date.slice(0, 7) !== rows[i].date.slice(0, 7)) out.add(rows[i].date);
  }
  return out;
}

test('one month, full exposure: vol final = pool * P[last] / P[s0]', () => {
  const s0 = startIndex(ONE_MONTH);
  const last = ONE_MONTH.length - 1;
  const r = run(ONE_MONTH, { months: 1, minExposure: 1, maxExposure: 1 });
  near(r.vol.final, POOL * (ONE_MONTH[last].close / ONE_MONTH[s0].close), 1e-6, 1e-12);
});

test('one month, half exposure: vol final = pool * (0.5 * P[last] / P[s0] + 0.5)', () => {
  const s0 = startIndex(ONE_MONTH);
  const last = ONE_MONTH.length - 1;
  const r = run(ONE_MONTH, { months: 1, minExposure: 0.5, maxExposure: 0.5 });
  const expected = POOL * (0.5 * (ONE_MONTH[last].close / ONE_MONTH[s0].close) + 0.5);
  near(r.vol.final, expected, 1e-6, 1e-12);
});

test('one month: SIP final = pool + sip * (P[last] / P[s0] - 1), single purchase', () => {
  const s0 = startIndex(ONE_MONTH);
  const last = ONE_MONTH.length - 1;
  const r = run(ONE_MONTH, { months: 1, minExposure: 1, maxExposure: 1 });
  near(r.sip.final, POOL + SIP * (ONE_MONTH[last].close / ONE_MONTH[s0].close - 1), 1e-6, 1e-12);
  assert.equal(r.sip.investments.purchases, 1);
  near(r.sip.investments.totalPutIn, SIP, 1e-6);
});

test('one month, cost 0.001: one buy of pool/1.001 and fee 0.001 * pool/1.001', () => {
  const r = run(ONE_MONTH, { months: 1, minExposure: 1, maxExposure: 1, cost: 0.001 });
  assert.equal(r.vol.investments.trades, 1);
  assert.equal(r.vol.investments.buys, 1);
  assert.equal(r.vol.investments.sells, 0);
  near(r.vol.costTotal, 0.001 * (POOL / 1.001), 1e-6);
  near(r.vol.tradeList[0].amount, POOL / 1.001, 1e-6);
});

test('identity: indexGain + interest - costs = final - pool, both plans, cashRate 0 and 0.065, cost 0.001', () => {
  for (const cashRate of [0, 0.065]) {
    const r = run(THREE_MONTHS, { months: 3, cost: 0.001, cashRate });
    for (const plan of ['sip', 'vol']) {
      const c = r[plan].components;
      const gap = c.indexGain + c.interest - c.costs - (r[plan].final - POOL);
      assert.ok(Math.abs(gap) < 1e-6, `${plan} cashRate=${cashRate} gap=${gap}`);
    }
  }
});

test('three months, monthly SIP: 3 purchases on first trading days, consistent averages', () => {
  const last = THREE_MONTHS.length - 1;
  const r = run(THREE_MONTHS, { months: 3 });
  const inv = r.sip.investments;
  assert.equal(inv.purchases, 3);
  near(inv.totalPutIn, 3 * SIP, 1e-6);
  assert.equal(r.sip.purchaseList.length, 3);
  assert.deepEqual(
    r.sip.purchaseList.map((p) => p.date),
    ['2025-03-03', '2025-04-01', '2025-05-01'],
  );
  near(inv.averageBuyPrice, inv.totalPutIn / inv.units, 1e-9, 1e-12);
  near(inv.finalIndexValue, inv.units * THREE_MONTHS[last].close, 1e-6, 1e-12);
});

test('three months, free exposure: vol trades only on start date or month-end; daily trades more often', () => {
  const s0 = startIndex(THREE_MONTHS);
  const allowed = monthEndDates(THREE_MONTHS, s0);
  allowed.add(THREE_MONTHS[s0].date);
  const monthly = run(THREE_MONTHS, { months: 3, minExposure: 0, maxExposure: 1, rebalance: 'monthly' });
  const daily = run(THREE_MONTHS, { months: 3, minExposure: 0, maxExposure: 1, rebalance: 'daily' });
  for (const t of monthly.vol.tradeList) {
    assert.ok(allowed.has(t.date), `unexpected monthly trade on ${t.date}`);
  }
  assert.ok(
    daily.vol.investments.trades > monthly.vol.investments.trades,
    `daily ${daily.vol.investments.trades} not greater than monthly ${monthly.vol.investments.trades}`,
  );
});

test('drawdown: series minimum, first episode depth and sort order match for both plans', () => {
  const r = run(THREE_MONTHS, { months: 3, cost: 0.001 });
  for (const plan of ['sip', 'vol']) {
    const ddKey = `${plan}Dd`;
    const seriesMin = Math.min(...r.series.map((row) => row[ddKey]));
    near(seriesMin, r[plan].maxDrawdown, 0, 1e-12);

    const eps = r[plan].drawdownEpisodes;
    assert.ok(eps.length > 0, `${plan} has no drawdown episodes`);
    near(eps[0].depth, r[plan].maxDrawdown, 0, 1e-12);
    for (let k = 1; k < eps.length; k++) {
      assert.ok(eps[k - 1].depth <= eps[k].depth, `${plan} episodes not sorted most negative first`);
    }
    for (const ep of eps) {
      assert.ok(ep.tradingDaysUnder >= 1, `${plan} episode with tradingDaysUnder < 1`);
    }
  }
});

test('sharpe with cashRate 0 = meanDaily / sdDaily * sqrt(252)', () => {
  const r = run(THREE_MONTHS, { months: 3, cost: 0.001, cashRate: 0 });
  for (const plan of ['sip', 'vol']) {
    const p = r[plan].sharpeParts;
    near(r[plan].sharpe, (p.meanDaily / p.sdDaily) * Math.sqrt(252), 1e-9);
  }
});

test('sharpe with cashRate 0.065 = (meanDaily - 0.065/252) / sdDaily * sqrt(252)', () => {
  const r = run(THREE_MONTHS, { months: 3, cost: 0.001, cashRate: 0.065 });
  for (const plan of ['sip', 'vol']) {
    const p = r[plan].sharpeParts;
    near(r[plan].sharpe, ((p.meanDaily - 0.065 / 252) / p.sdDaily) * Math.sqrt(252), 1e-9);
  }
});

test('money and shares stay non-negative and shares stay within [0, 1]', () => {
  const r = run(THREE_MONTHS, { months: 3, cost: 0.001, cashRate: 0.065, minExposure: 0, maxExposure: 1 });
  for (const row of r.series) {
    assert.ok(row.volValue > 0, `volValue <= 0 on ${row.date}`);
    assert.ok(row.sipValue > 0, `sipValue <= 0 on ${row.date}`);
    for (const share of [row.volWeight, row.sipExposure]) {
      assert.ok(share >= 0 && share <= 1 + 1e-12, `share ${share} out of [0,1] on ${row.date}`);
    }
  }
});
