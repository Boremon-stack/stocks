import { parseCsv, backtest } from './backtest.js';
import { createCompute } from './compute.js';

const $ = (id) => document.getElementById(id);
const pct = (x) => `${(x * 100).toFixed(2)}%`;
const num = (x) => x.toFixed(2);
const cache = new Map();

async function load(file) {
  if (!cache.has(file)) {
    const text = await fetch(`data/${file}`).then((r) => {
      if (!r.ok) throw new Error(`could not load ${file}`);
      return r.text();
    });
    cache.set(file, parseCsv(text));
  }
  return cache.get(file);
}

function table(bt) {
  const rows = [
    ['Cumulative', (s) => pct(s.cumulative)],
    ['CAGR', (s) => pct(s.cagr)],
    ['Volatility, annual', (s) => pct(s.annVol)],
    ['Sharpe', (s) => num(s.sharpe)],
    ['Max drawdown', (s) => pct(s.maxDrawdown)],
  ];
  const head = `<tr><th></th><th>Train B&amp;H</th><th>Train managed</th><th>Test B&amp;H</th><th>Test managed</th></tr>`;
  const body = rows
    .map(([label, f]) => {
      const i = bt.insample, o = bt.outOfSample;
      return `<tr><td>${label}</td><td>${f(i.buyHold)}</td><td class="hi">${f(i.strategy)}</td><td>${f(o.buyHold)}</td><td class="hi">${f(o.strategy)}</td></tr>`;
    })
    .join('');
  return head + body;
}

function chart(bt) {
  const days = bt.days.filter((d) => d.t > bt.split);
  let bh = 1, st = 1;
  const pts = days.map((d) => {
    bh *= 1 + d.bh;
    st *= 1 + d.strat;
    return { bh, st };
  });
  const all = pts.flatMap((p) => [p.bh, p.st]);
  const lo = Math.min(...all, 1) * 0.98;
  const hi = Math.max(...all, 1) * 1.02;
  const W = 640, H = 260, pad = 36;
  const x = (i) => pad + (i / Math.max(1, pts.length - 1)) * (W - pad * 2);
  const y = (v) => H - pad - ((v - lo) / (hi - lo)) * (H - pad * 2);
  const path = (key) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const baseY = y(1).toFixed(1);
  $('chart').innerHTML = `
    <line x1="${pad}" x2="${W - pad}" y1="${baseY}" y2="${baseY}" stroke="var(--rule)" stroke-dasharray="3 4"/>
    <path d="${path('bh')}" fill="none" stroke="var(--bh)" stroke-width="2"/>
    <path d="${path('st')}" fill="none" stroke="var(--strat)" stroke-width="2.4"/>
    <text x="${pad}" y="${H - 8}" fill="var(--muted)" font-size="12">test start</text>
    <text x="${W - pad}" y="${H - 8}" fill="var(--muted)" font-size="12" text-anchor="end">test end</text>
    <text x="${W - pad}" y="${y(pts.at(-1).st) - 8}" fill="var(--strat)" font-size="12" text-anchor="end">${num(pts.at(-1).st)}</text>
    <text x="${W - pad}" y="${y(pts.at(-1).bh) + 16}" fill="var(--muted)" font-size="12" text-anchor="end">${num(pts.at(-1).bh)}</text>`;
}

async function run() {
  const file = $('market').value;
  const name = $('market').selectedOptions[0].text;
  const closes = (await load(file)).map((d) => d.close);
  const bt = backtest(closes, {
    cost: Number($('cost').value) || 0,
    rf: (Number($('rf').value) || 0) / 100,
    maxExposure: Math.min(1, Math.max(0, Number($('cap').value) || 0)),
  });
  $('result-title').textContent = `${name}: test period (${bt.testDays} days)`;
  $('stats').innerHTML = table(bt);
  chart(bt);
}

$('backend').textContent = createCompute({ prefer: 'gpu' }).backend === 'gpu' ? 'GPU (WebGL2)' : 'CPU';
['market', 'cost', 'rf', 'cap'].forEach((id) => $(id).addEventListener('change', () => run().catch(showError)));
run().catch(showError);

function showError(e) {
  $('stats').textContent = e.message;
}
