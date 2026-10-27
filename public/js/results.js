import { inr, lakh, pct, liveChart as drawChart, barChart, auditCharts } from './chart.js';

function liveChart(root, rows, opts) {
  drawChart(root, rows, opts);
  let note = root.nextElementSibling?.classList.contains('audit') ? root.nextElementSibling : null;
  if (!note) {
    note = document.createElement('p');
    note.className = 'audit note';
    root.after(note);
  }
  note.textContent = 'Chart audit running...';
  (document.fonts?.ready ?? Promise.resolve()).then(() => audit(root, note));
}

function audit(root, note) {
  const { checks, fails } = auditCharts(root);
  note.textContent = fails.length
    ? `Chart audit: ${fails.length} of ${checks} checks failed. ${fails.slice(0, 3).join(' | ')}`
    : `Chart audit: ${checks} of ${checks} checks passed (every point matches its value and date, labels do not overlap).`;
}

const FILES = { nifty50: 'data/nifty50.csv', banknifty: 'data/banknifty.csv' };
const NAMES = { nifty50: 'Nifty 50', banknifty: 'Bank Nifty' };
const TABS = ['live', 'compare', 'stats', 'data'];
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const LIST_CAP = 400;
const LIVE_KEYS = ['dcaEquity', 'vmEquity', 'dcaDd', 'vmDd', 'priorMonthVol', 'dcaShare', 'vmShare', 'vmTarget'];
const CMP_KEYS = ['nPrice', 'bPrice', 'nDca', 'bDca', 'nVm', 'bVm', 'nVmDd', 'bVmDd', 'nDcaDd', 'bDcaDd', 'nVmTarget', 'bVmTarget', 'put'];
const SETTING_IDS = ['monthly', 'maxExp', 'costBps', 'from', 'to'];
const PAIR = (nk, bk) => [{ key: nk, color: 'var(--nifty)', label: 'Nifty 50' }, { key: bk, color: 'var(--bank)', label: 'Bank Nifty' }];
const PUT = { key: 'put', color: 'var(--muted)', label: 'Money put in', dash: true };
const pctAxis =(v) => `${(v * 100).toFixed(0)}%`;
const CMP_PANELS = [
  { id: 'value', title: 'Volatility-managed portfolio value', height: 250, lines: [...PAIR('nVm', 'bVm'), PUT], axisFmt: (v) => lakh(v).replace(' ', ''), markers: 'end', markFmt: inr },
  { id: 'dca', title: 'Monthly DCA portfolio value', height: 220, lines: [...PAIR('nDca', 'bDca'), PUT], axisFmt: (v) => lakh(v).replace(' ', ''), markers: 'end', markFmt: inr },
  { id: 'ddDca', title: 'Drawdown over time: monthly DCA (fall from the previous high of the NAV)', height: 170, lines: PAIR('nDcaDd', 'bDcaDd'), axisFmt: pctAxis, fixed: [-0.5, 0], markers: 'min', markFmt: (v) => pct(v, 2) },
  { id: 'dd', title: 'Drawdown over time: volatility-managed (fall from the previous high of the NAV)', height: 170, lines: PAIR('nVmDd', 'bVmDd'), axisFmt: pctAxis, fixed: [-0.5, 0], markers: 'min', markFmt: (v) => pct(v, 2) },
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

const state = { index: 'nifty50', tab: 'live', token: 0, overrides: {}, data: {}, dataView: { page: 0, from: '', to: '', file: null } };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const shownOr = (v, f) => (v === undefined || v === null || v === '' || (typeof v === 'number' && !Number.isFinite(v)) ? '-' : f(v));
const inrOr = (x) => shownOr(x, inr);
const pctOr = (x, d = 2) => shownOr(x, (v) => pct(v, d));
const fx2 = (x) => x.toFixed(2);
const numOr = (x, d, suffix = '') => (isNum(x) ? `${x.toFixed(d)}${suffix}` : '-');
const seqOr = (xs, f) => (xs.every(isNum) ? xs.map(f).join(' / ') : '-');
const txt = (s) => (typeof s === 'string' && s ? esc(s) : '-');
const bold = (t) => `<b>${esc(t)}</b>`;
const signedInr = (x) => `${x < 0 ? '-' : '+'}${inr(Math.abs(x))}`;
const signedPts = (x, d = 1) => `${x < 0 ? '-' : '+'}${Math.abs(x * 100).toFixed(d)} pts`;
const signedNum = (x, d = 2, unit = '') => `${x < 0 ? '-' : '+'}${Math.abs(x).toFixed(d)}${unit}`;
const pFmt = (p) => (p < 0.001 ? '< 0.001' : p.toFixed(3));
const fmtSlope = (x) => (Math.abs(x) < 0.01 ? x.toExponential(2) : x.toFixed(3));
const setStatus = (msg, isErr = false) => { const s = $('status'); s.textContent = msg; s.classList.toggle('err', isErr); };
const notesHtml = (notes) => (Array.isArray(notes) && notes.length ? `<span class="note" style="display:block;margin-top:10px">${notes.map((n) => esc(n)).join(' ')}</span>` : '');
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

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
  const monthly = Number($('monthly').value);
  const cap = Number($('maxExp').value);
  const costBps = Number($('costBps').value);
  if (!(monthly > 0)) throw new Error('Monthly amount must be a positive number.');
  if (!(cap >= 1 && cap <= 100)) throw new Error('Most in index must be between 1 and 100.');
  if (!(costBps >= 0 && costBps <= 100)) throw new Error('Cost per trade must be between 0 and 100 bp.');
  const body = { monthly, maxExposure: cap / 100, costBps };
  if ($('from').value) body.start = $('from').value;
  if ($('to').value) body.end = $('to').value;
  return body;
}

function correlation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = xs.slice(0, n).reduce((s, x) => s + x, 0) / n;
  const my = ys.slice(0, n).reduce((s, y) => s + y, 0) / n;
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

const priceReturns = (rows, key) => rows.slice(1).map((d, i) => d[key] / rows[i][key] - 1);

function ownMaxFall(rows) {
  let peak = -Infinity;
  let worst = 0;
  let n = 0;
  for (const d of Array.isArray(rows) ? rows : []) {
    if (!isNum(d?.price)) continue;
    n++;
    peak = Math.max(peak, d.price);
    worst = Math.min(worst, d.price / peak - 1);
  }
  return n ? worst : null;
}

function chartRows(series, keys) {
  return (Array.isArray(series) ? series : []).filter((d) => keys.every((k) => isNum(d?.[k])));
}

function planDailyReturns(series, eqKey) {
  const rows = Array.isArray(series) ? series : [];
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]?.[eqKey];
    const b = rows[i]?.[eqKey];
    const c = rows[i]?.contribution;
    if (!isNum(a) || !isNum(b) || !isNum(c) || a <= 0) return null;
    out.push((b - c) / a - 1);
  }
  return out.length ? out : null;
}

function meanSd(xs) {
  if (!xs || xs.length < 2) return null;
  const n = xs.length;
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
  return { mean, sd };
}

const deepest = (p) => {
  const eps = Array.isArray(p?.drawdownEpisodes) ? p.drawdownEpisodes.filter((e) => e && isNum(e.depth)) : [];
  return eps.length ? eps.reduce((a, b) => (b.depth < a.depth ? b : a)) : null;
};

function mergeSeries(sa, sb) {
  if (!Array.isArray(sa) || !Array.isArray(sb)) return [];
  const byDate = new Map(sb.map((d) => [d.date, d]));
  let put = 0;
  return sa.filter((d) => byDate.has(d.date)).map((x) => {
    const y = byDate.get(x.date);
    put += x.contribution || 0;
    return {
      date: x.date,
      put,
      nPrice: x.price, bPrice: y.price,
      nDca: x.dcaEquity, bDca: y.dcaEquity,
      nVm: x.vmEquity, bVm: y.vmEquity,
      nVmDd: x.vmDd, bVmDd: y.vmDd,
      nDcaDd: x.dcaDd, bDcaDd: y.dcaDd,
      nVmTarget: x.vmTarget, bVmTarget: y.vmTarget,
    };
  });
}

const csvCell = (v) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function toCsv(rows, cols) {
  const head = cols.join(',');
  const body = rows.map((row) => cols.map((c) => csvCell(row[c])).join(','));
  return [head, ...body].join('\n') + '\n';
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
  const csv = o ? o.text : await fetchText(FILES[index]);
  const result = await cachedPost('api/dcavm', { csv, ...settings() });
  return { index, name: o ? o.name : NAMES[index], result };
}

function liveVerdict(r, name) {
  const dca = r.dca ?? {};
  const vm = r.vm ?? {};
  const di = dca.investments ?? {};
  const vi = vm.investments ?? {};
  const monthly = r.params?.monthly;
  const s = [];
  if (isNum(dca.endingEquity) && isNum(vm.endingEquity)) {
    const gap = vm.endingEquity - dca.endingEquity;
    const amount = isNum(monthly) ? `${bold(inr(monthly))} a month` : 'the same monthly amount';
    const put = isNum(dca.totalContributions) ? `, ${bold(inr(dca.totalContributions))} in all` : '';
    s.push(`On ${bold(name)}, from ${txt(r.period?.from)} to ${txt(r.period?.to)}, ${amount} went into each plan${put}. The monthly DCA ended at ${bold(inr(dca.endingEquity))}; the volatility-managed plan ended at ${bold(inr(vm.endingEquity))}, ${bold(inr(Math.abs(gap)))} ${gap >= 0 ? 'higher' : 'lower'}.`);
  }
  if (isNum(di.purchases) && isNum(vi.trades) && isNum(vi.buys) && isNum(vi.sells)) {
    s.push(`The monthly DCA made ${bold(di.purchases)} purchases; the volatility-managed plan made ${bold(vi.trades)} trades (${bold(vi.buys)} buys, ${bold(vi.sells)} sells).`);
  }
  const series = Array.isArray(r.series) ? r.series : [];
  const decisions = series.filter((d) => isNum(d?.contribution) && d.contribution > 0);
  if (decisions.length && decisions.every((d) => isNum(d.vmTarget))) {
    const below = decisions.filter((d) => d.vmTarget < 1 - 1e-9).length;
    const avg = isNum(vi.averageTargetExposure) ? `; the average target was ${bold(pct(vi.averageTargetExposure, 1))}` : '';
    s.push(`The volatility target was below 100% in ${bold(below)} of ${bold(decisions.length)} monthly decisions, so part of that plan's money sat in cash that earns nothing${avg}. The target is 0 in the first two months, which have no earlier estimate.`);
  }
  if (isNum(dca.sharpe) && isNum(vm.sharpe)) {
    s.push(`Sharpe (risk-free=0) ${bold(fx2(dca.sharpe))} for the monthly DCA and ${bold(fx2(vm.sharpe))} for the volatility-managed plan. Biggest fall from a high ${bold(pctOr(dca.maxDrawdown))} and ${bold(pctOr(vm.maxDrawdown))}.`);
  }
  return s.join(' ') + notesHtml(r.notes);
}

function kpiTable(r) {
  const dca = r.dca ?? {};
  const vm = r.vm ?? {};
  const di = dca.investments ?? {};
  const vi = vm.investments ?? {};
  const series = r.series;
  const both = (a, b) => isNum(a) && isNum(b);
  const dMoney = (a, b) => (both(a, b) ? signedInr(b - a) : '-');
  const dPts = (a, b) => (both(a, b) ? signedPts(b - a, 2) : '-');
  const dNum = (a, b, d = 2, unit = '') => (both(a, b) ? signedNum(b - a, d, unit) : '-');
  const row = (label, a, b, diff) => `<tr><td>${esc(label)}</td><td>${a}</td><td>${b}</td><td>${diff}</td></tr>`;
  const sec = (t) => `<tr class="sec"><td colspan="4">${esc(t)}</td></tr>`;
  const trow = (label, a, b, f, diff = '-') => row(label, shownOr(a, f), shownOr(b, f), diff);
  const sub = (t) => `<span class="sub">${esc(t)}</span>`;
  const ms = (p, eq) => meanSd(planDailyReturns(series, eq));
  const sharpeCell = (p, eq) => {
    if (!isNum(p.sharpe)) return '-';
    const q = ms(p, eq);
    return fx2(p.sharpe) + (q ? sub(`${pct(q.mean, 3)} mean daily return, ${pct(q.sd, 2)} daily sd`) : '');
  };
  const es = deepest(dca);
  const ev = deepest(vm);
  const endOf = (e) => (e ? (e.endDate ?? 'not recovered') : undefined);
  return '<tr><th></th><th>Monthly DCA</th><th>Volatility-managed</th><th>Difference (VM minus DCA)</th></tr>'
    + sec('Results')
    + trow('Ending equity (INR)', dca.endingEquity, vm.endingEquity, inr, dMoney(dca.endingEquity, vm.endingEquity))
    + trow('Total contributions (INR)', dca.totalContributions, vm.totalContributions, inr, dMoney(dca.totalContributions, vm.totalContributions))
    + trow('Profit vs contributions (INR)', dca.profit, vm.profit, signedInr, dMoney(dca.profit, vm.profit))
    + trow('TWR cumulative return', dca.twrCumulative, vm.twrCumulative, (x) => pct(x, 2), dPts(dca.twrCumulative, vm.twrCumulative))
    + trow('TWR CAGR', dca.twrCagr, vm.twrCagr, (x) => pct(x, 2), dPts(dca.twrCagr, vm.twrCagr))
    + sec('Risk and return')
    + trow('Annualized volatility', dca.annVol, vm.annVol, (x) => pct(x, 2), dPts(dca.annVol, vm.annVol))
    + row('Sharpe (risk-free=0)', sharpeCell(dca, 'dcaEquity'), sharpeCell(vm, 'vmEquity'), dNum(dca.sharpe, vm.sharpe))
    + trow('Calmar ratio (CAGR / maximum drawdown)', dca.calmar, vm.calmar, fx2, dNum(dca.calmar, vm.calmar))
    + trow('Worst day', dca.worstDay, vm.worstDay, (x) => pct(x, 2), dPts(dca.worstDay, vm.worstDay))
    + trow('Best day', dca.bestDay, vm.bestDay, (x) => pct(x, 2), dPts(dca.bestDay, vm.bestDay))
    + sec('Drawdown (fall of the unitized NAV from its previous high)')
    + trow('Maximum drawdown', dca.maxDrawdown, vm.maxDrawdown, (x) => pct(x, 2), dPts(dca.maxDrawdown, vm.maxDrawdown))
    + trow('Fall started', es?.peakDate, ev?.peakDate, txt)
    + trow('Lowest point', es?.troughDate, ev?.troughDate, txt)
    + trow('Recovered on', endOf(es), endOf(ev), txt)
    + trow('Trading days from high to low', es?.tradingDaysToTrough, ev?.tradingDaysToTrough, String, dNum(es?.tradingDaysToTrough, ev?.tradingDaysToTrough, 0, ' days'))
    + trow('Trading days to recover', es?.tradingDaysToRecover, ev?.tradingDaysToRecover, String, dNum(es?.tradingDaysToRecover, ev?.tradingDaysToRecover, 0, ' days'))
    + trow('Longest time below a previous high', dca.longestUnderwaterDays, vm.longestUnderwaterDays, (x) => `${x} trading days`, dNum(dca.longestUnderwaterDays, vm.longestUnderwaterDays, 0, ' days'))
    + sec('Investments')
    + trow('Contributions received', di.purchases, vi.contributions, String, dNum(di.purchases, vi.contributions, 0))
    + trow('Amount per monthly purchase (INR)', di.perPurchase, undefined, inr)
    + trow('Total put in (INR)', di.totalContributions, vi.totalContributions, inr, dMoney(di.totalContributions, vi.totalContributions))
    + trow('Total bought (INR)', di.totalBought, vi.totalBought, inr, dMoney(di.totalBought, vi.totalBought))
    + trow('Average index price paid', di.averageBuyPrice, undefined, (x) => x.toFixed(2))
    + trow('Rebalances (VM decisions)', undefined, vi.rebalances, String)
    + trow('Trades (VM, where the holding changed)', undefined, vi.trades, String)
    + trow('Buys', undefined, vi.buys, String)
    + trow('Sells', undefined, vi.sells, String)
    + trow('Total sold (INR)', undefined, vi.totalSold, inr)
    + trow('Turnover, bought plus sold (INR)', undefined, vi.turnover, inr)
    + trow('Fees on investments (INR)', di.fees, vi.fees, inr, dMoney(di.fees, vi.fees))
    + trow('Average target exposure', undefined, vi.averageTargetExposure, (x) => pct(x, 1))
    + trow('Average share of the money in the index', dca.avgExposure, vm.avgExposure, (x) => pct(x, 1), dPts(dca.avgExposure, vm.avgExposure))
    + trow('Average money in the index (INR)', undefined, vi.averageInIndex, inr)
    + trow('Most money in the index (INR)', undefined, vi.peakInIndex, inr)
    + trow('Least money in the index (INR)', undefined, vi.lowestInIndex, inr)
    + trow('Index holding at the end (INR)', di.finalIndexValue, vi.finalIndexValue, inr, dMoney(di.finalIndexValue, vi.finalIndexValue))
    + trow('Cash left at the end (INR)', di.cashLeft, vi.cashLeft, inr, dMoney(di.cashLeft, vi.cashLeft))
    + sec('Money-weighted return')
    + trow('Money-weighted return (per year)', dca.moneyWeightedReturn, vm.moneyWeightedReturn, (x) => pct(x, 2), dPts(dca.moneyWeightedReturn, vm.moneyWeightedReturn))
    + sec('Costs')
    + trow('Trading costs paid (INR)', dca.costTotal, vm.costTotal, inr, dMoney(dca.costTotal, vm.costTotal));
}

function cardsHtml(r) {
  const dca = r.dca ?? {};
  const vm = r.vm ?? {};
  const di = dca.investments ?? {};
  const vi = vm.investments ?? {};
  const stat = (label, value, note) => (value === null ? '' : `<div class="stat"><div class="lbl">${esc(label)}</div><div class="val">${value}</div>${note ? `<span class="sub">${esc(note)}</span>` : ''}</div>`);
  const pick = (x, f) => (isNum(x) ? f(x) : null);
  const epDates = (p) => {
    const e = deepest(p);
    return e && e.peakDate && e.troughDate ? `${e.peakDate} to ${e.troughDate}` : null;
  };
  const plan = (p, count, countNote, invVal, invNote) => [
    stat('Ending equity', pick(p.endingEquity, inr), null),
    stat('Profit vs contributions', pick(p.profit, signedInr), isNum(p.totalContributions) ? `on ${inr(p.totalContributions)} put in` : null),
    stat('TWR CAGR', pick(p.twrCagr, (x) => pct(x, 2)), 'time-weighted, per year'),
    stat('Sharpe (risk-free=0)', pick(p.sharpe, fx2), 'mean return over volatility, annualized'),
    stat('Maximum drawdown', pick(p.maxDrawdown, (x) => pct(x, 2)), epDates(p)),
    stat('Annualized volatility', pick(p.annVol, (x) => pct(x, 2)), null),
    stat('Money put in', pick(p.totalContributions, inr), isNum(count) ? `${count} ${countNote}` : null),
    stat('Investments made', pick(invVal, String), invNote),
  ].join('');
  const card = (cls, title, body) => (body ? `<div class="plan ${cls}"><h3>${esc(title)}</h3><div class="stat-grid">${body}</div></div>` : '');
  const vmSub = isNum(vi.buys) && isNum(vi.sells) ? `${vi.buys} buys, ${vi.sells} sells` : null;
  return card('plan-dca', 'Monthly DCA', plan(dca, di.purchases, 'purchases', di.purchases, 'purchases'))
    + card('plan-vm', 'Volatility-managed', plan(vm, vi.contributions, 'contributions', vi.trades, vmSub ?? 'trades'));
}

function controlHtml(r) {
  const vm = r.vm;
  const c = r.control;
  const t = r.timingEffect;
  if (!vm || !c || !isNum(vm.endingEquity) || !isNum(c.endingEquity)) return '';
  const vi = vm.investments ?? {};
  const ci = c.investments ?? {};
  const both = (a, b) => isNum(a) && isNum(b);
  const dIn = (a, b) => (both(a, b) ? signedInr(a - b) : '-');
  const dNum = (a, b, d = 2) => (both(a, b) ? signedNum(a - b, d) : '-');
  const dPts = (a, b) => (both(a, b) ? signedPts(a - b, 2) : '-');
  const head = ['', 'Volatility-managed', isNum(c.share) ? `Constant target ${pct(c.share, 1)}` : 'Constant target', 'Difference (VM minus constant)'];
  const trow = (label, a, b, f, diff) => `<tr><td>${esc(label)}</td><td>${shownOr(a, f)}</td><td>${shownOr(b, f)}</td><td>${diff}</td></tr>`;
  const table = `<div class="scroll-x"><table class="cmp"><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>`
    + trow('Ending equity (INR)', vm.endingEquity, c.endingEquity, inr, dIn(vm.endingEquity, c.endingEquity))
    + trow('Sharpe (risk-free=0)', vm.sharpe, c.sharpe, fx2, dNum(vm.sharpe, c.sharpe))
    + trow('Maximum drawdown', vm.maxDrawdown, c.maxDrawdown, (x) => pct(x, 2), dPts(vm.maxDrawdown, c.maxDrawdown))
    + trow('TWR CAGR', vm.twrCagr, c.twrCagr, (x) => pct(x, 2), dPts(vm.twrCagr, c.twrCagr))
    + trow('Number of trades', vi.trades, ci.trades, String, dNum(vi.trades, ci.trades, 0))
    + trow('Trading costs paid (INR)', vm.costTotal, c.costTotal, inr, dIn(vm.costTotal, c.costTotal))
    + '</table></div>';
  const sentence = isNum(t?.endingEquityDiff) && isNum(t?.sharpeDiff) && isNum(t?.maxDrawdownDiff)
    ? `Against the constant target, the volatility-managed plan ended ${bold(inr(Math.abs(t.endingEquityDiff)))} ${t.endingEquityDiff >= 0 ? 'higher' : 'lower'}, its Sharpe ratio was ${bold(Math.abs(t.sharpeDiff).toFixed(2))} ${t.sharpeDiff >= 0 ? 'higher' : 'lower'}, and its biggest fall was ${bold((Math.abs(t.maxDrawdownDiff) * 100).toFixed(2))} points ${t.maxDrawdownDiff > 0 ? 'shallower' : t.maxDrawdownDiff < 0 ? 'deeper' : 'unchanged'}.`
    : '';
  return '<h3>Is the volatility signal doing anything?</h3>'
    + '<p class="note">The constant-target plan has the same ledger and rules as the volatility-managed plan, rebalances on the same contribution dates with the same cash and costs, and holds a fixed target equal to the volatility-managed plan\'s average target. Any difference comes from when the volatility plan held more or less, not from how much it held on average.</p>'
    + table
    + (sentence ? `<p style="margin-top:12px">${sentence}</p>` : '');
}

function renderControl(r) {
  const html = controlHtml(r);
  const box = $('controlCard');
  box.innerHTML = html;
  box.hidden = !html;
}

function livePanels(hasCtl) {
  return [
    {
      id: 'value', title: 'Portfolio value', height: 250,
      lines: [
        { key: 'put', color: 'var(--muted)', label: 'Money put in', dash: true },
        { key: 'dcaEquity', color: 'var(--sip)', label: 'Monthly DCA' },
        { key: 'vmEquity', color: 'var(--vol)', label: 'Volatility-managed', fill: true },
        ...(hasCtl ? [{ key: 'ctlEquity', color: 'var(--ink-2)', label: 'Constant target', thin: true }] : []),
      ],
      axisFmt: (v) => lakh(v).replace(' ', ''), markers: 'end', markFmt: inr,
    },
    {
      id: 'dd', title: 'Drawdown over time (fall from the previous high of the NAV)', height: 170, markers: 'min', markFmt: (v) => pct(v, 2),
      lines: [
        { key: 'dcaDd', color: 'var(--sip)', label: 'Monthly DCA', fill: true },
        { key: 'vmDd', color: 'var(--vol)', label: 'Volatility-managed', fill: true },
      ],
      axisFmt: pctAxis, zeroMax: true,
    },
    {
      id: 'vol', title: 'Volatility of the previous month (per year)', height: 110,
      lines: [{ key: 'priorMonthVol', color: 'var(--ink)', label: 'Previous-month volatility', fill: true, thin: true }],
      axisFmt: pctAxis, zeroMin: true,
    },
    {
      id: 'share', title: 'Share of the money in the index', height: 130,
      lines: [
        { key: 'dcaShare', color: 'var(--sip)', label: 'Monthly DCA' },
        { key: 'vmShare', color: 'var(--vol)', label: 'Volatility-managed' },
        { key: 'vmTarget', color: 'var(--ink-2)', label: 'Volatility target', thin: true },
      ],
      axisFmt: pctAxis, fixed: [0, 1],
    },
  ];
}

const planTooltip = (name) => (d) => {
  const rows = [
    { label: name, value: isNum(d.price) ? Math.round(d.price).toLocaleString('en-IN') : '-' },
    { label: 'Monthly DCA', value: `${lakh(d.dcaEquity)}  (${pct(d.dcaShare, 0)} in index)`, color: 'var(--sip)' },
    { label: 'Volatility-managed', value: `${lakh(d.vmEquity)}  (${pct(d.vmShare, 0)} in index)`, color: 'var(--vol)' },
    { label: 'Fall from high', value: `${pct(d.dcaDd)} vs ${pct(d.vmDd)}` },
    { label: 'Previous-month volatility', value: pct(d.priorMonthVol, 1) },
    { label: 'Volatility target', value: pct(d.vmTarget, 0) },
  ];
  if (isNum(d.ctlEquity)) rows.splice(3, 0, { label: 'Constant target', value: `${lakh(d.ctlEquity)}`, color: 'var(--ink-2)' });
  return { rows };
};

function renderChart(r, name) {
  const chart = $('chart');
  const note = $('chartNote');
  let put = 0;
  const all = (Array.isArray(r.series) ? r.series : []).map((d) => ({ ...d, put: (put += d.contribution || 0) }));
  const rows = chartRows(all, [...LIVE_KEYS, 'put']);
  const hasCtl = rows.length > 0 && rows.every((d) => isNum(d.ctlEquity));
  if (rows.length < 2) {
    chart.textContent = 'Not enough data for a chart.';
    note.textContent = '';
    return;
  }
  note.textContent = rows.length < all.length
    ? `The chart starts on ${rows[0].date}: earlier days have no previous-month volatility figure.`
    : '';
  liveChart(chart, rows, { panels: livePanels(hasCtl), tooltip: planTooltip(name) });
}

function howHtml(r) {
  const p = r.params ?? {};
  const f = (t) => `<pre class="formula">${esc(t)}</pre>`;
  const para = (t) => `<p class="note" style="margin:8px 0">${esc(t)}</p>`;
  const monthly = shownOr(p.monthly, inr);
  const maxP = shownOr(p.maxExposure, (x) => pct(x, 0));
  const costP = shownOr(p.costBps, (x) => String(x));
  return [
    para('Every number on this page comes from the daily closes of the selected index and the settings above. The price index has no dividends, and both plans use the same prices.'),
    f(`contribution      ${monthly} on the first trading day of each calendar month, added to both plans at that day's close`),
    f('realized variance RV(month) = sum of the squared daily index returns in that calendar month (no demeaning)'),
    f(`target(month)     = min( (1 / RV of the previous month) / average of 1 / RV over all earlier months , ${maxP} )`),
    para('The target is 0 in the first two months, which have no earlier estimate. No later month is used.'),
    f(`DCA               buys the whole contribution at once; cost = value traded x ${costP} / 10,000`),
    f(`VM                on contribution days: target value = equity x target; buys or sells the difference; cost = value traded x ${costP} / 10,000; idle cash earns 0%`),
    f('daily return      = (equity today - contribution today) / equity yesterday - 1'),
    f('TWR cumulative    = product of (1 + daily return) - 1'),
    f('TWR CAGR          = (1 + TWR cumulative) ^ (1 / years) - 1, with years = number of daily returns / 252'),
    f('annualized vol    = sd of daily returns x square root of 252'),
    f('Sharpe (risk-free=0) = mean daily return x 252 / (sd of daily returns x square root of 252)'),
    f('maximum drawdown  = lowest value of NAV / highest NAV so far - 1, where NAV is the growth index starting at 1 before the first day'),
    f('money-weighted    = annual IRR of -contribution on each contribution date and +ending equity on the last date (days / 365)'),
  ].join('');
}

function ddHtml(r) {
  const rows = [['Monthly DCA', r.dca], ['Volatility-managed', r.vm]].flatMap(([label, p]) => (Array.isArray(p?.drawdownEpisodes) ? p.drawdownEpisodes.slice(0, 3) : [])
    .map((e) => `<tr><td>${esc(label)}</td><td>${txt(e?.peakDate)}</td><td>${txt(e?.troughDate)}</td><td>${e?.endDate ? txt(e.endDate) : 'not recovered'}</td><td>${shownOr(e?.depth, (x) => pct(x, 2))}</td><td>${shownOr(e?.tradingDaysToTrough, String)}</td><td>${shownOr(e?.tradingDaysToRecover, String)}</td><td>${shownOr(e?.tradingDaysUnder, String)}</td></tr>`));
  const head = ['Plan', 'Fall started', 'Lowest point', 'Recovered', 'Depth', 'Trading days to the low', 'Trading days to recover', 'Trading days under water'];
  return rows.length
    ? `<div class="list-box"><table class="cmp"><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.join('')}</table></div>`
    : '<p class="note">No falls to show.</p>';
}

function listTable(title, list, head, rowFn) {
  if (!Array.isArray(list)) return '';
  const body = list.length
    ? `<div class="list-box"><table class="cmp"><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${list.slice(0, LIST_CAP).map(rowFn).join('')}</table></div>${list.length > LIST_CAP ? `<p class="note">First ${LIST_CAP} of ${list.length} shown; the CSV has all.</p>` : ''}`
    : '<p class="note">None.</p>';
  return `<p class="note" style="margin-top:12px"><b>${esc(title)}</b> (${list.length})</p>${body}`;
}

function tradesHtml(r) {
  return listTable('Monthly DCA purchases', r.dca?.purchaseList, ['Date', 'Amount', 'Index price', 'Fee', 'Index units'],
    (x) => `<tr><td>${txt(x.date)}</td><td>${inrOr(x.amount)}</td><td>${shownOr(x.price, fx2)}</td><td>${inrOr(x.fee)}</td><td>${shownOr(x.shares, (u) => u.toFixed(4))}</td></tr>`)
    + listTable('Volatility-managed trades', r.vm?.tradeList, ['Date', 'Buy or sell', 'Amount', 'Index price', 'Fee', 'Share of the money in the index after the trade', 'Target'],
      (x) => `<tr><td>${txt(x.date)}</td><td>${txt(x.side)}</td><td>${inrOr(x.value)}</td><td>${shownOr(x.price, fx2)}</td><td>${inrOr(x.fee)}</td><td>${shownOr(x.shareAfter, (s) => pct(s, 1))}</td><td>${shownOr(x.target, (t) => pct(t, 1))}</td></tr>`);
}

function liveNone(message) {
  $('verdict').textContent = message;
  $('cards').hidden = true;
  $('cards').innerHTML = '';
  $('kpis').innerHTML = '';
  $('controlCard').hidden = true;
  $('chart').textContent = '';
  $('chartNote').textContent = '';
}

function renderLive(data) {
  const { result: r, name } = data;
  $('verdict').innerHTML = liveVerdict(r, name);
  const cards = cardsHtml(r);
  $('cards').innerHTML = cards;
  $('cards').hidden = !cards;
  $('kpis').innerHTML = kpiTable(r);
  renderControl(r);
  renderChart(r, name);
  $('howBody').innerHTML = howHtml(r);
  $('ddBody').innerHTML = ddHtml(r);
  $('tradesBody').innerHTML = tradesHtml(r);
}

async function loadCompare() {
  const [csvN, csvB] = await Promise.all(['nifty50', 'banknifty'].map((k) => (state.overrides[k] ? state.overrides[k].text : fetchText(FILES[k]))));
  const body = settings();
  const [n, b] = await Promise.all([
    cachedPost('api/dcavm', { csv: csvN, ...body }),
    cachedPost('api/dcavm', { csv: csvB, ...body }),
  ]);
  return { n, b, merged: mergeSeries(n.series, b.series) };
}

const cmpTooltip = (d) => ({
  rows: [
    { label: 'Money put in so far', value: inr(d.put) },
    { label: 'Nifty 50 close', value: Math.round(d.nPrice).toLocaleString('en-IN'), color: 'var(--nifty)' },
    { label: 'Bank Nifty close', value: Math.round(d.bPrice).toLocaleString('en-IN'), color: 'var(--bank)' },
    { label: 'Nifty 50 volatility-managed', value: lakh(d.nVm), color: 'var(--nifty)' },
    { label: 'Bank Nifty volatility-managed', value: lakh(d.bVm), color: 'var(--bank)' },
    { label: 'Nifty 50 monthly DCA', value: lakh(d.nDca), color: 'var(--nifty)' },
    { label: 'Bank Nifty monthly DCA', value: lakh(d.bDca), color: 'var(--bank)' },
    { label: 'Drawdown, DCA (Nifty vs Bank)', value: `${pct(d.nDcaDd)} vs ${pct(d.bDcaDd)}` },
    { label: 'Drawdown, VM (Nifty vs Bank)', value: `${pct(d.nVmDd)} vs ${pct(d.bVmDd)}` },
    { label: 'VM target (Nifty vs Bank)', value: `${pct(d.nVmTarget, 0)} / ${pct(d.bVmTarget, 0)}` },
  ],
});

const cmpCell = (x, f) => (isNum(x) ? f(x) : null);
const intCell = (x) => cmpCell(x, (v) => Math.round(v).toLocaleString('en-IN'));
const inrCell = (x) => cmpCell(x, (v) => inr(v));
const pctCell = (x, d = 1) => cmpCell(x, (v) => pct(v, d));
const ptsCell = (x) => cmpCell(x, (v) => signedPts(v, 2));
const priceCell = (x) => cmpCell(x, (v) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const withWord = (x, word) => cmpCell(x, (v) => `${Math.round(v).toLocaleString('en-IN')} ${word}`);
const joinCells = (parts) => { const ok = parts.filter((p) => p !== null); return ok.length ? ok.join(', ') : null; };
const seriesLen = (o) => (Array.isArray(o.series) && o.series.length ? o.series.length : undefined);
const weekendCount = (series) => series.filter((d) => { const w = new Date(`${d?.date}T00:00:00Z`).getUTCDay(); return w === 0 || w === 6; }).length;
const ddPhrase = (d) => {
  const pts = Math.abs(d * 100);
  if (pts < 0.05) return 'left the maximum drawdown unchanged';
  return `${d > 0 ? 'cut' : 'deepened'} the maximum drawdown by ${pts.toFixed(1)} points`;
};
const inrPhrase = (d) => (d >= 0 ? `${inr(d)} higher` : `${inr(-d)} lower`);

function cmpCard(title, rows, after = '') {
  const body = rows.filter((r) => r[1] !== null || r[2] !== null);
  if (!body.length) return '';
  const tr = body.map(([label, a, b]) => `<tr><td>${esc(label)}</td><td>${a ?? '-'}</td><td>${b ?? '-'}</td></tr>`).join('');
  return `<div class="card cmp-extra" style="margin-top:16px"><h3>${esc(title)}</h3><div class="scroll-x"><table class="cmp"><tr><th></th><th>Nifty 50</th><th>Bank Nifty</th></tr>${tr}</table></div>${after}</div>`;
}

function renderCmpExtras(n, b, rho) {
  let host = $('cmpExtras');
  if (!host) {
    host = document.createElement('div');
    host.id = 'cmpExtras';
    $('tab-compare').appendChild(host);
  }
  const two = (label, fn) => [label, fn(n), fn(b)];
  const diff = (o, key) => (isNum(o.vm?.[key]) && isNum(o.dca?.[key]) ? o.vm[key] - o.dca[key] : undefined);
  const tim = (o, key) => (isNum(o.timingEffect?.[key]) ? o.timingEffect[key] : undefined);
  const vi = (o) => o.vm?.investments ?? {};
  const di = (o) => o.dca?.investments ?? {};
  const annVol = (o) => (isNum(o.stats?.returns?.sd) ? o.stats.returns.sd * Math.sqrt(252) : undefined);

  const inputs = cmpCard('The two input files', [
    two('Source', (o) => (seriesLen(o) ? esc('NSE official file supplied by the owner') : null)),
    two('Rows', (o) => intCell(seriesLen(o))),
    two('First date', (o) => (o.period?.from ? txt(o.period.from) : null)),
    two('Last date', (o) => (o.period?.to ? txt(o.period.to) : null)),
    two('Dates on a Saturday or Sunday', (o) => (seriesLen(o) ? intCell(weekendCount(o.series)) : null)),
    two('Index change over the period', (o) => pctCell(o.period?.indexChange, 2)),
    two('Index biggest fall', (o) => pctCell(ownMaxFall(o.series), 2)),
    two('Index volatility per year', (o) => pctCell(annVol(o), 2)),
    ['Correlation of daily index returns', cmpCell(rho, fx2), cmpCell(rho, fx2)],
  ]);

  const dn = diff(n, 'maxDrawdown');
  const db = diff(b, 'maxDrawdown');
  const ddSentence = isNum(dn) && isNum(db)
    ? `<p style="margin:12px 0 0">Volatility management ${ddPhrase(dn)} on Nifty 50 and ${ddPhrase(db)} on Bank Nifty.</p>`
    : '';
  const vmVsDca = cmpCard('What volatility management did to each index (VM minus DCA)', [
    two('Ending equity (INR)', (o) => cmpCell(diff(o, 'endingEquity'), signedInr)),
    two('TWR CAGR (pts)', (o) => cmpCell(diff(o, 'twrCagr'), ptsCell)),
    two('Annualized volatility (pts)', (o) => cmpCell(diff(o, 'annVol'), ptsCell)),
    two('Sharpe (risk-free=0)', (o) => cmpCell(diff(o, 'sharpe'), (v) => signedNum(v, 2))),
    two('Maximum drawdown (pts)', (o) => cmpCell(diff(o, 'maxDrawdown'), ptsCell)),
    two('Calmar ratio', (o) => cmpCell(diff(o, 'calmar'), (v) => signedNum(v, 2))),
    two('Money-weighted return (pts)', (o) => cmpCell(diff(o, 'moneyWeightedReturn'), ptsCell)),
  ], ddSentence);

  const ed = tim(n, 'endingEquityDiff');
  const eb = tim(b, 'endingEquityDiff');
  const timingSentence = isNum(ed) && isNum(eb)
    ? `<p style="margin:12px 0 0">Against a constant target share with the same average exposure, the volatility timing ended ${inrPhrase(ed)} on Nifty 50 and ${inrPhrase(eb)} on Bank Nifty.</p>`
    : '';
  const timing = cmpCard('Is the volatility signal doing anything, on each index?', [
    two('Constant target share', (o) => pctCell(o.control?.share, 1)),
    two('Ending equity: volatility-managed minus constant target (INR)', (o) => cmpCell(tim(o, 'endingEquityDiff'), signedInr)),
    two('Sharpe difference', (o) => cmpCell(tim(o, 'sharpeDiff'), (v) => signedNum(v, 2))),
    two('Maximum drawdown difference (positive = the volatility plan fell less)', (o) => ptsCell(tim(o, 'maxDrawdownDiff'))),
    two('TWR CAGR difference', (o) => ptsCell(tim(o, 'twrCagrDiff'))),
  ], timingSentence);

  const money = cmpCard('How the money was invested', [
    two('Monthly contributions (count and total put in)', (o) => joinCells([withWord(vi(o).contributions, 'contributions'), cmpCell(vi(o).totalContributions, (v) => `${inr(v)} in all`)])),
    two('DCA purchases', (o) => joinCells([withWord(di(o).purchases, 'purchases'), cmpCell(di(o).totalBought, (v) => `${inr(v)} bought`)])),
    two('DCA average index price paid', (o) => priceCell(di(o).averageBuyPrice)),
    two('VM rebalances', (o) => intCell(vi(o).rebalances)),
    two('VM trades', (o) => intCell(vi(o).trades)),
    two('VM buys', (o) => intCell(vi(o).buys)),
    two('VM sells', (o) => intCell(vi(o).sells)),
    two('VM total bought', (o) => inrCell(vi(o).totalBought)),
    two('VM total sold', (o) => inrCell(vi(o).totalSold)),
    two('VM turnover', (o) => inrCell(vi(o).turnover)),
    two('VM average target exposure', (o) => pctCell(vi(o).averageTargetExposure, 1)),
    two('VM average money in the index', (o) => inrCell(vi(o).averageInIndex)),
    two('VM least and most money in the index', (o) => (isNum(vi(o).lowestInIndex) && isNum(vi(o).peakInIndex) ? `${inr(vi(o).lowestInIndex)} / ${inr(vi(o).peakInIndex)}` : null)),
  ]);

  host.innerHTML = inputs + vmVsDca + timing + money;
}

function renderCompare({ n, b, merged }) {
  const dn = n.dca ?? {};
  const vn = n.vm ?? {};
  const db = b.dca ?? {};
  const vb = b.vm ?? {};
  const rho = merged.length > 3 ? correlation(priceReturns(merged, 'nPrice'), priceReturns(merged, 'bPrice')) : null;
  const annVol = (o) => (isNum(o.stats?.returns?.sd) ? o.stats.returns.sd * Math.sqrt(252) : undefined);
  const span2 = (v) => `<td colspan="2" style="text-align:center">${v}</td>`;
  const crIdx = (label, get, f) => `<tr><td>${esc(label)}</td>${span2(shownOr(get(n), f))}${span2(shownOr(get(b), f))}</tr>`;
  const four = (label, get, f) => `<tr><td>${esc(label)}</td>${[[n, 'dca'], [n, 'vm'], [b, 'dca'], [b, 'vm']].map(([o, p]) => `<td>${shownOr(get(o, p), f)}</td>`).join('')}</tr>`;
  const csec = (t) => `<tr class="sec"><td colspan="5">${esc(t)}</td></tr>`;
  const ddCell = (o, p) => {
    const plan = o[p];
    if (!isNum(plan?.maxDrawdown)) return '-';
    const e = deepest(plan);
    return pct(plan.maxDrawdown, 2) + (e ? `<span class="sub">${txt(e.peakDate)} to ${txt(e.troughDate)}</span>` : '');
  };
  const ratio = isNum(annVol(n)) && isNum(annVol(b)) && annVol(n) > 0 ? annVol(b) / annVol(n) : null;
  $('cmpTable').innerHTML = '<tr><th rowspan="2"></th><th colspan="2" style="text-align:center">Nifty 50</th><th colspan="2" style="text-align:center">Bank Nifty</th></tr>'
    + '<tr>' + ['Plain DCA', 'Volatility-managed', 'Plain DCA', 'Volatility-managed'].map((h) => `<th style="text-align:right">${h}</th>`).join('') + '</tr>'
    + csec('The index')
    + crIdx('Index change over the period', (o) => o.period?.indexChange, (x) => pct(x, 2))
    + crIdx('Index own biggest fall', (o) => ownMaxFall(o.series), (x) => pct(x, 2))
    + crIdx('Index volatility over the period (per year)', annVol, (x) => pct(x, 2))
    + (isNum(rho) ? `<tr><td>Correlation of daily index returns (Nifty 50 with Bank Nifty)</td><td colspan="4" style="text-align:center">${fx2(rho)}</td></tr>` : '')
    + csec('Plain DCA invests every rupee at once; volatility-managed lets the rule set how much is in the index')
    + four('Ending equity (INR)', (o, p) => o[p]?.endingEquity, inr)
    + four('Total contributions (INR)', (o, p) => o[p]?.totalContributions, inr)
    + four('TWR CAGR', (o, p) => o[p]?.twrCagr, (x) => pct(x, 2))
    + four('Annualized volatility', (o, p) => o[p]?.annVol, (x) => pct(x, 2))
    + four('Sharpe (risk-free=0)', (o, p) => o[p]?.sharpe, fx2)
    + `<tr><td>Maximum drawdown</td>${[[n, 'dca'], [n, 'vm'], [b, 'dca'], [b, 'vm']].map(([o, p]) => `<td>${ddCell(o, p)}</td>`).join('')}</tr>`
    + four('Purchases (DCA) or trades (volatility-managed)', (o, p) => (p === 'dca' ? o.dca?.investments?.purchases : o.vm?.investments?.trades), String);
  const parts = [];
  if (isNum(vn.endingEquity) && isNum(vb.endingEquity) && isNum(dn.endingEquity) && isNum(db.endingEquity)) {
    parts.push(`From ${txt(n.period?.from)} to ${txt(n.period?.to)}, the volatility-managed plan ended at ${bold(inr(vn.endingEquity))} on Nifty 50 and ${bold(inr(vb.endingEquity))} on Bank Nifty. The monthly DCA ended at ${bold(inr(dn.endingEquity))} and ${bold(inr(db.endingEquity))}.`);
  }
  if (isNum(vn.maxDrawdown) && isNum(vb.maxDrawdown)) {
    parts.push(`The biggest fall from a high for the volatility-managed plan was ${bold(pct(vn.maxDrawdown, 2))} on Nifty 50 and ${bold(pct(vb.maxDrawdown, 2))} on Bank Nifty.`);
  }
  if (isNum(ratio)) parts.push(`Bank Nifty's annualized volatility over the period was ${bold(ratio.toFixed(2))} times Nifty 50's.`);
  $('cmpVerdict').innerHTML = parts.join(' ') + notesHtml([...new Set([...(n.notes ?? []), ...(b.notes ?? [])])]);
  const chart = $('cmpChart');
  const rows = chartRows(merged, CMP_KEYS);
  if (rows.length < 2) chart.textContent = 'No dates in common between the two series.';
  else {
    const floor = Math.floor(Math.min(...rows.flatMap((d) => [d.nDcaDd, d.bDcaDd, d.nVmDd, d.bVmDd])) * 10) / 10;
    const panels = CMP_PANELS.map((p) => (p.fixed ? { ...p, fixed: [floor, 0] } : p));
    liveChart(chart, rows, { panels, tooltip: cmpTooltip });
  }
  renderCmpExtras(n, b, rho);
}

async function loadStats() {
  const cols = [];
  for (const key of ['nifty50', 'banknifty']) cols.push({ key, label: NAMES[key], csv: await fetchText(FILES[key]) });
  for (const key of ['nifty50', 'banknifty']) {
    const o = state.overrides[key];
    if (o) cols.push({ key: `file-${key}`, label: o.name, csv: o.text });
  }
  const res = await Promise.all(cols.map((c) => cachedPost('api/study', { csv: c.csv, rf: 0 })));
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
    const vrows = vs.map((v) => `<tr><td>${txt(v?.label)}</td><td>${shownOr(v?.alphaAnnual, (x) => pct(x, 2))}</td><td>${numOr(v?.tAlphaRobust, 2)}</td><td>${numOr(v?.appraisalAnnual, 2)}</td><td>${numOr(v?.sharpeManaged, 2)}</td><td>${numOr(v?.avgAbsWeightChange, 2)}</td><td>${numOr(v?.breakEvenBp, 0)}</td><td>${seqOr([v?.weights?.p50, v?.weights?.p99], (x) => x.toFixed(2))}</td></tr>`).join('');
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
      `The sample is ${s.n} months; the paper uses 1,065 monthly observations, so treat small samples carefully.`,
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
  download('past-results-statistics.json', JSON.stringify(obj, null, 2), 'application/json');
}

function downloadDaily() {
  const data = state.data.live;
  if (!data) { setStatus('Nothing to download yet.', true); return; }
  const series = Array.isArray(data.result.series) ? data.result.series : [];
  if (!series.length) { setStatus('No daily rows to download.', true); return; }
  download(`past-results-${data.index}-daily.csv`, toCsv(series, Object.keys(series[0])), 'text/csv');
}

function downloadTrades() {
  const data = state.data.live;
  if (!data) { setStatus('Nothing to download yet.', true); return; }
  const r = data.result;
  const list = (x) => (Array.isArray(x) ? x : []);
  const rows = [
    ...list(r.dca?.purchaseList).map((p) => ({ plan: 'monthly-dca', date: p.date, side: 'buy', amount: p.amount, price: p.price, fee: p.fee })),
    ...list(r.vm?.tradeList).map((t) => ({ plan: 'volatility-managed', date: t.date, side: t.side, amount: t.value, price: t.price, fee: t.fee })),
  ];
  if (!rows.length) { setStatus('No investments to download.', true); return; }
  download(`past-results-${data.index}-investments.csv`, toCsv(rows, ['plan', 'date', 'side', 'amount', 'price', 'fee']), 'text/csv');
}

const SOURCE_TEXT = 'NSE official file supplied by the owner';
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekday = (iso) => WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()];
const isWeekend = (iso) => ['Saturday', 'Sunday'].includes(weekday(iso));
const DAILY_PAGE = 100;
const CHECK_TOL = 1e-9;
const DAILY_COLS = [
  ['Date', (r) => r.date],
  ['Price', (r) => r.price],
  ['Daily_index_return', (r) => r.indexReturn],
  ['Prior_month_RV', (r) => r.priorMonthRv],
  ['VM_target_exposure', (r) => r.vmTarget],
  ['DCA_contribution', (r) => r.contribution],
  ['VM_contribution', (r) => r.contribution],
  ['DCA_equity', (r) => r.dcaEquity],
  ['VM_equity', (r) => r.vmEquity],
  ['DCA_cash', (r) => r.dcaCash],
  ['VM_cash', (r) => r.vmCash],
  ['DCA_shares', (r) => r.dcaShares],
  ['VM_shares', (r) => r.vmShares],
  ['DCA_transaction_cost', (r) => r.dcaCost],
  ['VM_transaction_cost', (r) => r.vmCost],
  ['DCA_return', (r) => r.dcaReturn],
  ['VM_return', (r) => r.vmReturn],
];
const CHECK_COLS = DAILY_COLS.slice(1);
const SUMMARY_HEAD = ['Strategy', 'Ending equity (INR)', 'Total contributions (INR)', 'Profit vs contributions (INR)', 'TWR cumulative return', 'TWR CAGR', 'Annualized volatility', 'Sharpe (risk-free=0)', 'Maximum drawdown'];
const SUMMARY_PLANS = [['DCA', 'dca'], ['VM', 'vm']];
const summaryValues = (name, p) => [name, p.endingEquity, p.totalContributions, p.profit, p.twrCumulative, p.twrCagr, p.annVol, p.sharpe, p.maxDrawdown];
const fmt4 = (v) => (isNum(v) ? v.toLocaleString('en-IN', { maximumFractionDigits: 4 }) : '');
const fmt6 = (v) => (isNum(v) ? v.toLocaleString('en-IN', { maximumFractionDigits: 6 }) : '-');
const dataDaily = () => (Array.isArray(state.data.data?.result?.daily) ? state.data.data.result.daily : null);
const monthEnds = (daily) => {
  const last = new Map();
  for (const r of daily) last.set(r.date.slice(0, 7), r);
  return [...last.values()];
};
const csvField = (v) => {
  const s = isNum(v) ? String(v) : (typeof v === 'string' ? v : '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const fullCsv = (cols, rows) => [cols.map(([h]) => h).join(','), ...rows.map((r) => cols.map(([, f]) => csvField(f(r))).join(','))].join('\n') + '\n';
const cellOf = (v) => {
  if (typeof v === 'string') return `<td>${esc(v)}</td>`;
  if (isNum(v)) return `<td title="${esc(String(v))}">${esc(fmt4(v))}</td>`;
  return '<td></td>';
};
const gridTable = (cols, rows) => `<table class="cmp"><tr>${cols.map(([h]) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${cols.map(([, f]) => cellOf(f(r))).join('')}</tr>`).join('')}</table>`;

async function loadData() {
  const index = state.index;
  const o = state.overrides[index];
  const csv = o ? o.text : await fetchText(FILES[index]);
  const result = await cachedPost('api/dcavm', { csv, ...settings(), includeDaily: true });
  return { index, name: o ? o.name : NAMES[index], source: o ? o.name : SOURCE_TEXT, result };
}

function inputCard(data, daily) {
  const weekends = daily.filter((r) => isWeekend(r.date)).map((r) => `${r.date} (${weekday(r.date)})`);
  const weekendText = weekends.length
    ? `${weekends.length} ${weekends.length === 1 ? 'date falls' : 'dates fall'} on a Saturday or Sunday: ${weekends.map((w) => esc(w)).join(', ')}. These are real trading sessions (special sessions on weekends), so they are kept in every number on this page.`
    : 'No date in this input falls on a Saturday or Sunday.';
  const edge = daily.length <= 10 ? daily : [...daily.slice(0, 5), null, ...daily.slice(-5)];
  const edgeRows = edge.map((r) => (r
    ? `<tr><td>${esc(r.date)}</td><td title="${esc(String(r.price))}">${esc(fmt4(r.price))}</td></tr>`
    : '<tr><td>...</td><td></td></tr>')).join('');
  return `<div class="card"><h3>The input data</h3>`
    + `<table class="cmp"><tr><td style="text-align:left">Source</td><td style="text-align:left">${esc(data.source)}</td></tr>`
    + `<tr><td style="text-align:left">Rows used in this run</td><td style="text-align:left">${daily.length}</td></tr>`
    + `<tr><td style="text-align:left">First date</td><td style="text-align:left">${esc(daily[0].date)}</td></tr>`
    + `<tr><td style="text-align:left">Last date</td><td style="text-align:left">${esc(daily.at(-1).date)}</td></tr></table>`
    + `<p class="note" style="margin-top:12px">${weekendText}</p>`
    + `<div class="list-box" style="margin-top:12px"><table class="cmp"><tr><th>Date</th><th>Close</th></tr>${edgeRows}</table></div>`
    + `<p style="margin-top:12px"><button class="btn ghost" type="button" data-act="dl-input">Download the input as CSV</button></p></div>`;
}

function summaryCard(r) {
  const body = SUMMARY_PLANS.map(([name, key]) => `<tr>${summaryValues(name, r[key] ?? {}).map((v, i) => (i === 0
    ? `<td>${esc(v)}</td>`
    : (isNum(v) ? `<td title="${esc(String(v))}">${esc(fmt6(v))}</td>` : '<td>-</td>'))).join('')}</tr>`).join('');
  return `<div class="card"><h3>Summary metrics</h3>`
    + '<p class="note">The same columns as summary_metrics.csv. Money is in rupees. Returns, volatility and drawdown are fractions, so 0.137754 is 13.78%.</p>'
    + `<div class="scroll-x" style="margin-top:12px"><table class="cmp"><tr>${SUMMARY_HEAD.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${body}</table></div>`
    + '<p style="margin-top:12px"><button class="btn ghost" type="button" data-act="dl-summary">Download summary_metrics.csv</button></p></div>';
}

function monthlyCard(daily) {
  const rows = monthEnds(daily);
  return `<div class="card"><h3>Every month</h3>`
    + `<p class="note">The last trading day of each calendar month, as in backtest_monthly.csv. ${rows.length} months. Hover a number to see its full value.</p>`
    + `<div class="list-box" style="max-height:420px;margin-top:12px">${gridTable(DAILY_COLS, rows)}</div>`
    + '<p style="margin-top:12px"><button class="btn ghost" type="button" data-act="dl-monthly">Download backtest_monthly.csv</button></p></div>';
}

function dailyBodyHtml(daily) {
  const v = state.dataView;
  const rows = daily.filter((r) => (!v.from || r.date >= v.from) && (!v.to || r.date <= v.to));
  const pages = Math.max(1, Math.ceil(rows.length / DAILY_PAGE));
  v.page = Math.min(Math.max(0, v.page), pages - 1);
  const slice = rows.slice(v.page * DAILY_PAGE, (v.page + 1) * DAILY_PAGE);
  const info = rows.length
    ? `Rows ${v.page * DAILY_PAGE + 1} to ${v.page * DAILY_PAGE + slice.length} of ${rows.length}. Page ${v.page + 1} of ${pages}.`
    : 'No trading days in this date range.';
  return `<p class="note">${esc(info)}</p>`
    + `<div class="list-box">${gridTable(DAILY_COLS, slice)}</div>`
    + `<p style="margin-top:12px"><button class="btn ghost" type="button" data-act="prev"${v.page <= 0 ? ' disabled' : ''}>Previous</button> `
    + `<button class="btn ghost" type="button" data-act="next"${v.page >= pages - 1 ? ' disabled' : ''}>Next</button></p>`;
}

function renderDailyBody() {
  const daily = dataDaily();
  if (daily) $('dailyBody').innerHTML = dailyBodyHtml(daily);
}

function dailyCard(daily) {
  const v = state.dataView;
  const lo = esc(daily[0].date);
  const hi = esc(daily.at(-1).date);
  return `<div class="card"><h3>Every day</h3>`
    + `<p class="note">Every trading day with the same 17 columns as backtest_daily.csv. ${daily.length} days in all. Pick a From or To date to filter the table; the download always has every day.</p>`
    + `<div class="settings"><label class="field">From<input type="date" data-act="from" min="${lo}" max="${hi}" value="${esc(v.from)}"></label>`
    + `<label class="field">To<input type="date" data-act="to" min="${lo}" max="${hi}" value="${esc(v.to)}"></label></div>`
    + `<div id="dailyBody" style="margin-top:12px">${dailyBodyHtml(daily)}</div>`
    + '<p style="margin-top:12px"><button class="btn ghost" type="button" data-act="dl-daily">Download backtest_daily.csv</button></p></div>';
}

function parseCsvGrid(text) {
  const src = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const parseCheckCell = (raw) => {
  if (raw === '' || raw.toLowerCase() === 'nan') return null;
  const x = Number(raw);
  return Number.isFinite(x) ? x : undefined;
};

function checkHtml(text, daily) {
  const grid = parseCsvGrid(text);
  if (grid.length < 2) return '<p class="note">That file has no data rows.</p>';
  const head = grid[0].map((h) => h.trim());
  const dateAt = head.indexOf('Date');
  if (dateAt < 0) return '<p class="note">That file has no Date column, so its rows cannot be matched to this page.</p>';
  const cols = CHECK_COLS.filter(([h]) => head.includes(h));
  const absent = CHECK_COLS.map(([h]) => h).filter((h) => !head.includes(h));
  const unknown = head.filter((h, i) => h && i !== dateAt && !DAILY_COLS.some(([n]) => n === h));
  const byDate = new Map(daily.map((r) => [r.date, r]));
  const seen = new Set();
  let rowsMatched = 0;
  let compared = 0;
  let matched = 0;
  let worst = null;
  const mismatches = [];
  for (const line of grid.slice(1)) {
    const date = (line[dateAt] ?? '').trim();
    const row = byDate.get(date);
    if (!row) continue;
    rowsMatched++;
    seen.add(date);
    for (const [h, f] of cols) {
      const raw = (line[head.indexOf(h)] ?? '').trim();
      const want = parseCheckCell(raw);
      const have = f(row);
      compared++;
      if (want === null && have === null) { matched++; continue; }
      if (want === null || want === undefined || have === null) { mismatches.push([date, h, have, raw]); continue; }
      const diff = Math.abs(have - want);
      const rel = diff / (Math.abs(want) || 1);
      if (!worst || rel > worst.rel) worst = { rel, date, h };
      if (diff <= Math.max(CHECK_TOL, Math.abs(want) * CHECK_TOL)) matched++;
      else mismatches.push([date, h, have, raw]);
    }
  }
  const lines = [
    `Rows in your file: ${grid.length - 1}. Rows whose date is on this page: ${rowsMatched}. Rows with no date on this page (not compared): ${grid.length - 1 - rowsMatched}.`,
    `Days on this page with no row in your file (not compared): ${daily.length - seen.size}. For a monthly file this is expected, because only month-end rows are in it.`,
    `Values compared: ${compared}. Matched: ${matched}. Mismatched: ${mismatches.length}.`,
    worst
      ? `Largest relative difference: ${worst.rel.toExponential(2)} (${worst.date}, ${worst.h}). Relative to your file's value, or absolute when that value is 0.`
      : 'Largest relative difference: none, because no numeric values were compared.',
  ];
  if (absent.length) lines.push(`Columns missing from your file (not compared): ${absent.join(', ')}.`);
  if (unknown.length) lines.push(`Columns in your file that this page does not produce (ignored): ${unknown.join(', ')}.`);
  const verdict = compared === 0
    ? 'Nothing was compared, so this file does not overlap this page.'
    : mismatches.length === 0
      ? 'Every compared value matches your script output.'
      : `${mismatches.length} ${mismatches.length === 1 ? 'value differs' : 'values differ'} from your script output.`;
  const table = mismatches.length
    ? `<p class="note" style="margin-top:12px">First ${Math.min(10, mismatches.length)} of ${mismatches.length} mismatches:</p><div class="list-box" style="margin-top:8px"><table class="cmp"><tr><th>Date</th><th>Column</th><th>This page</th><th>Your file</th></tr>${mismatches.slice(0, 10).map(([d, h, have, raw]) => `<tr><td>${esc(d)}</td><td>${esc(h)}</td><td>${esc(have === null ? '-' : String(have))}</td><td>${esc(raw === '' ? '-' : raw)}</td></tr>`).join('')}</table></div>`
    : '';
  return `<p class="verdict" style="margin-top:12px">${esc(verdict)}</p>`
    + lines.map((t) => `<p class="note" style="margin-top:8px">${esc(t)}</p>`).join('')
    + table;
}

function checkCard() {
  return '<div class="card"><h3>Check against your own script output</h3>'
    + '<p class="note">Pick the backtest_daily.csv or backtest_monthly.csv that your script wrote. Rows are matched by Date and every numeric column is compared with this page, using the settings above. A value matches when it differs by no more than the larger of 1e-9 and 1e-9 times your file value.</p>'
    + '<label class="field" style="margin-top:12px">Your script output (.csv)<input type="file" accept=".csv,text/csv" data-act="check"></label>'
    + '<div id="checkBody"></div></div>';
}

function renderCheck() {
  const box = $('checkBody');
  if (!box) return;
  const f = state.dataView.file;
  const daily = dataDaily();
  if (!f) { box.innerHTML = ''; return; }
  if (!daily) { box.innerHTML = '<p class="note">Open the All data tab first.</p>'; return; }
  box.innerHTML = `<p class="note" style="margin-top:12px">Checking ${esc(f.name)} against this page.</p>${checkHtml(f.text, daily)}`;
}

async function onCheckFile(input) {
  const file = input.files[0];
  if (!file) { state.dataView.file = null; renderCheck(); return; }
  if (file.size > MAX_FILE_BYTES) {
    input.value = '';
    setStatus('That file is over 5 MB; choose a smaller CSV.', true);
    return;
  }
  try {
    state.dataView.file = { name: file.name, text: await file.text() };
  } catch {
    setStatus('Could not read that file.', true);
    return;
  }
  renderCheck();
}

function renderData(data) {
  const daily = Array.isArray(data.result.daily) ? data.result.daily : [];
  if (daily.length < 2) {
    $('dataRoot').textContent = 'No daily rows came back for this run.';
    return;
  }
  $('dataRoot').innerHTML = inputCard(data, daily) + summaryCard(data.result) + monthlyCard(daily) + dailyCard(daily) + checkCard();
  renderCheck();
}

function downloadData(kind) {
  const data = state.data.data;
  const daily = dataDaily();
  if (!data || !daily) { setStatus('Open the All data tab first.', true); return; }
  const r = data.result;
  if (kind === 'input') download(`input_${data.index}.csv`, fullCsv([['Date', (x) => x.date], ['Close', (x) => x.price]], daily), 'text/csv');
  if (kind === 'summary') download('summary_metrics.csv', [SUMMARY_HEAD.join(','), ...SUMMARY_PLANS.map(([name, key]) => summaryValues(name, r[key] ?? {}).map(csvField).join(','))].join('\n') + '\n', 'text/csv');
  if (kind === 'monthly') download('backtest_monthly.csv', fullCsv(DAILY_COLS, monthEnds(daily)), 'text/csv');
  if (kind === 'daily') download('backtest_daily.csv', fullCsv(DAILY_COLS, daily), 'text/csv');
}

function onDataClick(e) {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'prev' || act === 'next') {
    state.dataView.page += act === 'next' ? 1 : -1;
    renderDailyBody();
  } else if (act && act.startsWith('dl-')) {
    downloadData(act.slice(3));
  }
}

function onDataChange(e) {
  const act = e.target.dataset.act;
  if (act === 'from' || act === 'to') {
    state.dataView[act] = e.target.value;
    state.dataView.page = 0;
    renderDailyBody();
  } else if (act === 'check') {
    onCheckFile(e.target);
  }
}

const LOADERS = { live: loadLive, compare: loadCompare, stats: loadStats, data: loadData };
const RENDERERS = { live: renderLive, compare: renderCompare, stats: renderStats, data: renderData };
const SUMMARIES = {
  live: (d) => `Done: ${d.result.series?.length ?? 0} trading days${state.overrides[d.index] ? ` from ${state.overrides[d.index].name}` : ''}.`,
  compare: (d) => `Done: ${d.merged.length} common trading days.`,
  stats: (d) => `Done: statistics for ${d.length} series.`,
  data: (d) => `Done: ${d.result.daily?.length ?? 0} trading days in the daily table.`,
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
    if (token !== state.token) return;
    if (tab === 'live') liveNone('The live numbers could not be computed.');
    if (tab === 'data') $('dataRoot').innerHTML = '';
    setStatus(err.message || 'Something went wrong.', true);
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
  if (state.tab === 'data') return;
  const data = state.data[state.tab];
  if (data) RENDERERS[state.tab](data);
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
  state.index = $('index').value || 'nifty50';
  const setIndex = (v) => {
    state.index = v;
    $('index').value = v;
    document.querySelectorAll('.seg-b').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.index === v)));
    $('dlgIndex').textContent = `for ${NAMES[v]}`;
    refresh();
  };
  document.querySelectorAll('.seg-b').forEach((b) => b.addEventListener('click', () => setIndex(b.dataset.index)));
  const dlg = $('dlg');
  $('openSettings').addEventListener('click', () => dlg.showModal());
  const openUpload = () => { dlg.showModal(); $('file').focus(); };
  $('openUpload').addEventListener('click', openUpload);
  $('navUpload').addEventListener('click', openUpload);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  SETTING_IDS.forEach((id) => $(id).addEventListener('change', debounce(refresh, 300)));
  $('file').addEventListener('change', async (e) => { await onFile(e); dlg.close(); });
  $('download').addEventListener('click', downloadDaily);
  $('downloadTrades').addEventListener('click', downloadTrades);
  $('downloadStats').addEventListener('click', downloadStats);
  $('dataRoot').addEventListener('click', onDataClick);
  $('dataRoot').addEventListener('change', onDataChange);
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
