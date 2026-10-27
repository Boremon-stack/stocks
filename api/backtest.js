import { parseCsvDetailed, backtest, dailyReturns, describe, acf, ljungBox, drawdownSeries } from '../public/js/backtest.js';

const MAX_BYTES = 5 * 1024 * 1024;
const MODES = new Set(['daily', 'monthly']);

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
  const from = typeof body.from === 'string' ? body.from : '';
  const to = typeof body.to === 'string' ? body.to : '';
  if (from || to) rows = rows.filter((d) => (!from || d.date >= from) && (!to || d.date <= to));

  const mode = MODES.has(body.mode) ? body.mode : 'daily';
  const window = Math.round(num(body.window, 20, 5, 250));
  const needed = Math.max(60, window * 3);
  if (rows.length < needed) {
    res.status(400).json({ error: `need at least ${needed} daily rows for a ${window}-day window` });
    return;
  }

  const maxExposure = mode === 'daily' ? num(body.maxExposure, 1, 0, 1) : num(body.maxExposure, Infinity, 0, 10);
  const minExposure = num(body.minExposure, 0, 0, maxExposure);
  const result = backtest(rows, {
    mode,
    window,
    cost: num(body.cost, 0.001, 0, 0.05),
    rf: num(body.rf, 0, 0, 0.5),
    minExposure,
    maxExposure,
    initial: num(body.initial, 100000, 1, 1e12),
    trainShare: num(body.trainShare, 0.7, 0.3, 0.9),
    cashRf: body.cashRf === true,
    normalize: body.normalize === 'full' ? 'full' : 'train',
  });

  const r = dailyReturns(rows.map((d) => d.close)).slice(1);
  const sq = r.map((x) => x * x);
  const abs = r.map((x) => Math.abs(x));
  const dd = drawdownSeries(r);

  res.status(200).json({
    instrument: typeof body.instrument === 'string' ? body.instrument.slice(0, 80) : '',
    notes,
    regression: result.regression,
    stats: {
      returns: describe(r),
      acfAbs: acf(abs, 10),
      acfSq: acf(sq, 10),
      ljungBoxSq: ljungBox(sq, 10),
      drawdown: dd.filter((_, i) => i % Math.max(1, Math.floor(dd.length / 400)) === 0),
    },
    mode: result.mode,
    window: result.window ?? null,
    rows: rows.length,
    from: rows[0].date,
    to: rows[rows.length - 1].date,
    initial: result.initial,
    minExposure,
    maxExposure: Number.isFinite(maxExposure) ? maxExposure : null,
    c: result.c,
    split: result.split,
    splitDate: result.series[result.split]?.date ?? null,
    costs: result.costs,
    insample: result.insample,
    outOfSample: result.outOfSample,
    series: result.series.map((d) => ({
      date: d.date,
      vol: round(d.vol, 6),
      weight: round(d.weight, 6),
      bh: round(d.bh, 8),
      strat: round(d.strat, 8),
      bhValue: round(d.bhValue, 2),
      stratValue: round(d.stratValue, 2),
      cost: round(d.cost, 4),
    })),
  });
}
