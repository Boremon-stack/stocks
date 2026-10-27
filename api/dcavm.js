import { parseCsvDetailed, dcaVsVm, dailyReturns, describe, ljungBox, isoDateOrNull } from '../public/js/backtest.js';

const MAX_BYTES = 5 * 1024 * 1024;

const isAbsent = (v) => v === undefined || v === null || v === '';

const round = (x, d) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);

const fullRow = (d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, k === 'date' || Number.isFinite(v) ? v : null]));

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

  const start = isoDateOrNull(body.start);
  const end = isoDateOrNull(body.end);
  let data = rows;
  if (start) data = data.filter((d) => d.date >= start);
  if (end) data = data.filter((d) => d.date <= end);
  if (data.length < 60) {
    res.status(400).json({ error: `need at least 60 daily rows, found ${data.length}` });
    return;
  }
  if (data.length !== rows.length) {
    notes.push(`The run uses ${data.length} rows from ${data[0].date} to ${data[data.length - 1].date} after the start/end filter.`);
  }

  const monthly = isAbsent(body.monthly) ? 10000 : Number(body.monthly);
  const maxExposure = isAbsent(body.maxExposure) ? 1 : Number(body.maxExposure);
  const costBps = isAbsent(body.costBps) ? 0 : Number(body.costBps);
  if (!(Number.isFinite(monthly) && monthly > 0)) {
    res.status(400).json({ error: 'monthly must be positive' });
    return;
  }
  if (!(maxExposure > 0 && maxExposure <= 1)) {
    res.status(400).json({ error: 'max exposure must be in (0, 1]' });
    return;
  }
  if (!(costBps >= 0 && costBps <= 100)) {
    res.status(400).json({ error: 'cost must be between 0 and 100 basis points' });
    return;
  }

  let result;
  try {
    result = dcaVsVm(data, { monthly, maxExposure, costBps });
  } catch (e) {
    res.status(400).json({ error: e.message });
    return;
  }

  const r = dailyReturns(data.map((d) => d.close)).slice(1);
  const payload = {
    notes,
    params: result.params,
    period: result.period,
    dca: result.metrics.dca,
    vm: result.metrics.vm,
    control: result.control,
    timingEffect: result.timingEffect,
    stats: { returns: describe(r), ljungBoxSq: ljungBox(r.map((x) => x * x), 10) },
    series: result.series.map((d) => ({
      date: d.date,
      price: round(d.price, 2),
      priorMonthVol: round(d.priorMonthVol, 6),
      vmTarget: round(d.vmTarget, 6),
      dcaEquity: round(d.dcaEquity, 2),
      vmEquity: round(d.vmEquity, 2),
      ctlEquity: round(d.ctlEquity, 2),
      dcaShare: round(d.dcaShare, 6),
      vmShare: round(d.vmShare, 6),
      ctlShare: round(d.ctlShare, 6),
      dcaDd: round(d.dcaDd, 6),
      vmDd: round(d.vmDd, 6),
      ctlDd: round(d.ctlDd, 6),
      contribution: round(d.contribution, 2),
      dcaBuy: round(d.dcaBuy, 2),
      vmTrade: round(d.vmTrade, 2),
    })),
  };
  if (body.includeDaily === true) payload.daily = result.daily.map(fullRow);
  res.status(200).json(payload);
}
