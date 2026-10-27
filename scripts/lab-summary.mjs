import { readFileSync } from 'node:fs';
import { parseCsvDetailed, dcaVsVm } from '../public/js/backtest.js';
for (const f of ['looks_good', 'looks_bad', 'biased']) {
  const name = f === 'biased' ? 'LAB_biased_synthetic.csv' : `LAB_${f}_synthetic.csv`;
  const { rows } = parseCsvDetailed(readFileSync(`test/lab/${name}`, 'utf8'));
  const r = dcaVsVm(rows, {});
  const m = (p) => `${Math.round(p.endingEquity)} cagr ${(p.twrCagr * 100).toFixed(1)} sharpe ${p.sharpe.toFixed(2)} dd ${(p.maxDrawdown * 100).toFixed(1)}`;
  console.log(name, rows.length, '\n  DCA', m(r.metrics.dca), '\n  VM ', m(r.metrics.vm));
}
