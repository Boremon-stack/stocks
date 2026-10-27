import { parseCsvDetailed, compareSipVsVol, dailyReturns, describe, ljungBox, isoDateOrNull } from '../public/js/backtest.js';

const MAX_BYTES = 5 * 1024 * 1024;

function num(value, fallback, min, max) {
  if (value === '' || value === null || value === undefined) return fallback;
  const x = Number(value);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(max, Math.max(min, x));
}

const round = (x, d) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST a CSV with date and close columns' });
    return;
  }
  const body = req.body ?? {};
  const csv = typeof body.csv === 'string' ? body.csv : '';
  if (!csv) {
    res.status(400).json({ error: 'missing csv' });
    return;
  }
  if (Buffer.byteLength(csv) > MAX_BYTES) {
    res.status(413).json({ error: 'file over 5 MB' });
    return;
  }

  let rows;
  let notes;
  try {
    ({ rows, notes } = parseCsvDetailed(csv));
  } catch (e) {
    res.status(400).json({ error: e.message });
    return;
  }

  const window = Math.round(num(body.window, 20, 5, 250));
  if (rows.length < window * 3 + 60) {
    res.status(400).json({ error: `need at least ${window * 3 + 60} daily rows for a ${window}-day window` });
    return;
  }

  const pool = num(body.pool, 1000000, 10000, 1e10);
  const maxExposure = num(body.maxExposure, 1, 0, 1);
  const result = compareSipVsVol(rows, {
    pool,
    sip: num(body.sip, 10000, 0, pool),
    window,
    minExposure: num(body.minExposure, 0, 0, maxExposure),
    maxExposure,
    cost: num(body.cost, 0.001, 0, 0.05),
    cashRate: num(body.cashRate, 0, 0, 0.5),
    months: Math.round(num(body.months, 120, 6, 240)),
    startDate: isoDateOrNull(body.start),
    rebalance: body.rebalance === 'daily' ? 'daily' : 'monthly',
    scaling: body.scaling === 'volatility' ? 'volatility' : 'variance',
    calibration: body.calibration === 'average' ? 'average' : 'paper',
  });

  if (rows[0].date > result.period.requested) {
    notes.push(`The data starts at ${rows[0].date}, so the test covers ${result.period.days} trading days from ${result.period.from}, not the full period asked for.`);
  } else if (result.period.moved) {
    notes.push(`The test starts at ${result.period.from} because the first ${window} days are needed to measure volatility.`);
  }
  if (result.params.cashRate > 0) notes.push(`Idle cash earns ${Number((result.params.cashRate * 100).toFixed(4))}% a year.`);
  if (result.params.calibration === 'paper') {
    notes.push('The constant c is set using the whole period (as the paper does), so the plan is a back-test of the rule, not something that could have been run live.');
  }

  const from = result.series[0].date;
  const idx = rows.findIndex((d) => d.date === from);
  const closes = rows.slice(idx).map((d) => d.close);
  const r = dailyReturns(closes).slice(1);

  res.status(200).json({
    notes,
    c: result.c,
    params: result.params,
    period: result.period,
    sip: result.sip,
    vol: result.vol,
    control: result.control,
    timingEffect: result.timingEffect,
    regression: result.regression,
    stats: { returns: describe(r), ljungBoxSq: ljungBox(r.map((x) => x * x), 10) },
    series: result.series.map((d) => ({
      date: d.date,
      close: round(d.close, 2),
      vol: round(d.vol, 6),
      volWeight: round(d.volWeight, 6),
      sipExposure: round(d.sipExposure, 6),
      volInIndex: round(d.volInIndex, 2),
      sipInIndex: round(d.sipInIndex, 2),
      sipValue: round(d.sipValue, 2),
      volValue: round(d.volValue, 2),
      sipCost: round(d.sipCost, 2),
      volCost: round(d.volCost, 2),
      volTrade: round(d.volTrade, 2),
      sipBuy: round(d.sipBuy, 2),
      sipDd: round(d.sipDd, 6),
      volDd: round(d.volDd, 6),
      ctlValue: round(d.ctlValue, 2),
      ctlDd: round(d.ctlDd, 6),
      ctlInIndex: round(d.ctlInIndex, 2),
    })),
  });
}
