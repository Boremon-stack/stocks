import { inr, lakh, pct, liveChart, SIP_VOL_PANELS, sipVolTooltip, barChart } from './chart.js';
import { parseCsv } from './backtest.js';

const BUNDLED = { nifty: 'data/nifty.csv', banknifty: 'data/banknifty.csv' };
const NAMES = { nifty: 'Nifty 50', banknifty: 'Bank Nifty' };
const TABS = ['live', 'compare', 'stats', 'sweep'];
const PERIODS = { '1y': { months: 12 }, '2y': { months: 24 }, '3y': { months: 36 }, '5y': { months: 60 }, max: { months: 240, start: '2019-01-02' } };
const STUDY_FROM = '2018-12-01';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const SETTING_IDS = ['pool', 'sip', 'window', 'rebalance', 'scaling', 'calibration', 'maxExp', 'minExp', 'cost', 'cash'];
const CTL_PANELS = SIP_VOL_PANELS.map((p, i) => (i === 0 ? { ...p, lines: [...p.lines, { key: 'ctlValue', color: 'var(--ink-2)', label: 'Constant share' }] } : p));
const CSV_COLS = [
  ['date', 'date'], ['close', 'close'], ['vol', 'volatility'], ['volWeight', 'vol_share'], ['sipExposure', 'sip_share'],
  ['volInIndex', 'vol_in_index'], ['sipInIndex', 'sip_in_index'], ['sipValue', 'sip_value'], ['volValue', 'vol_value'],
  ['sipCost', 'sip_cost'], ['volCost', 'vol_cost'], ['volTrade', 'vol_trade'], ['sipBuy', 'sip_buy'], ['sipDd', 'sip_drawdown'], ['volDd', 'vol_drawdown'],
];
const LIST_CAP = 400;
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
  ['t-statistic of alpha (robust to heteroskedasticity)', (p) => numOr(p.tAlphaRobust, 2)],
  ['Weight, median / 75th / 90th / 99th percentile / largest', (p) => seqOr([p.weights?.p50, p.weights?.p75, p.weights?.p90, p.weights?.p99, p.weights?.max], (x) => x.toFixed(2))],
  ['Average absolute change in weight per month', (p) => numOr(p.avgAbsWeightChange, 2)],
  ['Alpha after trading costs of 1, 10 and 14 bp', (p) => seqOr([p.alphaAfterCost?.['1'], p.alphaAfterCost?.['10'], p.alphaAfterCost?.['14']], (x) => pct(x, 2))],
  ['Break-even trading cost', (p) => numOr(p.breakEvenBp, 0, ' bp')],
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
const cashPct = (rate) => `${Number((rate * 100).toFixed(1))}%`;
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

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const fx2 = (x) => x.toFixed(2);
const numOr = (x, d, suffix = '') => (isNum(x) ? `${x.toFixed(d)}${suffix}` : '-');
const seqOr = (xs, f) => (xs.every(isNum) ? xs.map(f).join(' / ') : '-');
const vf = (o, k, f) => (isNum(o?.[k]) ? f(o[k]) : '-');
const shownOr = (v, f) => (v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v)) ? '-' : f(v));
const pctOr = (x, d = 1) => shownOr(x, (v) => pct(v, d));
const txt = (s) => (typeof s === 'string' && s ? esc(s) : '-');
const seriesVals = (series, key) => (Array.isArray(series) ? series.map((d) => d?.[key]).filter(isNum) : []);
const meanOf = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : undefined);
const ensureAfter = (id, anchor, tag = 'div') => {
  let el = $(id);
  if (!el && anchor) {
    el = document.createElement(tag);
    el.id = id;
    anchor.after(el);
  }
  return el;
};

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
    scaling: $('scaling').value,
    calibration: $('calibration').value,
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
  const cols = CSV_COLS.filter(([field]) => field === 'date' || series.some((d) => d[field] !== undefined));
  const rows = series.map((d) => cols.map(([field]) => d[field] ?? '').join(','));
  return [cols.map(([, head]) => head).join(','), ...rows].join('\n') + '\n';
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
  const si = sip.investments ?? {};
  const vi = vol.investments ?? {};
  const noCash = !(p.cashRate > 0);
  const c = sip.components;
  const put = si.totalPutIn;
  const cashOk = c && isNum(sip.profit) && (noCash ? isNum(c.costs) : isNum(c.interest) && isNum(c.indexGain));
  const cashLine = !cashOk ? []
    : noCash ? [`With idle cash earning nothing, the monthly plan's ${bold(signedInr(sip.profit))} is what the index did${isNum(put) ? ` to the ${bold(inr(put))} it put in` : ''}, less ${bold(inr(c.costs))} of trading costs.`]
    : [`Of the monthly plan's ${bold(signedInr(sip.profit))}, ${bold(inr(c.interest))} is interest on idle cash (${cashPct(p.cashRate)} a year) and ${bold(signedInr(c.indexGain))} came from the index itself.`];
  const sentences = [];
  if (isNum(sip.final) && isNum(vol.final)) {
    const gap = vol.final - sip.final;
    sentences.push(`From ${esc(r.period.from)} to ${esc(r.period.to)}, a pool of ${bold(inr(p.pool))} ended at ${bold(inr(sip.final))} with the monthly plan and ${bold(inr(vol.final))} with the volatility-based plan, ${bold(inr(Math.abs(gap)))} ${gap >= 0 ? 'higher' : 'lower'} for the volatility-based plan.`);
  }
  if (isNum(put) && isNum(si.purchases) && isNum(si.perPurchase)) {
    sentences.push(`The monthly plan put ${bold(inr(put))} into the index over ${bold(si.purchases)} purchases of ${bold(inr(si.perPurchase))}.`);
  }
  if ([vi.trades, vi.buys, vi.sells, vi.totalBought, vi.totalSold, vi.averageInIndex].every(isNum)) {
    sentences.push(`The volatility-based plan made ${bold(vi.trades)} trades (${bold(vi.buys)} buys, ${bold(vi.sells)} sells): it bought ${bold(inr(vi.totalBought))} and sold ${bold(inr(vi.totalSold))}, and on average ${bold(inr(vi.averageInIndex))} of the pool was in the index.`);
  }
  if (isNum(sip.sharpe) && isNum(vol.sharpe)) {
    sentences.push(`Sharpe ratio ${bold(fx2(sip.sharpe))} for the monthly plan and ${bold(fx2(vol.sharpe))} for the volatility-based plan.`);
  }
  if (isNum(sip.maxDrawdown) && isNum(vol.maxDrawdown)) {
    sentences.push(`Biggest fall from a high ${bold(pct(sip.maxDrawdown))} and ${bold(pct(vol.maxDrawdown))}.`);
  }
  return [...sentences, ...cashLine].join(' ') + notesHtml(r.notes);
}

function sharpeSub(p) {
  const q = p.sharpeParts ?? {};
  if (!isNum(q.meanDaily) || !isNum(q.sdDaily) || !isNum(q.rfd)) return '';
  return sub(`${pct(q.meanDaily, 4)} mean, ${pct(q.sdDaily, 4)} sd, risk-free ${pct(q.rfd * 252, 2)} a year`);
}

function kpiTable(r) {
  const { sip, vol, period, series } = r;
  const si = sip.investments ?? {};
  const vi = vol.investments ?? {};
  const sc = sip.components;
  const vc = vol.components;
  const noCash = !(r.params?.cashRate > 0);
  const sipIn = seriesVals(series, 'sipInIndex');
  const sipMean = meanOf(sipIn);
  const sipMax = sipIn.length ? Math.max(...sipIn) : undefined;
  const sipMin = sipIn.length ? Math.min(...sipIn) : undefined;
  const both = (a, b) => isNum(a) && isNum(b);
  const dMoney = (a, b) => (both(a, b) ? signedInr(b - a) : '-');
  const dPts = (a, b) => (both(a, b) ? signedPts(b - a) : '-');
  const dNum = (a, b, d = 2, unit = '') => (both(a, b) ? signedNum(b - a, d, unit) : '-');
  const row = (label, a, c, d) => `<tr><td>${label}</td><td>${a}</td><td>${c}</td><td>${d}</td></tr>`;
  const sec = (t) => `<tr class="sec"><td colspan="4">${t}</td></tr>`;
  const spanRow = (label, v) => `<tr><td>${label}</td><td colspan="3" style="text-align:left">${v}</td></tr>`;
  const trow = (label, a, c, f, d = '-') => row(label, shownOr(a, f), shownOr(c, f), d);
  const erow = (label, a, c, f, d) => (a === undefined && c === undefined ? '' : trow(label, a, c, f, d));
  const sharpeCell = (p) => (isNum(p.sharpe) ? fx2(p.sharpe) + sharpeSub(p) : '-');
  const es = sip.drawdownEpisodes?.[0];
  const ev = vol.drawdownEpisodes?.[0];
  const recovered = (e) => (e ? (e.endDate === undefined ? undefined : e.endDate ?? 'not recovered') : undefined);
  const recDays = (e) => (e ? e.tradingDaysToRecover : undefined);
  const origin = sc && vc
    ? sec('Where the profit came from')
      + trow('Gain or loss on the index', sc.indexGain, vc.indexGain, signedInr, dMoney(sc.indexGain, vc.indexGain))
      + (noCash ? '' : trow('Interest on idle cash', sc.interest, vc.interest, signedInr, dMoney(sc.interest, vc.interest)))
      + trow('Trading costs', sc.costs, vc.costs, (x) => `-${inr(x)}`, both(sc.costs, vc.costs) ? signedInr(sc.costs - vc.costs) : '-')
    : '';
  return '<tr><th></th><th>Monthly SIP</th><th>Volatility-based</th><th>Difference</th></tr>'
    + sec('The index itself (same for both plans)')
    + spanRow('Index change over the period', pctOr(period.niftyChange))
    + spanRow('Index own biggest fall', Array.isArray(series) && series.length ? pct(ownMaxFall(series)) : '-')
    + sec('Results on the pool')
    + trow('Final value', sip.final, vol.final, inr, dMoney(sip.final, vol.final))
    + trow('Profit or loss', sip.profit, vol.profit, signedInr, dMoney(sip.profit, vol.profit))
    + trow('Return on the pool', sip.returnPct, vol.returnPct, pct, dPts(sip.returnPct, vol.returnPct))
    + trow('Annualised return (CAGR)', sip.cagr, vol.cagr, pct, dPts(sip.cagr, vol.cagr))
    + sec('Risk and return')
    + trow('Volatility of the pool (per year)', sip.annVol, vol.annVol, pct, dPts(sip.annVol, vol.annVol))
    + row('Sharpe ratio', sharpeCell(sip), sharpeCell(vol), dNum(sip.sharpe, vol.sharpe))
    + trow('Calmar ratio (CAGR / biggest fall)', sip.calmar, vol.calmar, fx2, dNum(sip.calmar, vol.calmar))
    + trow('Worst single day', sip.worstDay, vol.worstDay, (x) => pct(x, 2), dPts(sip.worstDay, vol.worstDay))
    + trow('Best single day', sip.bestDay, vol.bestDay, (x) => pct(x, 2), dPts(sip.bestDay, vol.bestDay))
    + sec('Drawdown (fall from the previous high)')
    + trow('Biggest fall', sip.maxDrawdown, vol.maxDrawdown, pct, dPts(sip.maxDrawdown, vol.maxDrawdown))
    + erow('Fall started', es?.peakDate, ev?.peakDate, esc)
    + erow('Lowest point', es?.troughDate, ev?.troughDate, esc)
    + erow('Recovered on', recovered(es), recovered(ev), esc)
    + erow('Trading days from high to low', es?.tradingDaysToTrough, ev?.tradingDaysToTrough, String, dNum(es?.tradingDaysToTrough, ev?.tradingDaysToTrough, 0, ' days'))
    + erow('Trading days to recover', recDays(es), recDays(ev), String, dNum(recDays(es), recDays(ev), 0, ' days'))
    + trow('Longest time below a previous high', sip.longestUnderwaterDays, vol.longestUnderwaterDays, (x) => `${x} trading days`, dNum(sip.longestUnderwaterDays, vol.longestUnderwaterDays, 0, ' days'))
    + sec('Investments')
    + row('Number of investments', `${shownOr(si.purchases, String)}${sub('monthly purchases')}`, `${shownOr(vi.trades, String)}${sub('month-end resets that changed the holding')}`, dNum(si.purchases, vi.trades, 0))
    + trow('Buys', si.purchases, vi.buys, String, dNum(si.purchases, vi.buys, 0))
    + trow('Sells', undefined, vi.sells, String)
    + trow('Total bought', si.totalPutIn, vi.totalBought, inr, dMoney(si.totalPutIn, vi.totalBought))
    + trow('Total sold', undefined, vi.totalSold, inr)
    + trow('Net money put into the index', si.totalPutIn, vi.netPutIn, inr, dMoney(si.totalPutIn, vi.netPutIn))
    + trow('Average price paid per index unit', si.averageBuyPrice, undefined, (x) => x.toFixed(2))
    + trow('Average money in the index', sipMean, vi.averageInIndex, inr, dMoney(sipMean, vi.averageInIndex))
    + trow('Most money in the index', sipMax, vi.peakInIndex, inr, dMoney(sipMax, vi.peakInIndex))
    + trow('Least money in the index', sipMin, vi.lowestInIndex, inr, dMoney(sipMin, vi.lowestInIndex))
    + trow('Average share of the pool in the index', sip.avgExposure, vol.avgExposure, (x) => pct(x, 0), dPts(sip.avgExposure, vol.avgExposure))
    + trow('Index holding at the end', si.finalIndexValue, vi.finalIndexValue, inr, dMoney(si.finalIndexValue, vi.finalIndexValue))
    + trow('Cash left at the end', si.cashLeft, vi.cashLeft, inr, dMoney(si.cashLeft, vi.cashLeft))
    + trow('Return on the money actually put in (per year)', si.moneyWeightedReturn, undefined, pct)
    + origin
    + sec('Costs')
    + trow('Trading costs paid', sip.costTotal, vol.costTotal, inr, dMoney(sip.costTotal, vol.costTotal));
}

function kpiNote(cashRate) {
  const table = $('kpis');
  const anchor = table.closest('.scroll-x') ?? table;
  let note = $('kpisNote');
  if (!note) {
    note = document.createElement('p');
    note.id = 'kpisNote';
    note.className = 'note';
    anchor.after(note);
  }
  const noCash = !(cashRate > 0);
  note.textContent = noCash
    ? 'Idle cash earns nothing here, so every figure comes from index prices, the rule and trading costs. You can set a rate in Settings.'
    : `Idle cash earns ${cashPct(cashRate)} a year. Set it to 0 in Settings to see the effect of the index alone.`;
}

const statCard = (label, value, note, accent) => `<div style="background:var(--card);border:1px solid var(--rule);border-top:3px solid ${accent};border-radius:12px;padding:12px"><div class="sub" style="display:block">${esc(label)}</div><div style="font-size:1.4em;font-weight:600;margin:4px 0">${value}</div>${note ? `<div class="sub" style="display:block">${esc(note)}</div>` : ''}</div>`;

function planCards(title, accent, items) {
  const body = items.filter(([, v]) => v !== null).map(([label, value, note]) => statCard(label, value, note, accent)).join('');
  if (!body) return '';
  return `<div style="margin-top:12px"><div style="margin-bottom:6px"><b>${esc(title)}</b></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">${body}</div></div>`;
}

function cardsHtml(r) {
  const { sip, vol } = r;
  const si = sip.investments ?? {};
  const vi = vol.investments ?? {};
  const sipIn = seriesVals(r.series, 'sipInIndex');
  const epS = sip.drawdownEpisodes?.[0];
  const epV = vol.drawdownEpisodes?.[0];
  const epNote = (e) => (e && e.peakDate && e.troughDate ? `${e.peakDate} to ${e.troughDate}` : '');
  const money = (x) => (isNum(x) ? inr(x) : null);
  const count = (x) => (isNum(x) ? String(x) : null);
  const sharpe = (p) => (isNum(p.sharpe) ? fx2(p.sharpe) : null);
  const fall = (p) => (isNum(p.maxDrawdown) ? pct(p.maxDrawdown) : null);
  const profit = (p) => (isNum(p.profit) ? `profit ${signedInr(p.profit)}` : '');
  const sipCards = planCards('Monthly SIP', 'var(--sip)', [
    ['Final value', money(sip.final), profit(sip)],
    ['Sharpe ratio', sharpe(sip), 'return per unit of risk'],
    ['Biggest fall', fall(sip), epNote(epS)],
    ['Money put in', money(si.totalPutIn), isNum(si.purchases) ? `${si.purchases} purchases` : ''],
    ['Investments made', count(si.purchases), isNum(si.perPurchase) ? `of ${inr(si.perPurchase)} each` : ''],
    ['Average in the index', money(meanOf(sipIn)), 'mean over the days'],
  ]);
  const volCards = planCards('Volatility-based', 'var(--vol)', [
    ['Final value', money(vol.final), profit(vol)],
    ['Sharpe ratio', sharpe(vol), 'return per unit of risk'],
    ['Biggest fall', fall(vol), epNote(epV)],
    ['Money put in', money(vi.netPutIn), isNum(vi.totalBought) && isNum(vi.totalSold) ? `bought ${inr(vi.totalBought)}, sold ${inr(vi.totalSold)}` : ''],
    ['Investments made', count(vi.trades), isNum(vi.buys) && isNum(vi.sells) ? `${vi.buys} buys, ${vi.sells} sells` : ''],
    ['Average in the index', money(vi.averageInIndex), ''],
  ]);
  return sipCards + volCards;
}

function renderCards(r) {
  const anchor = $('verdict').closest('.card') ?? $('verdict');
  const box = ensureAfter('cards', anchor);
  box.className = 'cards';
  box.innerHTML = cardsHtml(r);
}

function howHtml(r) {
  const p = r.params ?? {};
  const q = r.vol?.sharpeParts ?? {};
  const v = r.vol ?? {};
  const rfd = isNum(q.rfd) ? q.rfd : (isNum(p.cashRate) ? p.cashRate / 252 : undefined);
  const f = (t) => `<pre style="white-space:pre-wrap;font-family:ui-monospace,Consolas,monospace;margin:6px 0">${esc(t)}</pre>`;
  const para = (t) => `<p class="note" style="margin:8px 0">${esc(t)}</p>`;
  const win = isNum(p.window) ? p.window : '-';
  const minP = pctOr(p.minExposure, 0);
  const maxP = pctOr(p.maxExposure, 0);
  const costP = pctOr(p.cost, 2);
  const cashP = pctOr(p.cashRate, 1);
  const rfdP = pctOr(rfd, 4);
  const sipAmt = shownOr(p.sip, inr);
  const reset = p.rebalance === 'daily' ? 'every day' : 'at the last trading day of each month';
  const sharpeLine = isNum(v.sharpe) && isNum(q.meanDaily) && isNum(q.sdDaily) && isNum(rfd)
    ? `Sharpe = (${pct(q.meanDaily, 4)} - ${pct(rfd, 4)}) / ${pct(q.sdDaily, 4)} x ${Math.sqrt(252).toFixed(3)} = ${fx2(v.sharpe)}`
    : '';
  return [
    para('Each number on this page comes from the daily closes of the selected index and the settings in the sidebar.'),
    f(`daily return      r = close today / close yesterday - 1`),
    f(`volatility        v = mean of r squared over the last ${win} trading days`),
    f(`share in index    w = typical v so far / v, kept between ${minP} and ${maxP}`),
    isNum(r.c) ? para(`The constant c = ${r.c.toExponential(3)}: chosen so the volatility-based plan would be as volatile as the index over the whole period (the paper's rule).`) : '',
    r.c === null ? para('The constant is the running average of variance (no hindsight).') : '',
    para(`The typical v so far is the average of v from the first full window to today. The volatility-based plan resets its share ${reset}. Each trade pays ${costP} of its rupee value. Idle cash earns ${cashP} a year.`),
    para(`The monthly SIP buys ${sipAmt} on the first trading day of each month, from the cash in the pool.`),
    f(`Sharpe ratio     (mean daily return - daily risk-free rate) / sd of daily returns x square root of 252`),
    f(`daily risk-free  cash rate / 252 = ${rfdP}`),
    f(`drawdown         value / highest value so far - 1`),
    f(`Calmar ratio     annualised return (CAGR) / biggest fall`),
    f(`CAGR             (final / pool) ^ (1 / years) - 1, years = calendar days / 365.25`),
    sharpeLine ? para('Worked line for the volatility-based plan, from its daily return statistics:') + f(sharpeLine) : '',
  ].join('');
}

function ddHtml(r) {
  const rows = [['Monthly SIP', r.sip], ['Volatility-based', r.vol]].flatMap(([label, p]) => (Array.isArray(p?.drawdownEpisodes) ? p.drawdownEpisodes.slice(0, 3) : [])
    .map((e) => `<tr><td>${label}</td><td>${txt(e.peakDate)}</td><td>${txt(e.troughDate)}</td><td>${e.endDate ? txt(e.endDate) : 'not yet'}</td><td>${shownOr(e.depth, (x) => pct(x, 1))}</td><td>${shownOr(e.tradingDaysToTrough, String)}</td><td>${shownOr(e.tradingDaysToRecover, String)}</td></tr>`));
  const head = ['Plan', 'Fall started', 'Lowest point', 'Recovered', 'Depth', 'Days down to the low', 'Days to recover'];
  return rows.length
    ? `<div style="max-height:320px;overflow:auto"><table class="cmp"><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.join('')}</table></div>`
    : '<p class="note">No falls to show.</p>';
}

function listTable(title, list, head, rowFn) {
  if (!Array.isArray(list)) return '';
  const body = list.length
    ? `<div style="max-height:320px;overflow:auto"><table class="cmp"><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${list.slice(0, LIST_CAP).map(rowFn).join('')}</table></div>${list.length > LIST_CAP ? `<p class="note">First ${LIST_CAP} of ${list.length} shown; the CSV has all.</p>` : ''}`
    : '<p class="note">None.</p>';
  return `<p class="note" style="margin-top:12px"><b>${esc(title)}</b> (${list.length})</p>${body}`;
}

function tradesHtml(r) {
  return listTable('Monthly SIP purchases', r.sip?.purchaseList, ['Date', 'Amount', 'Index price', 'Units'],
    (x) => `<tr><td>${txt(x.date)}</td><td>${shownOr(x.amount, inr)}</td><td>${shownOr(x.price, fx2)}</td><td>${shownOr(x.units, (u) => u.toFixed(4))}</td></tr>`)
    + listTable('Volatility-based trades', r.vol?.tradeList, ['Date', 'Buy or sell', 'Amount', 'Index price', 'Share of the pool in the index after the trade'],
      (x) => `<tr><td>${txt(x.date)}</td><td>${txt(x.side)}</td><td>${shownOr(x.amount, inr)}</td><td>${shownOr(x.price, fx2)}</td><td>${shownOr(x.shareAfter, (s) => pct(s, 1))}</td></tr>`);
}

function renderExtras(r) {
  const chartCard = $('chart').closest('.card') ?? $('chart');
  const how = ensureAfter('howDetails', chartCard, 'details');
  how.className = 'more';
  how.innerHTML = `<summary>How each number is calculated</summary>${howHtml(r)}`;
  const dd = ensureAfter('ddDetails', how, 'details');
  dd.className = 'more';
  dd.innerHTML = `<summary>The three biggest falls</summary>${ddHtml(r)}`;
  const trades = ensureAfter('tradesDetails', dd, 'details');
  trades.className = 'more';
  trades.innerHTML = `<summary>Every investment, with dates and amounts</summary>${tradesHtml(r)}`;
  const diff = ensureAfter('paperDiff', trades, 'details');
  diff.id = 'paperDiff';
  diff.className = 'more';
  diff.innerHTML = `<summary>How this differs from the paper</summary>${paperDiffHtml(r)}`;
}

function paperDiffHtml(r) {
  const yr = (s) => (typeof s === 'string' && /^\d{4}/.test(s) ? esc(s.slice(0, 4)) : null);
  const from = yr(r.period?.from);
  const to = yr(r.period?.to);
  const ym = (s) => (typeof s === 'string' && /^\d{4}-\d{2}/.test(s) ? [Number(s.slice(0, 4)), Number(s.slice(5, 7))] : null);
  const start = ym(r.period?.from);
  const end = ym(r.period?.to);
  const months = start && end ? (end[0] * 12 + end[1]) - (start[0] * 12 + start[1]) + 1 : null;
  const range = from && to ? `, ${from} to ${to}` : '';
  const obs = months !== null ? `, about ${months} monthly observations` : '';
  const win = isNum(r.params?.window) ? `the last ${r.params.window} trading days` : 'the last trading days';
  const items = [
    `<b>Data.</b> The paper uses US factor returns from 1926 to 2015, 1,065 monthly observations (Table I). This page uses Nifty 50 and Bank Nifty price indices without dividends${range}${obs}. Power is much lower, and the paper's gains come from a few very volatile periods.`,
    `<b>Returns.</b> The paper scales excess returns, return minus the risk-free rate. This page uses raw price returns unless you enter a rate in Settings, because no Indian risk-free series is bundled.`,
    `<b>Leverage.</b> The paper's main strategy uses weights up to about 6.4 (99th percentile, Table V). A rupee pool cannot borrow, so this plan holds at most 100% of the pool in the index. That is the paper's No Leverage variant, whose alpha is 2.12% against 4.86% for the unconstrained rule (Table IV, page 45).`,
    `<b>The constant c.</b> With the setting 'Set over the whole period' c makes the managed series as volatile as the index over the whole period, as in the paper (footnote 6). That uses hindsight, so the result is a back-test of the rule, not something that could have been run live. 'Running average of variance' avoids hindsight but is not the paper's rule.`,
    `<b>Timing.</b> As in the paper, the share held in a month is set from volatility measured up to the last trading day of the previous month, with no look-ahead. Here volatility is ${win} of squared returns; the paper uses the month's daily returns with the mean removed.`,
    `<b>The monthly SIP is not in the paper.</b> It buys a fixed amount each month from the same pool, so it starts almost entirely in cash. Comparing it with the volatility plan mixes how much was invested with when. The block 'Is the volatility signal doing anything?' removes that by using a constant share with the same average.`,
    `<b>Statistics.</b> The Statistics tab follows the paper's monthly regression (equations 1 to 4). Its t-statistics are heteroskedasticity-robust (HC1), as in the paper's tables.`,
  ];
  return `<ul class="note">${items.map((t) => `<li style="margin:8px 0">${t}</li>`).join('')}</ul>`;
}

function controlHtml(r) {
  const { vol, control, timingEffect: t } = r;
  if (!vol || !control || !t) return '';
  const both = (a, b) => isNum(a) && isNum(b);
  const dIn = (a, b) => (both(a, b) ? signedInr(a - b) : '-');
  const dNum = (a, b, d = 2) => (both(a, b) ? signedNum(a - b, d) : '-');
  const dPts = (a, b) => (both(a, b) ? signedPts(a - b) : '-');
  const vi = vol.investments ?? {};
  const ci = control.investments ?? {};
  const row = (label, a, c, d) => `<tr><td>${label}</td><td>${a}</td><td>${c}</td><td>${d}</td></tr>`;
  const trow = (label, a, c, f, d) => row(label, shownOr(a, f), shownOr(c, f), d);
  const ctlHead = isNum(control.share) ? `Constant share ${pct(control.share, 0)}` : 'Constant share';
  const head = ['', 'Volatility-based', ctlHead, 'Difference'];
  const table = `<div class="scroll-x"><table class="cmp"><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>`
    + trow('Final value', vol.final, control.final, inr, dIn(vol.final, control.final))
    + trow('Profit or loss', vol.profit, control.profit, signedInr, dIn(vol.profit, control.profit))
    + trow('Sharpe ratio', vol.sharpe, control.sharpe, fx2, dNum(vol.sharpe, control.sharpe))
    + trow('Biggest fall', vol.maxDrawdown, control.maxDrawdown, pct, dPts(vol.maxDrawdown, control.maxDrawdown))
    + trow('Calmar ratio', vol.calmar, control.calmar, fx2, dNum(vol.calmar, control.calmar))
    + trow('Number of trades', vi.trades, ci.trades, String, dNum(vi.trades, ci.trades, 0))
    + trow('Trading costs paid', vol.costTotal, control.costTotal, inr, dIn(vol.costTotal, control.costTotal))
    + trow('Average share in the index', vi.averageShare, ci.averageShare, (x) => pct(x, 1), dPts(vi.averageShare, ci.averageShare))
    + '</table></div>';
  const sentence = isNum(control.share) && isNum(t.finalDiff) && isNum(t.sharpeDiff) && isNum(t.maxDrawdownDiff)
    ? `A plan that simply held ${bold(pct(control.share, 0))} of the pool in the index at every month end ended ${bold(inr(Math.abs(t.finalDiff)))} ${t.finalDiff >= 0 ? 'lower' : 'higher'} than the volatility-based plan; its biggest fall was ${bold((Math.abs(t.maxDrawdownDiff) * 100).toFixed(1))} points ${t.maxDrawdownDiff > 0 ? 'deeper' : 'shallower'} and its Sharpe ratio ${t.sharpeDiff >= 0 ? 'lower' : 'higher'} by ${bold(Math.abs(t.sharpeDiff).toFixed(3))}.`
    : '';
  return '<h3>Is the volatility signal doing anything?</h3>'
    + '<p class="note">Does changing the share with volatility do better than holding a constant share with the same average?</p>'
    + table
    + (sentence ? `<p style="margin-top:12px">${sentence}</p>` : '')
    + '<p class="note">The constant-share plan has the same average exposure, so any difference comes from when the volatility plan held more or less, not from how much it held.</p>';
}

function renderControl(r) {
  const html = controlHtml(r);
  const box = ensureAfter('controlCard', $('cards'));
  if (!box) return;
  box.className = 'card';
  box.style.marginTop = '16px';
  box.hidden = !html;
  box.innerHTML = html;
}

function renderLive(data) {
  const { result: r, name } = data;
  $('verdict').innerHTML = liveVerdict(r);
  renderCards(r);
  renderControl(r);
  $('kpis').innerHTML = kpiTable(r);
  kpiNote(r.params.cashRate);
  const hasCtl = Array.isArray(r.series) && r.series.some((d) => isNum(d?.ctlValue));
  liveChart($('chart'), r.series, { baseline: r.params.pool, panels: hasCtl ? CTL_PANELS : SIP_VOL_PANELS, tooltip: (d) => sipVolTooltip(d, name) });
  renderExtras(r);
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
    + crow('Annualised return (CAGR)', vf(n.vol, 'cagr', pct), vf(b.vol, 'cagr', pct))
    + crow('Calmar ratio', vf(n.vol, 'calmar', fx2), vf(b.vol, 'calmar', fx2))
    + crow('Number of trades', vf(n.vol.investments, 'trades', String), vf(b.vol.investments, 'trades', String))
    + crow('Total bought', vf(n.vol.investments, 'totalBought', inr), vf(b.vol.investments, 'totalBought', inr))
    + crow('Total sold', vf(n.vol.investments, 'totalSold', inr), vf(b.vol.investments, 'totalSold', inr))
    + csec('Monthly SIP on the pool')
    + crow('Final value', inr(n.sip.final), inr(b.sip.final))
    + crow('Return on the pool', pct(n.sip.returnPct), pct(b.sip.returnPct))
    + crow('Biggest fall from a high', pct(n.sip.maxDrawdown), pct(b.sip.maxDrawdown))
    + crow('Return on money actually put in (per year)', pct(n.sip.moneyWeightedReturn), pct(b.sip.moneyWeightedReturn))
    + crow('Sharpe ratio', vf(n.sip, 'sharpe', fx2), vf(b.sip, 'sharpe', fx2))
    + crow('Number of purchases', vf(n.sip.investments, 'purchases', String), vf(b.sip.investments, 'purchases', String))
    + crow('Total put in', vf(n.sip.investments, 'totalPutIn', inr), vf(b.sip.investments, 'totalPutIn', inr));
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
  const variantBody = cols.map((c) => {
    const vs = st(c).variants;
    if (!Array.isArray(vs) || !vs.length) return '';
    const vrows = vs.map((v) => `<tr><td>${txt(v?.label)}</td><td>${pctOr(v?.alphaAnnual, 2)}</td><td>${numOr(v?.tAlphaRobust, 2)}</td><td>${numOr(v?.appraisalAnnual, 2)}</td><td>${numOr(v?.sharpeManaged, 2)}</td><td>${numOr(v?.avgAbsWeightChange, 2)}</td><td>${numOr(v?.breakEvenBp, 0)}</td><td>${seqOr([v?.weights?.p50, v?.weights?.p99], (x) => x.toFixed(2))}</td></tr>`).join('');
    return `<p class="note"><b>${esc(c.label)}</b></p><div class="scroll-x"><table class="cmp"><tr><th>Strategy</th><th>Alpha</th><th>t (robust)</th><th>Appraisal ratio</th><th>Sharpe (managed)</th><th>Average |change in weight|</th><th>Break-even (bp)</th><th>Weights P50 / P99</th></tr>${vrows}</table></div>`;
  }).join('');
  const variantsCard = variantBody
    ? card('Paper Tables IV and V: other ways to scale', 'Each row scales exposure a different way. Each has its own managed series, with c matched to the unmanaged standard deviation; the cap does not re-solve c.', variantBody)
    : '';
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
    variantsCard,
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

function downloadTrades() {
  const data = state.data.live;
  if (!data) { setStatus('Nothing to download yet.', true); return; }
  const r = data.result;
  const list = (x) => (Array.isArray(x) ? x : []);
  const rows = [
    ...list(r.sip?.purchaseList).map((p) => ['monthly-sip', p.date, 'buy', p.amount, p.price, p.fee, p.units]),
    ...list(r.vol?.tradeList).map((t) => ['volatility-based', t.date, t.side, t.amount, t.price, t.fee, t.units]),
  ];
  if (!rows.length) { setStatus('No investments to download.', true); return; }
  const text = ['plan,date,side,amount,price,fee,units', ...rows.map((row) => row.map((v) => v ?? '').join(','))].join('\n') + '\n';
  download(`volatility-lab-${data.key}-investments-${r.period.from.slice(0, 4)}-to-${r.period.to.slice(0, 4)}.csv`, text, 'text/csv');
}

async function loadSweep() {
  let mod;
  try {
    mod = await import('./sweep.js');
  } catch {
    mod = null;
  }
  if (!mod || typeof mod.renderSweep !== 'function') return { mod: null };
  const rows = parseCsv(await csvFor(state.index));
  return {
    mod,
    rows,
    index: state.index,
    opts: {
      window: Number($('window').value),
      cap: Number($('maxExp').value) / 100,
      cost: Number($('cost').value) / 100,
      cashRate: Number($('cash').value) / 100,
      scaling: $('scaling').value,
      startDate: '2019-01-02',
    },
  };
}

function renderSweepTab(data) {
  const root = $('sweepRoot');
  if (!data.mod) {
    root.textContent = 'The sweep module is not available yet.';
    return;
  }
  data.mod.renderSweep(root, data.rows, data.opts);
}

const LOADERS = { live: loadLive, compare: loadCompare, stats: loadStats, sweep: loadSweep };
const RENDERERS = { live: renderLive, compare: renderCompare, stats: renderStats, sweep: renderSweepTab };
const SUMMARIES = {
  live: (d) => `Done: ${d.result.series.length} trading days${state.overrides[d.index] ? ` from ${state.overrides[d.index].name}` : ''}.`,
  compare: (d) => `Done: ${d.merged.length} common trading days.`,
  stats: (d) => `Done: statistics for ${d.length} series.`,
  sweep: (d) => (d.mod ? `Done: parameter sweep for ${NAMES[d.index] ?? d.index}.` : 'The sweep module is not available yet.'),
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
  const dl = $('download');
  dl.addEventListener('click', downloadLive);
  let dt = $('downloadTrades');
  if (!dt) {
    dt = document.createElement('button');
    dt.id = 'downloadTrades';
    dt.type = 'button';
    dt.className = dl.className;
    dt.textContent = 'Download every investment (CSV)';
    dl.after(dt);
  }
  dt.addEventListener('click', downloadTrades);
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
