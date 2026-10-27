import { inr, lakh, pct, liveChart, SIP_VOL_PANELS, sipVolTooltip, barChart } from './chart.js';

const BUNDLED = { nifty: 'data/nifty.csv', banknifty: 'data/banknifty.csv' };
const NAMES = { nifty: 'Nifty 50', banknifty: 'Bank Nifty' };
const TABS = ['live', 'compare', 'stats'];
const PERIODS = { '1y': { months: 12 }, '2y': { months: 24 }, '3y': { months: 36 }, '5y': { months: 60 }, max: { months: 240, start: '2019-01-02' } };
const STUDY_FROM = '2018-12-01';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const SETTING_IDS = ['pool', 'sip', 'window', 'rebalance', 'maxExp', 'minExp', 'cost', 'cash'];
const CSV_HEAD = ['date', 'index_close', 'volatility_per_year', 'volatility_plan_share_in_index', 'sip_share_in_index', 'sip_value', 'volatility_plan_value', 'sip_cost', 'volatility_plan_cost', 'sip_drawdown', 'volatility_plan_drawdown'];
const PAIR = (nk, bk) => [{ key: nk, color: 'var(--nifty)', label: 'Nifty 50' }, { key: bk, color: 'var(--bank)', label: 'Bank Nifty' }];
const CMP_PANELS = [
  { id: 'value', title: 'Volatility-based pool value', height: 250, lines: PAIR('nValue', 'bValue'), axisFmt: (v) => lakh(v).replace(' ', ''), baselineKey: 'pool' },
  { id: 'idx', title: 'Index level (start = 100)', height: 150, lines: PAIR('nIdx', 'bIdx'), axisFmt: (v) => v.toFixed(0) },
  { id: 'dd', title: 'Fall from the previous high (volatility-based plan)', height: 130, lines: PAIR('nDd', 'bDd'), axisFmt: (v) => `${(v * 100).toFixed(0)}%`, zeroMax: true },
  { id: 'vol', title: 'Index volatility (last 20 days, per year)', height: 120, lines: PAIR('nVol', 'bVol'), axisFmt: (v) => `${(v * 100).toFixed(0)}%`, zeroMin: true },
  { id: 'exp', title: 'Share of the pool in the index (volatility-based plan)', height: 120, lines: PAIR('nW', 'bW'), axisFmt: (v) => `${(v * 100).toFixed(0)}%`, fixed: [0, 1] },
];
const PAPER_ROWS = [
  ['Annualised alpha', (p) => pct(p.alphaAnnual, 2)],
  ['Beta', (p) => p.beta.toFixed(3)],
  ['t-statistic of alpha', (p) => p.tAlpha.toFixed(2)],
  ['R squared', (p) => p.r2.toFixed(3)],
  ['Appraisal ratio (annual)', (p) => p.appraisalAnnual.toFixed(2)],
  ['Sharpe ratio, buy-and-hold', (p) => p.sharpeOriginal.toFixed(2)],
  ['Sharpe ratio, managed', (p) => p.sharpeManaged.toFixed(2)],
  ['Increase in Sharpe ratio', (p) => pct(p.sharpeIncrease, 1)],
  ['Sharpe from the alpha formula', (p) => p.sharpeCombined.toFixed(2)],
  ['Mean-variance utility gain', (p) => pct(p.utilityGain, 0)],
  ['Monthly standard deviation, original', (p) => pct(p.sdOriginal, 2)],
  ['Monthly standard deviation, managed', (p) => pct(p.sdManaged, 2)],
  ['Constant c', (p) => p.c.toExponential(3)],
  ['Largest weight', (p) => `${p.maxWeight.toFixed(2)}x`],
  ['Mean weight', (p) => `${p.meanWeight.toFixed(2)}x`],
];
const DAILY_ROWS = [
  ['Days', (d) => d.returns.n],
  ['Mean daily return', (d) => pct(d.returns.mean, 3)],
  ['Standard deviation (daily)', (d) => pct(d.returns.sd, 2)],
  ['Skewness', (d) => d.returns.skewness.toFixed(2)],
  ['Excess kurtosis', (d) => d.returns.excessKurtosis.toFixed(2)],
  ['Jarque-Bera (p-value)', (d) => `${d.returns.jarqueBera.toFixed(1)} (p ${pFmt(d.returns.jbPValue)})`],
  ['Ljung-Box Q(10) on squared returns (p-value)', (d) => `${d.ljungBoxSq.q.toFixed(1)} (p ${pFmt(d.ljungBoxSq.pValue)})`],
];

const state = { index: 'nifty', range: 'max', tab: 'live', token: 0, overrides: {}, data: {} };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const bold = (t) => `<b>${t}</b>`;
const signedInr = (x) => `${x < 0 ? '-' : '+'}${inr(Math.abs(x))}`;
const signedPts = (x) => `${x < 0 ? '-' : '+'}${Math.abs(x * 100).toFixed(1)} pts`;
const signedNum = (x, d = 2, unit = '') => `${x < 0 ? '-' : '+'}${Math.abs(x).toFixed(d)}${unit}`;
const pFmt = (p) => (p < 0.001 ? '< 0.001' : p.toFixed(3));
const fmtSlope = (x) => (Math.abs(x) < 0.01 ? x.toExponential(2) : x.toFixed(3));
const sub = (t) => `<span class="sub" style="display:block">${esc(t)}</span>`;
const slug = (s) => s.replace(/\.csv$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom';
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const setStatus = (msg, isErr = false) => { const s = $('status'); s.textContent = msg; s.classList.toggle('err', isErr); };
const indexName = (k) => state.overrides[k]?.name ?? NAMES[k];
const notesHtml = (notes) => (notes?.length ? `<span class="note" style="display:block;margin-top:10px">${notes.map(esc).join(' ')}</span>` : '');
const pressed = (id) => $(id).querySelector('[aria-pressed="true"]')?.dataset.v;
const returnsOf = (v) => v.slice(1).map((x, i) => x / v[i] - 1);
const annualVol = (r) => r.stats.returns.sd * Math.sqrt(252);

const textCache = new Map();
function fetchText(url) {
  if (!textCache.has(url)) {
    textCache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(`Could not load ${url}.`); return r.text(); }).catch((e) => { textCache.delete(url); throw e; }));
  }
  return textCache.get(url);
}

async function postJson(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status}).`);
  return data;
}

const resultCache = new Map();
function cachedPost(path, body) {
  const key = `${path}\n${JSON.stringify(body)}`;
  if (!resultCache.has(key)) resultCache.set(key, postJson(path, body).catch((e) => { resultCache.delete(key); throw e; }));
  return resultCache.get(key);
}

function settings() {
  const num = (id) => Number($(id).value);
  return {
    pool: num('pool'),
    sip: num('sip'),
    window: num('window'),
    minExposure: num('minExp') / 100,
    maxExposure: num('maxExp') / 100,
    cost: num('cost') / 100,
    cashRate: num('cash') / 100,
    rebalance: $('rebalance').value,
  };
}

function periodBody() {
  const p = PERIODS[state.range] ?? PERIODS.max;
  return p.start ? { months: p.months, start: p.start } : { months: p.months };
}

const csvFor = (index) => (state.overrides[index] ? state.overrides[index].text : fetchText(BUNDLED[index]));

function ownMaxFall(series) {
  let peak = -Infinity;
  let worst = 0;
  for (const d of series) {
    peak = Math.max(peak, d.close);
    worst = Math.min(worst, d.close / peak - 1);
  }
  return worst;
}

function correlation(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy);
}

function mergeSeries(sa, sb) {
  const byDate = new Map(sb.map((d) => [d.date, d]));
  const pairs = sa.filter((d) => byDate.has(d.date)).map((d) => [d, byDate.get(d.date)]);
  if (!pairs.length) return [];
  const n0 = pairs[0][0].close;
  const b0 = pairs[0][1].close;
  return pairs.map(([x, y]) => ({
    date: x.date,
    nValue: x.volValue, bValue: y.volValue,
    nIdx: (100 * x.close) / n0, bIdx: (100 * y.close) / b0,
    nDd: x.volDd, bDd: y.volDd,
    nVol: x.vol, bVol: y.vol,
    nW: x.volWeight, bW: y.volWeight,
    nClose: x.close, bClose: y.close,
  }));
}

function toCsv(series) {
  const rows = series.map((d) => [d.date, d.close, d.vol, d.volWeight, d.sipExposure, d.sipValue, d.volValue, d.sipCost, d.volCost, d.sipDd, d.volDd].join(','));
  return [CSV_HEAD.join(','), ...rows].join('\n') + '\n';
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadLive() {
  const index = state.index;
  const o = state.overrides[index];
  const csv = await csvFor(index);
  const result = await cachedPost('api/compare', { csv, ...settings(), ...periodBody() });
  return { index, name: indexName(index), key: o ? slug(o.name) : index, result };
}

function liveVerdict(r) {
  const { params: p, sip, vol } = r;
  const gap = vol.final - sip.final;
  const parts = [
    `From ${esc(r.period.from)} to ${esc(r.period.to)}, a pool of ${bold(inr(p.pool))} invested the monthly way (${bold(inr(p.sip))} a month, the rest in cash) ended at ${bold(inr(sip.final))}.`,
    `The volatility-based plan ended at ${bold(inr(vol.final))}, which is ${bold(inr(Math.abs(gap)))} ${gap >= 0 ? 'higher' : 'lower'}.`,
    `The volatility-based plan held on average ${bold(pct(vol.avgExposure, 0))} of the pool in the index against ${bold(pct(sip.avgExposure, 0))} for the monthly plan, so the gap reflects both how much was invested and when.`,
    `Biggest fall from a high: ${bold(pct(vol.maxDrawdown))} for the volatility plan, ${bold(pct(sip.maxDrawdown))} for the monthly plan.`,
  ];
  return parts.join(' ') + notesHtml(r.notes);
}

function kpiTable({ sip, vol, period, series }) {
  const dash = '-';
  const row = (label, a, c, d) => `<tr><td>${label}</td><td>${a}</td><td>${c}</td><td>${d}</td></tr>`;
  const sec = (t) => `<tr class="sec"><td colspan="4">${t}</td></tr>`;
  const pts = (k) => signedPts(vol[k] - sip[k]);
  const own = pct(ownMaxFall(series));
  return '<tr><th></th><th>Monthly SIP</th><th>Volatility-based</th><th>Difference</th></tr>'
    + sec('The index')
    + row('Index change over the period', pct(period.niftyChange), pct(period.niftyChange), dash)
    + row('Index own biggest fall', own, own, dash)
    + sec('Results on the pool')
    + row('Final value', inr(sip.final), inr(vol.final), signedInr(vol.final - sip.final))
    + row('Profit or loss', signedInr(sip.profit), signedInr(vol.profit), signedInr(vol.profit - sip.profit))
    + row('Return on the pool', pct(sip.returnPct), pct(vol.returnPct), pts('returnPct'))
    + row('Biggest fall from a high (maximum drawdown)', pct(sip.maxDrawdown) + sub(sip.troughDate), pct(vol.maxDrawdown) + sub(vol.troughDate), pts('maxDrawdown'))
    + row('Longest time below a previous high', `${sip.longestUnderwaterDays} trading days`, `${vol.longestUnderwaterDays} trading days`, signedNum(vol.longestUnderwaterDays - sip.longestUnderwaterDays, 0, ' days'))
    + row('Worst single day', pct(sip.worstDay, 2), pct(vol.worstDay, 2), pts('worstDay'))
    + row('Best single day', pct(sip.bestDay, 2), pct(vol.bestDay, 2), pts('bestDay'))
    + row('Average share of the pool in the index', pct(sip.avgExposure, 0), pct(vol.avgExposure, 0), pts('avgExposure'))
    + row('Ups and downs (volatility, per year)', pct(sip.annVol), pct(vol.annVol), pts('annVol'))
    + row('Return per unit of risk (Sharpe ratio)', sip.sharpe.toFixed(2), vol.sharpe.toFixed(2), signedNum(vol.sharpe - sip.sharpe))
    + row('Trading costs paid', inr(sip.costTotal), inr(vol.costTotal), signedInr(vol.costTotal - sip.costTotal))
    + sec('Monthly SIP only')
    + row('Money put in', inr(sip.invested) + sub(`${sip.purchases} purchases`), dash, dash)
    + row('Return on the money actually put in (per year)', pct(sip.moneyWeightedReturn), dash, dash);
}

function renderLive(data) {
  const { result: r, name } = data;
  $('verdict').innerHTML = liveVerdict(r);
  $('kpis').innerHTML = kpiTable(r);
  liveChart($('chart'), r.series, { baseline: r.params.pool, panels: SIP_VOL_PANELS, tooltip: (d) => sipVolTooltip(d, name) });
}

async function loadCompare() {
  const [csvN, csvB] = await Promise.all([fetchText(BUNDLED.nifty), fetchText(BUNDLED.banknifty)]);
  const common = { ...settings(), ...periodBody() };
  const [n, b] = await Promise.all([
    cachedPost('api/compare', { csv: csvN, ...common }),
    cachedPost('api/compare', { csv: csvB, ...common }),
  ]);
  return { n, b, merged: mergeSeries(n.series, b.series) };
}

const cmpTooltip = (d) => ({
  rows: [
    { label: 'Nifty 50 close', value: Math.round(d.nClose).toLocaleString('en-IN'), color: 'var(--nifty)' },
    { label: 'Bank Nifty close', value: Math.round(d.bClose).toLocaleString('en-IN'), color: 'var(--bank)' },
    { label: 'Nifty 50 pool', value: `${lakh(d.nValue)}  (${pct(d.nW, 0)} in index)`, color: 'var(--nifty)' },
    { label: 'Bank Nifty pool', value: `${lakh(d.bValue)}  (${pct(d.bW, 0)} in index)`, color: 'var(--bank)' },
    { label: 'Fall from high (Nifty vs Bank)', value: `${pct(d.nDd)} vs ${pct(d.bDd)}` },
    { label: 'Volatility (Nifty vs Bank)', value: `${pct(d.nVol)} vs ${pct(d.bVol)}` },
  ],
});

function renderCompare({ n, b, merged }) {
  const rho = correlation(returnsOf(merged.map((d) => d.nClose)), returnsOf(merged.map((d) => d.bClose)));
  const crow = (label, x, y) => `<tr><td>${label}</td><td>${x}</td><td>${y}</td></tr>`;
  const csec = (t) => `<tr class="sec"><td colspan="3">${t}</td></tr>`;
  $('cmpTable').innerHTML = '<tr><th></th><th>Nifty 50</th><th>Bank Nifty</th></tr>'
    + csec('The index')
    + crow('Index change over the period', pct(n.period.niftyChange), pct(b.period.niftyChange))
    + crow('Index own biggest fall', pct(ownMaxFall(n.series)), pct(ownMaxFall(b.series)))
    + crow('Index volatility over the period (per year)', pct(annualVol(n)), pct(annualVol(b)))
    + crow('Correlation of daily returns', rho.toFixed(2), rho.toFixed(2))
    + csec('Volatility-based plan on the pool')
    + crow('Final value', inr(n.vol.final), inr(b.vol.final))
    + crow('Profit or loss', signedInr(n.vol.profit), signedInr(b.vol.profit))
    + crow('Return on the pool', pct(n.vol.returnPct), pct(b.vol.returnPct))
    + crow('Biggest fall from a high', pct(n.vol.maxDrawdown) + sub(n.vol.troughDate), pct(b.vol.maxDrawdown) + sub(b.vol.troughDate))
    + crow('Return per unit of risk (Sharpe)', n.vol.sharpe.toFixed(2), b.vol.sharpe.toFixed(2))
    + crow('Average share in the index', pct(n.vol.avgExposure, 0), pct(b.vol.avgExposure, 0))
    + crow('Trading costs paid', inr(n.vol.costTotal), inr(b.vol.costTotal))
    + csec('Monthly SIP on the pool')
    + crow('Final value', inr(n.sip.final), inr(b.sip.final))
    + crow('Return on the pool', pct(n.sip.returnPct), pct(b.sip.returnPct))
    + crow('Biggest fall from a high', pct(n.sip.maxDrawdown), pct(b.sip.maxDrawdown))
    + crow('Return on money actually put in (per year)', pct(n.sip.moneyWeightedReturn), pct(b.sip.moneyWeightedReturn));
  const ratio = annualVol(b) / annualVol(n);
  $('cmpVerdict').innerHTML = [
    `Under the volatility-based plan the pool ended at ${bold(inr(n.vol.final))} in Nifty 50 and ${bold(inr(b.vol.final))} in Bank Nifty.`,
    `The biggest fall from a high was ${bold(pct(n.vol.maxDrawdown))} for Nifty 50 and ${bold(pct(b.vol.maxDrawdown))} for Bank Nifty.`,
    `Bank Nifty's volatility over the period was ${bold(ratio.toFixed(2))} times Nifty 50's.`,
  ].join(' ') + notesHtml([...new Set([...n.notes, ...b.notes])]);
  const chart = $('cmpChart');
  if (merged.length < 2) chart.textContent = 'No dates in common between the two series.';
  else liveChart(chart, merged, { baseline: n.params.pool, panels: CMP_PANELS, tooltip: cmpTooltip });
}

async function loadStats() {
  const rf = settings().cashRate;
  const cols = [];
  for (const key of ['nifty', 'banknifty']) {
    cols.push({ key, label: NAMES[key], body: { csv: await fetchText(BUNDLED[key]), from: STUDY_FROM, rf } });
  }
  for (const key of ['nifty', 'banknifty']) {
    const o = state.overrides[key];
    if (o) cols.push({ key: `file-${key}`, label: o.name, body: { csv: o.text, rf } });
  }
  const res = await Promise.all(cols.map((c) => cachedPost('api/study', c.body)));
  return cols.map((c, i) => ({ key: c.key, label: c.label, res: res[i] }));
}

const costLabel = (k) => `${k.cap === null ? 'No cap' : `Cap ${k.cap}x`}, ${Math.round(k.cost * 10000)} bp`;

function renderStats(cols) {
  const st = (c) => c.res.study;
  const pending = [];
  const head = `<tr><th></th>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr>`;
  const line = (label, vals) => `<tr><td>${label}</td>${vals.map((v) => `<td>${v}</td>`).join('')}</tr>`;
  const table = (rows) => `<div class="scroll-x"><table class="cmp">${head}${rows}</table></div>`;
  const card = (title, question, body) => `<div class="card" style="margin-top:16px"><h3>${title}</h3><p class="note">${question}</p>${body}</div>`;
  const reg = (prefix, get) => {
    const p = prefix ? `${prefix}: ` : '';
    return line(`${p}correlation`, cols.map((c) => get(c).corr.toFixed(3)))
      + line(`${p}slope`, cols.map((c) => fmtSlope(get(c).slope)))
      + line(`${p}t-statistic of slope`, cols.map((c) => get(c).tSlope.toFixed(2)))
      + line(`${p}R squared`, cols.map((c) => get(c).r2.toFixed(3)));
  };
  const droppedCounts = [...new Set(cols.map((c) => st(c).predictabilityTrimmed.dropped))];
  const droppedText = droppedCounts.length === 1
    ? `${droppedCounts[0]} months dropped`
    : cols.map((c) => `${esc(c.label)}: ${st(c).predictabilityTrimmed.dropped} months dropped`).join('; ');
  const quintileBlocks = cols.map((c, k) => {
    const qs = st(c).quintiles;
    const id = `q${k}`;
    const rows = qs.map((q) => `<tr><td>${q.group}</td><td>${q.n}</td><td>${q.avgLagRv.toExponential(2)}</td><td>${q.avgRv.toExponential(2)}</td><td>${pct(q.avgExcess, 2)}</td><td>${q.meanVarianceRatio.toFixed(2)}</td></tr>`).join('');
    const labels = ['1', '2', '3', '4', '5'];
    pending.push({ el: `${id}-var`, opts: { labels, series: [{ label: 'Avg variance this month', color: 'var(--ink)', values: qs.map((q) => q.avgRv) }], fmt: (v) => v.toExponential(1) } });
    pending.push({ el: `${id}-ret`, opts: { labels, series: [{ label: 'Avg excess return this month', color: 'var(--vol)', values: qs.map((q) => q.avgExcess) }], fmt: (v) => pct(v, 1) } });
    return `<div><p class="note"><b>${esc(c.label)}</b></p><div class="scroll-x"><table class="cmp"><tr><th>Group</th><th>Months</th><th>Avg last-month variance</th><th>Avg variance this month</th><th>Avg excess return this month</th><th>Return / variance</th></tr>${rows}</table></div><p class="note">Top: average variance this month. Bottom: average excess return this month.</p><div id="${id}-var"></div><div id="${id}-ret"></div></div>`;
  }).join('');
  const costRows = st(cols[0]).costs.map((k, i) => line(costLabel(k), cols.map((c) => { const x = st(c).costs[i]; return `${pct(x.alphaAnnual, 2)} (t=${x.tAlpha.toFixed(2)})`; }))).join('');
  const paperRows = PAPER_ROWS.map(([label, f]) => line(label, cols.map((c) => f(st(c).paper)))).join('');
  const dailyRows = DAILY_ROWS.map(([label, f]) => line(label, cols.map((c) => f(c.res.daily)))).join('');
  const bullets = cols.map((c) => {
    const s = st(c);
    const pr = s.persistence.rv;
    const pd = s.predictability;
    const pa = s.paper;
    const pt = s.predictabilityTrimmed;
    const fullSig = Math.abs(pd.tSlope) >= 2;
    const trimSig = Math.abs(pt.tSlope) >= 2;
    const predictText = fullSig && trimSig
      ? `Last month's volatility predicts returns in the full sample (t = ${pd.tSlope.toFixed(2)}) and after dropping the ${pt.dropped} highest-variance months (t = ${pt.tSlope.toFixed(2)}).`
      : fullSig
        ? `In ${esc(c.label)}, last month's volatility appears to predict returns in the full sample (t = ${pd.tSlope.toFixed(2)}), but not once the ${pt.dropped} highest-variance months are dropped (t = ${pt.tSlope.toFixed(2)}), so the result rests on a few extreme months.`
        : `No evidence that last month's volatility predicts returns (t = ${pd.tSlope.toFixed(2)}).`;
    const items = [
      Math.abs(pr.tSlope) >= 2
        ? `Volatility is persistent: correlation ${pr.corr.toFixed(2)}, t = ${pr.tSlope.toFixed(2)}.`
        : `Volatility is not persistent: correlation ${pr.corr.toFixed(2)}, t = ${pr.tSlope.toFixed(2)}.`,
      predictText,
      Math.abs(pa.tAlpha) < 2
        ? `The alpha of ${pct(pa.alphaAnnual, 2)} is not statistically different from zero at the usual 5% level (t = ${pa.tAlpha.toFixed(2)}).`
        : `The alpha of ${pct(pa.alphaAnnual, 2)} is statistically different from zero (t = ${pa.tAlpha.toFixed(2)}).`,
      `The sample is ${s.n} months; the paper uses about 1,070 months, so treat small samples carefully.`,
    ];
    return `<p><b>${esc(c.label)}</b></p><ul>${items.map((t) => `<li>${t}</li>`).join('')}</ul>`;
  }).join('');
  const html = [
    card('Sample', 'How much data sits behind each result?', table(
      line('Months', cols.map((c) => st(c).n))
      + line('Period', cols.map((c) => `${esc(st(c).from)} to ${esc(st(c).to)}`))
      + line('Risk-free rate used', cols.map((c) => pct(st(c).rf, 2))))),
    card('Is volatility persistent?', 'Realized variance this month on last month, in levels and in logs.', table(
      reg('Levels', (c) => st(c).persistence.rv) + reg('Log levels', (c) => st(c).persistence.logRv))),
    card("Does last month's volatility predict this month's excess return?", 'A regression of this month excess return on last month variance.', table(
      reg('', (c) => st(c).predictability)
      + line(`Excluding the highest 5% of last-month variance (${droppedText}): slope`, cols.map((c) => fmtSlope(st(c).predictabilityTrimmed.slope)))
      + line(`Excluding the highest 5% of last-month variance (${droppedText}): t-statistic of slope`, cols.map((c) => st(c).predictabilityTrimmed.tSlope.toFixed(2))))),
    card("Months sorted into five groups by last month's variance", "The paper's Figure 1: each group's variance and excess return this month.", `<div class="cols-2">${quintileBlocks}</div>`),
    card('Volatility-managed against buy-and-hold (paper equations 1 to 3)', 'Does scaling exposure by inverse variance add alpha?', table(paperRows)),
    card('Alpha after trading costs and leverage caps (paper Table IV style)', 'Does the alpha survive trading costs and leverage limits? Cells show annualised alpha and its t-statistic.', table(costRows)),
    card('Daily return statistics', 'Are daily returns close to normal, and is there clustering in squared returns?', table(dailyRows)),
    card('How to read this', 'Plain-English reading of the numbers above.', bullets),
  ].join('');
  $('statsBody').innerHTML = html;
  for (const p of pending) barChart($(p.el), p.opts);
  const isPersistent = (c) => Math.abs(st(c).persistence.rv.tSlope) >= 2;
  const isPredictable = (c) => Math.abs(st(c).predictability.tSlope) >= 2 && Math.abs(st(c).predictabilityTrimmed.tSlope) >= 2;
  const names = (cs) => (cs.length ? cs.map((c) => esc(c.label)).join(', ') : 'none of the indices');
  $('statsVerdict').innerHTML = `Volatility persists from one month to the next in ${names(cols.filter(isPersistent))}. Last month's volatility predicts this month's excess return in ${names(cols.filter(isPredictable))}.`;
}

function downloadStats() {
  const data = state.data.stats;
  if (!data) { setStatus('Open the Statistics tab first.', true); return; }
  const obj = {};
  for (const c of data) obj[c.key] = c.res;
  download('volatility-lab-statistics.json', JSON.stringify(obj, null, 2), 'application/json');
}

function downloadLive() {
  const data = state.data.live;
  if (!data) { setStatus('Nothing to download yet.', true); return; }
  const r = data.result;
  download(`volatility-lab-${data.key}-${r.period.from.slice(0, 4)}-to-${r.period.to.slice(0, 4)}.csv`, toCsv(r.series), 'text/csv');
}

const LOADERS = { live: loadLive, compare: loadCompare, stats: loadStats };
const RENDERERS = { live: renderLive, compare: renderCompare, stats: renderStats };
const SUMMARIES = {
  live: (d) => `Done: ${d.result.series.length} trading days${state.overrides[d.index] ? ` from ${state.overrides[d.index].name}` : ''}.`,
  compare: (d) => `Done: ${d.merged.length} common trading days.`,
  stats: (d) => `Done: statistics for ${d.length} series.`,
};

async function refresh() {
  const tab = state.tab;
  const token = ++state.token;
  setStatus('Running...');
  try {
    const data = await LOADERS[tab]();
    if (token !== state.token) return;
    state.data[tab] = data;
    RENDERERS[tab](data);
    setStatus(SUMMARIES[tab](data));
  } catch (err) {
    if (token === state.token) setStatus(err.message || 'Something went wrong.', true);
  }
}

function selectTab(tab) {
  state.tab = tab;
  for (const t of TABS) {
    const on = t === tab;
    const btn = $(`t-${t}`);
    btn.setAttribute('aria-selected', String(on));
    btn.tabIndex = on ? 0 : -1;
    $(`tab-${t}`).hidden = !on;
  }
  refresh();
}

function rerender() {
  const data = state.data[state.tab];
  if (data) RENDERERS[state.tab](data);
}

function wireSeg(id, onPick) {
  const buttons = [...$(id).querySelectorAll('button')];
  buttons.forEach((btn) => btn.addEventListener('click', () => {
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    onPick(btn.dataset.v);
    refresh();
  }));
}

async function onFile(e) {
  const input = e.target;
  const file = input.files[0];
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    input.value = '';
    setStatus('That file is over 5 MB; choose a smaller CSV.', true);
    return;
  }
  try {
    state.overrides[state.index] = { name: file.name, text: await file.text() };
  } catch {
    setStatus('Could not read that file.', true);
    return;
  }
  refresh();
}

function init() {
  state.index = pressed('index') || 'nifty';
  state.range = pressed('range') || 'max';
  wireSeg('index', (v) => { state.index = v; });
  wireSeg('range', (v) => { state.range = v; });
  SETTING_IDS.forEach((id) => $(id).addEventListener('change', debounce(refresh, 300)));
  $('file').addEventListener('change', onFile);
  $('download').addEventListener('click', downloadLive);
  $('downloadStats').addEventListener('click', downloadStats);
  const tabButtons = TABS.map((t) => $(`t-${t}`));
  tabButtons.forEach((btn, i) => {
    btn.addEventListener('click', () => selectTab(TABS[i]));
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const j = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
      tabButtons[j].focus();
      selectTab(TABS[j]);
    });
  });
  window.addEventListener('resize', debounce(rerender, 200));
  selectTab('live');
}

init();
