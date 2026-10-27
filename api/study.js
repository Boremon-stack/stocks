import { parseCsvDetailed, paperStudy, dailyReturns, describe, ljungBox, isoDateOrNull } from '../public/js/backtest.js';

const MAX_BYTES = 5 * 1024 * 1024;

function num(value, fallback, min, max) {
  if (value === '' || value === null || value === undefined) return fallback;
  const x = Number(value);
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : fallback;
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
  let notes;
  try {
    ({ rows, notes } = parseCsvDetailed(csv));
  } catch (e) {
    res.status(400).json({ error: e.message });
    return;
  }
  const from = isoDateOrNull(body.from) ?? '';
  if (from) rows = rows.filter((d) => d.date >= from);
  if (rows.length < 200) {
    res.status(400).json({ error: 'need at least 200 daily rows (about 10 months) for the statistics' });
    return;
  }
  const rf = num(body.rf, 0.065, 0, 0.5);
  const study = paperStudy(rows, { rf });
  const r = dailyReturns(rows.map((d) => d.close)).slice(1);
  res.status(200).json({
    notes,
    rows: rows.length,
    from: rows[0].date,
    to: rows[rows.length - 1].date,
    daily: { returns: describe(r), ljungBoxSq: ljungBox(r.map((x) => x * x), 10) },
    study,
  });
}
