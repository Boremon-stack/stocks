const $ = (id) => document.getElementById(id);
const pct = (x) => `${(x * 100).toFixed(2)}%`;
const num = (x) => x.toFixed(2);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let source = { name: 'Nifty 50', text: null, file: 'nifty50.csv' };
const cache = new Map();

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

async function datasetText(file) {
  if (!cache.has(file)) {
    const r = await fetch(`local-data/${file}`);
    if (!r.ok) throw new Error(`could not load ${file}`);
    cache.set(file, await r.text());
  }
  return cache.get(file);
}

function setStatus(msg, isErr = false) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('err', isErr);
}

function syncCapVisibility() {
  $('capWrap').style.display = $('mode').value === 'daily' ? '' : 'none';
  if ($('mode').value === 'monthly') $('cap').value = '';
  else if ($('cap').value === '') $('cap').value = '1';
}

function buildPayload(csv) {
  const payload = {
    csv,
    from: $('from').value,
    to: $('to').value,
    mode: $('mode').value,
    cost: (Number($('cost').value) || 0) / 100,
    rf: (Number($('rf').value) || 0) / 100,
  };
  const cap = $('cap').value;
  if (payload.mode === 'daily') payload.maxExposure = cap === '' ? 1 : Number(cap);
  else if (cap !== '') payload.maxExposure = Number(cap);
  return payload;
}

function metricsTable(r) {
  const row = (label, f) => {
    const i = r.insample, o = r.outOfSample;
    return `<tr><td>${label}</td><td>${f(i.buyHold)}</td><td class="hi">${f(i.strategy)}</td><td>${f(o.buyHold)}</td><td class="hi">${f(o.strategy)}</td></tr>`;
  };
  return `<table class="metrics">
    <tr><th></th><th>Train, buy &amp; hold</th><th>Train, managed</th><th>Test, buy &amp; hold</th><th>Test, managed</th></tr>
    ${row('CAGR', (s) => pct(s.cagr))}
    ${row('Cumulative', (s) => pct(s.cumulative))}
    ${row('Volatility, annual', (s) => pct(s.annVol))}
    ${row('Sharpe', (s) => num(s.sharpe))}
    ${row('Max drawdown', (s) => pct(s.maxDrawdown))}
  </table>`;
}

function growthChart(r) {
  const test = r.series.slice(r.split);
  let bh = 1, st = 1;
  const pts = test.map((d) => {
    bh *= 1 + d.bh;
    st *= 1 + d.strat;
    return { bh, st, date: d.date };
  });
  const all = pts.flatMap((p) => [p.bh, p.st, 1]);
  const lo = Math.min(...all) * 0.97, hi = Math.max(...all) * 1.03;
  const W = 900, H = 300, pl = 52, pr = 16, pt = 16, pb = 36;
  const x = (i) => pl + (i / Math.max(1, pts.length - 1)) * (W - pl - pr);
  const y = (v) => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
  const path = (k) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ');
  const base = y(1).toFixed(1);
  const last = pts.at(-1);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Growth of one unit over the test period">
    <line x1="${pl}" x2="${W - pr}" y1="${base}" y2="${base}" stroke="var(--rule)" stroke-dasharray="3 4"/>
    <path d="${path('bh')}" fill="none" stroke="var(--ink-2)" stroke-width="1.6"/>
    <path d="${path('st')}" fill="none" stroke="var(--accent)" stroke-width="2.2"/>
    <text x="${pl}" y="${H - 10}" fill="var(--muted)" font-size="12" font-family="var(--sans)">${esc(pts[0].date)}</text>
    <text x="${W - pr}" y="${H - 10}" fill="var(--muted)" font-size="12" font-family="var(--sans)" text-anchor="end">${esc(last.date)}</text>
    <text x="${W - pr - 4}" y="${y(last.st) - 8}" fill="var(--accent)" font-size="12" font-family="var(--sans)" text-anchor="end">${num(last.st)}</text>
    <text x="${W - pr - 4}" y="${y(last.bh) + 16}" fill="var(--ink-2)" font-size="12" font-family="var(--sans)" text-anchor="end">${num(last.bh)}</text>
  </svg>`;
}

function exposureChart(r) {
  const test = r.series.slice(r.split);
  const W = 900, H = 160, pl = 52, pr = 16, pt = 10, pb = 26;
  const maxW = Math.max(1, ...test.map((d) => d.weight));
  const bw = (W - pl - pr) / test.length;
  const bars = test
    .map((d, i) => {
      const h = (Math.min(d.weight, maxW) / maxW) * (H - pt - pb);
      return `<rect x="${(pl + i * bw).toFixed(2)}" y="${(H - pb - h).toFixed(2)}" width="${Math.max(0.6, bw - 0.4).toFixed(2)}" height="${h.toFixed(2)}" fill="var(--accent-soft)"/>`;
    })
    .join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Exposure held in the test period">
    <line x1="${pl}" x2="${W - pr}" y1="${H - pb}" y2="${H - pb}" stroke="var(--rule)"/>
    ${bars}
    <text x="${pl}" y="${H - 6}" fill="var(--muted)" font-size="12" font-family="var(--sans)">exposure, max ${num(maxW)}×</text>
  </svg>`;
}

function statsPanel(s) {
  const R = s.returns;
  const bars = (vals, title) => {
    const W = 900, H = 150, pl = 40, pb = 22, pt = 8;
    const bw = (W - pl - 10) / vals.length;
    const band = 1.96 / Math.sqrt(R.n);
    const maxV = Math.max(band * 1.2, ...vals.map(Math.abs));
    const y0 = pt + (H - pt - pb) / 2;
    const scale = (H - pt - pb) / 2 / maxV;
    const rects = vals
      .map((v, i) => {
        const h = Math.abs(v) * scale;
        const y = v >= 0 ? y0 - h : y0;
        return `<rect x="${(pl + i * bw + 3).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw - 6).toFixed(1)}" height="${h.toFixed(1)}" fill="var(--accent)"/>`;
      })
      .join("");
    return `<h3>${title}</h3><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}">
      <line x1="${pl}" x2="${W - 10}" y1="${y0}" y2="${y0}" stroke="var(--rule)"/>
      <line x1="${pl}" x2="${W - 10}" y1="${(y0 - band * scale).toFixed(1)}" y2="${(y0 - band * scale).toFixed(1)}" stroke="var(--muted)" stroke-dasharray="3 4"/>
      <line x1="${pl}" x2="${W - 10}" y1="${(y0 + band * scale).toFixed(1)}" y2="${(y0 + band * scale).toFixed(1)}" stroke="var(--muted)" stroke-dasharray="3 4"/>
      ${rects}
      <text x="${pl}" y="${H - 6}" fill="var(--muted)" font-size="12" font-family="var(--sans)">lag 1 to ${vals.length}; dashed = 95% band</text>
    </svg>`;
  };
  const dd = s.drawdown;
  const ddW = 900, ddH = 130, ddPl = 40;
  const lo = Math.min(...dd, -0.01);
  const ddPath = dd.map((v, i) => `${i ? "L" : "M"}${(ddPl + (i / Math.max(1, dd.length - 1)) * (ddW - ddPl - 10)).toFixed(1)},${(8 + (v / lo) * (ddH - 30)).toFixed(1)}`).join(" ");
  return `
    <div class="card">
      <h3>Daily return distribution</h3>
      <table class="metrics">
        <tr><th>n</th><th>Mean</th><th>Std dev</th><th>Skew</th><th>Excess kurtosis</th><th>Jarque-Bera p</th></tr>
        <tr><td>${R.n}</td><td>${(R.mean * 100).toFixed(3)}%</td><td>${(R.sd * 100).toFixed(3)}%</td><td>${num(R.skewness)}</td><td>${num(R.excessKurtosis)}</td><td>${R.jbPValue < 0.001 ? "< 0.001" : num(R.jbPValue)}</td></tr>
      </table>
      <p class="hint" style="margin-top:12px">Excess kurtosis far above 0 means fatter tails than a normal distribution.</p>
    </div>
    <div class="card">
      ${bars(s.acfSq, "Autocorrelation of squared returns")}
      <p class="hint">Ljung-Box Q(10) = ${s.ljungBoxSq.q.toFixed(1)}, p ${s.ljungBoxSq.pValue < 1e-6 ? "< 1e-6" : s.ljungBoxSq.pValue.toExponential(2)}. Significant spikes mean volatility clusters, which is what the rule exploits.</p>
    </div>
    <div class="card">
      ${bars(s.acfAbs, "Autocorrelation of absolute returns")}
    </div>
    <div class="card">
      <h3>Drawdown, buy and hold</h3>
      <svg class="chart" viewBox="0 0 ${ddW} ${ddH}" role="img" aria-label="Buy and hold drawdown">
        <path d="${ddPath}" fill="none" stroke="var(--down)" stroke-width="1.6"/>
        <text x="${ddPl}" y="${ddH - 4}" fill="var(--muted)" font-size="12" font-family="var(--sans)">worst ${pct(Math.min(...dd))}</text>
      </svg>
    </div>`;
}

function render(r, name) {
  const o = r.outOfSample;
  const modeName = r.mode === 'daily' ? 'Daily rule' : 'Paper rule (monthly)';
  $('results').innerHTML = `
    <div class="card">
      <div class="tools" style="justify-content:space-between;align-items:baseline">
        <div>
          <h2 style="margin:0">${esc(name)}</h2>
          <p class="muted" style="margin:4px 0 0">${modeName} · ${r.rows} rows · ${esc(r.from)} to ${esc(r.to)} · test from ${esc(r.splitDate)}</p>
        </div>
        <button class="btn ghost" id="download" type="button">Download JSON</button>
      </div>
    </div>
    <div class="kpis">
      <div class="kpi hi"><span>Test CAGR, managed</span><strong>${pct(o.strategy.cagr)}</strong></div>
      <div class="kpi"><span>Test CAGR, buy and hold</span><strong>${pct(o.buyHold.cagr)}</strong></div>
      <div class="kpi hi"><span>Test Sharpe, managed</span><strong>${num(o.strategy.sharpe)}</strong></div>
      <div class="kpi"><span>Test max drawdown, managed</span><strong>${pct(o.strategy.maxDrawdown)}</strong></div>
    </div>
    ${r.stats ? statsPanel(r.stats) : ''}
    <div class="card">
      <h3>Growth of 1 in the test period</h3>
      ${growthChart(r)}
      <div class="legend"><span><i style="background:var(--ink-2)"></i>Buy and hold</span><span><i style="background:var(--accent)"></i>Volatility-managed</span></div>
    </div>
    <div class="card">
      <h3>Exposure held, test period</h3>
      ${exposureChart(r)}
    </div>
    <div class="card tablewrap">
      <h3>Metrics, train and test</h3>
      ${metricsTable(r)}
      <p class="hint" style="margin-top:12px">Constant c = ${r.c.toExponential(3)}, fixed on the train period. Costs are charged on every change in exposure.</p>
    </div>`;
  $('download').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `volatility-lab-${name.replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
  });
}

async function run() {
  $('run').disabled = true;
  setStatus('Running…');
  try {
    if (source.text == null && !source.file) throw new Error('Upload a CSV first.');
    const csv = source.text ?? (await datasetText(source.file));
    const res = await fetch('api/backtest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildPayload(csv)),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `request failed (${res.status})`);
    render(body, source.name);
    setStatus(`Done: ${body.rows} rows computed on the server.`);
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    $('run').disabled = false;
  }
}

function pickDataset(btn) {
  document.querySelectorAll('#datasets button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  source = { name: btn.textContent, text: null, file: btn.dataset.file };
  setStatus(`Selected ${btn.textContent}.`);
}

if (isLocal) {
  document.querySelectorAll('#datasets button').forEach((b) => b.addEventListener('click', () => pickDataset(b)));
} else {
  $('datasets').hidden = true;
  source = { name: 'Your data', text: null, file: null };
}

const drop = $('drop');
const useFile = (file) => {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return setStatus('That file is over 5 MB.', true);
  file.text().then((text) => {
    source = { name: file.name, text, file: null };
    document.querySelectorAll('#datasets button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    setStatus(`Loaded ${file.name}.`);
  });
};
$('file').addEventListener('change', (e) => useFile(e.target.files[0]));
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
  e.preventDefault();
  drop.classList.add('over');
}));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
  e.preventDefault();
  drop.classList.remove('over');
}));
drop.addEventListener('drop', (e) => useFile(e.dataTransfer.files[0]));

$('mode').addEventListener('change', syncCapVisibility);
$('run').addEventListener('click', run);
syncCapVisibility();
