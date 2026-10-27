// Synthetic CSVs for exercising the upload path. Not market data; never shown as results.
import { writeFileSync } from 'node:fs';
let s = 12345;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const M = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const days = [];
for (let t = Date.UTC(2020, 0, 1); t <= Date.UTC(2025, 11, 31); t += 864e5) {
  const d = new Date(t);
  if (d.getUTCDay() % 6) days.push(d);
}
const N = days.length;
const fmt = (d) => `${String(d.getUTCDate()).padStart(2, '0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
const build = (name, ret) => {
  let p = 10000;
  const rows = ['Date,Open,High,Low,Close,Shares Traded,Turnover (₹ Cr)'];
  days.forEach((d, i) => {
    const o = p;
    p *= 1 + ret(i / N, i);
    const f = (v) => v.toFixed(2);
    rows.push(`"${fmt(d)}",${f(o)},${f(Math.max(o, p) * 1.002)},${f(Math.min(o, p) * 0.998)},${f(p)},0,0`);
  });
  writeFileSync(`test/lab/${name}`, rows.join('\n') + '\n');
  console.log(name, N, p.toFixed(0));
};
// Looks good for volatility management: calm climb, one violent crash, long calm recovery.
build('LAB_looks_good_synthetic.csv', (u) => (u > 0.30 && u < 0.38 ? -0.004 + 0.02 * gauss() : 0.0006 + 0.004 * gauss()));
// Looks bad for it: slow calm decline, then a violent fast rebound and a choppy high-volatility rise.
build('LAB_looks_bad_synthetic.csv', (u) => (u < 0.45 ? -0.0005 + 0.003 * gauss() : u < 0.6 ? 0.004 + 0.022 * gauss() : 0.0008 + 0.015 * gauss()));
// Biased: a near-deterministic rise, tiny noise, no crash; unrealistic by construction.
build('LAB_biased_synthetic.csv', () => 0.0009 + 0.0003 * gauss());
