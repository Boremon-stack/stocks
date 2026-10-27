import { parseCsv, backtest, dailyReturns, describe, acf, ljungBox, drawdownSeries } from '../public/js/backtest.js';

const MAX_BYTES = 5 * 1024 * 1024;
const MODES = new Set(['daily', 'monthly']);

function num(value, fallback, min, max) {
  const x = Number(value);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(max, Math.max(min, x));
}

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
  try {
    rows = parseCsv(csv);
  } catch (e) {
    res.status(400).json({ error: e.message });
    return;
  }
  const from = typeof body.from === 'string' ? body.from : '';
  const to = typeof body.to === 'string' ? body.to : '';
  if (from || to) rows = rows.filter((d) => (!from || d.date >= from) && (!to || d.date <= to));
  if (rows.length < 60) {
    res.status(400).json({ error: 'need at least 60 daily rows' });
    return;
  }

  const mode = MODES.has(body.mode) ? body.mode : 'daily';
  const result = backtest(rows, {
    mode,
    cost: num(body.cost, 0.001, 0, 0.05),
    rf: num(body.rf, 0.065, 0, 0.5),
    maxExposure: mode === 'daily' ? num(body.maxExposure, 1, 0, 1) : num(body.maxExposure, Infinity, 0, 10),
    trainShare: num(body.trainShare, 0.7, 0.3, 0.9),
  });

  const r = dailyReturns(rows.map((d) => d.close)).slice(1);
  const sq = r.map((x) => x * x);
  const abs = r.map((x) => Math.abs(x));
  const dd = drawdownSeries(r);

  res.status(200).json({
    stats: {
      returns: describe(r),
      acfAbs: acf(abs, 10),
      acfSq: acf(sq, 10),
      ljungBoxSq: ljungBox(sq, 10),
      drawdown: dd.filter((_, i) => i % Math.max(1, Math.floor(dd.length / 400)) === 0),
    },
    mode: result.mode,
    rows: rows.length,
    from: rows[0].date,
    to: rows[rows.length - 1].date,
    c: result.c,
    split: result.split,
    splitDate: result.series[result.split]?.date ?? null,
    insample: result.insample,
    outOfSample: result.outOfSample,
    series: result.series,
  });
}
