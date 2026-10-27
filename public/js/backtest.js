export const WINDOW = 20;

const MONTH_NAMES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const DATE_HEADERS = ['date', 'timestamp', 'index date', 'trade date', 'day'];
const CLOSE_HEADERS = ['close', 'adj close', 'adj. close', 'close price', 'closing price', 'closing index value', 'ltp', 'last'];

const pad = (n) => String(n).padStart(2, '0');

function isoDate(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function toIsoDate(raw) {
  const s = String(raw)
    .replace(/^"|"$/g, '')
    .trim()
    .replace(/[T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/i, '');
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/. ,]+(\d{4})$/);
  if (m) {
    const mon = MONTH_NAMES[m[2].toLowerCase().slice(0, m[2].toLowerCase().startsWith('sept') ? 4 : 3)];
    return mon ? isoDate(+m[3], mon, +m[1]) : null;
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return isoDate(+m[3], +m[2], +m[1]);
  return null;
}

function splitLine(line, delim) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function detectDelimiter(header) {
  const counts = [',', ';', '\t'].map((d) => [d, header.split(d).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][0];
}

function pickColumns(cols) {
  const names = cols.map((c) => c.replace(/^﻿/, '').trim().toLowerCase());
  let dateCol = names.findIndex((n) => DATE_HEADERS.includes(n));
  if (dateCol < 0) dateCol = names.findIndex((n) => n.includes('date'));
  let closeCol = -1;
  for (const want of CLOSE_HEADERS) {
    closeCol = names.indexOf(want);
    if (closeCol >= 0) break;
  }
  if (closeCol < 0) closeCol = names.findIndex((n) => n.includes('close') && !n.includes('prev'));
  return { dateCol, closeCol };
}

export function parseCsvDetailed(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('CSV needs a header row and data rows');
  const delim = detectDelimiter(lines[0]);
  const { dateCol, closeCol } = pickColumns(splitLine(lines[0], delim));
  if (dateCol < 0 || closeCol < 0) throw new Error('CSV needs date and close columns');

  const notes = [];
  let badDate = 0;
  let badClose = 0;
  const parsed = [];
  for (const line of lines.slice(1)) {
    const v = splitLine(line, delim);
    const date = toIsoDate(v[dateCol] ?? '');
    const close = Number(String(v[closeCol] ?? '').replace(/[,\s₹]/g, ''));
    if (!date) {
      badDate++;
      continue;
    }
    if (!Number.isFinite(close) || close <= 0) {
      badClose++;
      continue;
    }
    parsed.push({ date, close });
  }
  if (badDate) notes.push(`Skipped ${badDate} rows with an unreadable date.`);
  if (badClose) notes.push(`Skipped ${badClose} rows with a missing or non-positive close.`);

  const inOrder = parsed.every((r, i) => i === 0 || parsed[i - 1].date <= r.date);
  if (!inOrder) {
    parsed.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    notes.push('Rows were not in date order, so they were sorted oldest first.');
  }
  const rows = [];
  let dupes = 0;
  for (const r of parsed) {
    if (rows.length && rows[rows.length - 1].date === r.date) {
      rows[rows.length - 1] = r;
      dupes++;
    } else rows.push(r);
  }
  if (dupes) notes.push(`Dropped ${dupes} duplicate dates, keeping the last row for each.`);

  let jumps = 0;
  for (let i = 1; i < rows.length; i++) if (Math.abs(rows[i].close / rows[i - 1].close - 1) > 0.25) jumps++;
  if (jumps) notes.push(`${jumps} daily moves exceed 25%. Check for splits or bonuses, because unadjusted closes distort returns.`);

  return { rows, notes };
}

export function parseCsv(text) {
  return parseCsvDetailed(text).rows;
}

export function dailyReturns(closes) {
  const r = [0];
  for (let t = 1; t < closes.length; t++) r.push(closes[t] / closes[t - 1] - 1);
  return r;
}

export function rollingVariance(r, window = WINDOW) {
  const v = new Array(r.length).fill(NaN);
  for (let t = window - 1; t < r.length; t++) {
    let s = 0;
    for (let i = t - window + 1; i <= t; i++) s += r[i] * r[i];
    v[t] = s / window;
  }
  return v;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

export function summarize(returns, { rf = 0, periodsPerYear = 252 } = {}) {
  const n = returns.length;
  const m = mean(returns);
  const s = sd(returns);
  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  for (const x of returns) {
    equity *= 1 + x;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, equity / peak - 1);
  }
  const rfPeriod = rf / periodsPerYear;
  return {
    periods: n,
    cumulative: equity - 1,
    cagr: equity ** (periodsPerYear / n) - 1,
    annVol: s * Math.sqrt(periodsPerYear),
    sharpe: s === 0 ? 0 : ((m - rfPeriod) / s) * Math.sqrt(periodsPerYear),
    maxDrawdown: maxDd,
  };
}

export function ols(y, x) {
  const n = y.length;
  const mx = mean(x);
  const my = mean(y);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) ** 2;
    sxy += (x[i] - mx) * (y[i] - my);
  }
  const beta = sxy / sxx;
  const alpha = my - beta * mx;
  let ssr = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    ssr += (y[i] - alpha - beta * x[i]) ** 2;
    sst += (y[i] - my) ** 2;
  }
  const rmse = Math.sqrt(ssr / (n - 2));
  const seAlpha = rmse * Math.sqrt(1 / n + (mx * mx) / sxx);
  const seBeta = rmse / Math.sqrt(sxx);
  return { n, alpha, beta, rmse, tAlpha: alpha / seAlpha, tBeta: beta / seBeta, r2: 1 - ssr / sst };
}

function robustTs(y, x, reg) {
  const n = y.length;
  let sx = 0;
  let sxx = 0;
  let m0 = 0;
  let m1 = 0;
  let m2 = 0;
  for (let i = 0; i < n; i++) {
    const e2 = (y[i] - reg.alpha - reg.beta * x[i]) ** 2;
    sx += x[i];
    sxx += x[i] * x[i];
    m0 += e2;
    m1 += e2 * x[i];
    m2 += e2 * x[i] * x[i];
  }
  const det = n * sxx - sx * sx;
  const a00 = sxx / det;
  const a01 = -sx / det;
  const a11 = n / det;
  const k = n / (n - 2);
  const varAlpha = k * (a00 * a00 * m0 + 2 * a00 * a01 * m1 + a01 * a01 * m2);
  const varBeta = k * (a01 * a01 * m0 + 2 * a01 * a11 * m1 + a11 * a11 * m2);
  return { tAlphaRobust: reg.alpha / Math.sqrt(varAlpha), tBetaRobust: reg.beta / Math.sqrt(varBeta) };
}

export function paperTest(managedExcess, originalExcess, periodsPerYear) {
  const reg = ols(managedExcess, originalExcess);
  const robust = robustTs(managedExcess, originalExcess, reg);
  const srOld = mean(originalExcess) / sd(originalExcess);
  const appraisal = reg.alpha / reg.rmse;
  const srNew = Math.sqrt(srOld * srOld + appraisal * appraisal);
  const k = Math.sqrt(periodsPerYear);
  return {
    n: reg.n,
    alphaAnnual: reg.alpha * periodsPerYear,
    beta: reg.beta,
    tAlpha: reg.tAlpha,
    tAlphaRobust: robust.tAlphaRobust,
    tBetaRobust: robust.tBetaRobust,
    r2: reg.r2,
    rmse: reg.rmse,
    appraisalAnnual: appraisal * k,
    sharpeOriginal: srOld * k,
    sharpeCombined: srNew * k,
    utilityGain: srOld > 0 ? (srNew * srNew - srOld * srOld) / (srOld * srOld) : null,
  };
}

function finish(rows, c, weight, bh, strat, bhExcess, stratExcess, fee, vol, split, rf, periodsPerYear, initial) {
  const idx = rows.map((_, i) => i);
  const ins = idx.filter((i) => i < split);
  const oos = idx.filter((i) => i >= split);
  const pick = (arr, ids) => ids.map((i) => arr[i]);
  const test = (ids) => (ids.length > 3 ? paperTest(pick(stratExcess, ids), pick(bhExcess, ids), periodsPerYear) : null);

  let bhValue = initial;
  let stratValue = initial;
  let totalCost = 0;
  let totalCostTest = 0;
  const series = rows.map((r, i) => {
    const cost = stratValue * fee[i];
    totalCost += cost;
    if (i >= split) totalCostTest += cost;
    bhValue *= 1 + bh[i];
    stratValue *= 1 + strat[i];
    return { date: r.date, vol: vol[i], weight: weight[i], bh: bh[i], strat: strat[i], bhValue, stratValue, cost };
  });

  return {
    c,
    split,
    initial,
    series,
    costs: { total: totalCost, test: totalCostTest, avgTurnover: mean(weight.map((w, i) => Math.abs(w - (i ? weight[i - 1] : 0)))) },
    insample: {
      buyHold: summarize(pick(bh, ins), { rf, periodsPerYear }),
      strategy: summarize(pick(strat, ins), { rf, periodsPerYear }),
    },
    outOfSample: {
      buyHold: summarize(pick(bh, oos), { rf, periodsPerYear }),
      strategy: summarize(pick(strat, oos), { rf, periodsPerYear }),
    },
    regression: { full: test(idx), train: test(ins), test: test(oos) },
  };
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function backtestDaily(
  rows,
  { cost = 0.001, rf = 0, minExposure = 0, maxExposure = 1, trainShare = 0.7, cashRf = false, window = WINDOW, initial = 100000 } = {},
) {
  const closes = rows.map((d) => d.close);
  const r = dailyReturns(closes);
  const v = rollingVariance(r, window);
  const start = window;
  const split = start + Math.floor((rows.length - start) * trainShare);
  const lo = Math.min(minExposure, maxExposure);

  let sumV = 0;
  for (let t = start; t < split; t++) sumV += v[t];
  const c = sumV / (split - start);

  const weight = new Array(rows.length).fill(0);
  for (let t = start; t < rows.length - 1; t++) weight[t + 1] = clamp(c / v[t], lo, maxExposure);

  const from = start + 1;
  const rfd = rf / 252;
  const bh = r.slice(from);
  const w = weight.slice(from);
  const fee = w.map((x, i) => cost * Math.abs(x - (i ? w[i - 1] : 0)));
  const strat = bh.map((x, i) => w[i] * x + (cashRf ? (1 - w[i]) * rfd : 0) - fee[i]);
  const vol = w.map((_, i) => Math.sqrt(v[from + i - 1] * 252));
  const kept = rows.slice(from);
  return {
    mode: 'daily',
    window,
    ...finish(kept, c, w, bh, strat, bh.map((x) => x - rfd), strat.map((x) => x - rfd), fee, vol, split - from, rf, 252, initial),
  };
}

export function monthlyTable(rows) {
  const months = new Map();
  let prevClose = null;
  for (const row of rows) {
    const key = row.date.slice(0, 7);
    let m = months.get(key);
    if (!m) {
      m = { key, first: prevClose ?? row.close, last: row.close, end: row.date, daily: [] };
      months.set(key, m);
    }
    if (prevClose != null) m.daily.push(row.close / prevClose - 1);
    m.last = row.close;
    m.end = row.date;
    prevClose = row.close;
  }
  return [...months.values()].map((m) => {
    const mu = m.daily.length ? mean(m.daily) : 0;
    return {
      key: m.key,
      end: m.end,
      ret: m.last / m.first - 1,
      rv: m.daily.reduce((a, x) => a + (x - mu) ** 2, 0),
    };
  });
}

export function volManage(excess, rv, { trainShare = 0.7, normalize = 'train', minExposure = 0, maxExposure = Infinity, cost = 0, scaling = 'variance' } = {}) {
  const start = 1;
  const n = excess.length - start;
  const split = start + Math.floor(n * trainShare);
  const lo = Math.min(minExposure, maxExposure);
  const raw = [];
  for (let m = start; m < excess.length; m++) {
    const x = rv[m - 1];
    raw.push(x > 0 ? (scaling === 'volatility' ? 1 / Math.sqrt(x) : 1 / x) : 0);
  }

  const upto = normalize === 'full' ? excess.length : split;
  const f = excess.slice(start, upto);
  const scaled = f.map((x, i) => raw[i] * x);
  const c = sd(f) / sd(scaled);

  const weight = excess.map(() => 0);
  const managed = excess.map(() => 0);
  const fee = excess.map(() => 0);
  for (let m = start; m < excess.length; m++) {
    weight[m] = clamp(c * raw[m - start], lo, maxExposure);
    const prev = m === start ? 1 : weight[m - 1];
    fee[m] = cost * Math.abs(weight[m] - prev);
    managed[m] = weight[m] * excess[m] - fee[m];
  }
  return { c, split, weight, managed, fee };
}

export function backtestMonthly(
  rows,
  { cost = 0.001, rf = 0, minExposure = 0, maxExposure = Infinity, trainShare = 0.7, normalize = 'train', initial = 100000 } = {},
) {
  const list = monthlyTable(rows);
  const rfm = rf / 12;
  const excess = list.map((m) => m.ret - rfm);
  const rv = list.map((m) => m.rv);
  const out = volManage(excess, rv, { trainShare, normalize, minExposure, maxExposure, cost });

  const sl = (a) => a.slice(1);
  const bh = sl(list).map((m) => m.ret);
  const strat = sl(out.managed).map((x) => x + rfm);
  const vol = list.slice(0, -1).map((m) => Math.sqrt(m.rv * 12));
  return {
    mode: 'monthly',
    ...finish(
      sl(list).map((m) => ({ date: m.end })),
      out.c,
      sl(out.weight),
      bh,
      strat,
      sl(excess),
      sl(out.managed),
      sl(out.fee),
      vol,
      out.split - 1,
      rf,
      12,
      initial,
    ),
  };
}

export function backtest(rows, opts = {}) {
  if (opts.mode === 'monthly') return backtestMonthly(rows, opts);
  return backtestDaily(rows, opts);
}

export function describe(x) {
  const n = x.length;
  const m = mean(x);
  const s = sd(x);
  let m3 = 0, m4 = 0;
  for (const v of x) {
    const d = v - m;
    m3 += d ** 3;
    m4 += d ** 4;
  }
  m3 /= n;
  m4 /= n;
  const popSd = Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / n);
  const skewness = m3 / popSd ** 3;
  const excessKurtosis = m4 / popSd ** 4 - 3;
  const jarqueBera = (n / 6) * (skewness ** 2 + excessKurtosis ** 2 / 4);
  return {
    n,
    mean: m,
    sd: s,
    min: Math.min(...x),
    max: Math.max(...x),
    skewness,
    excessKurtosis,
    jarqueBera,
    jbPValue: Math.exp(-jarqueBera / 2),
  };
}

export function acf(x, maxLag) {
  const n = x.length;
  const m = mean(x);
  let c0 = 0;
  for (const v of x) c0 += (v - m) ** 2;
  const out = [];
  for (let k = 1; k <= maxLag; k++) {
    let ck = 0;
    for (let t = k; t < n; t++) ck += (x[t] - m) * (x[t - k] - m);
    out.push(ck / c0);
  }
  return out;
}

export function ljungBox(x, maxLag) {
  const n = x.length;
  const rho = acf(x, maxLag);
  let q = 0;
  rho.forEach((r, i) => (q += (r * r) / (n - (i + 1))));
  q *= n * (n + 2);
  return { q, df: maxLag, pValue: chi2Survival(q, maxLag) };
}

function chi2Survival(x, k) {
  return gammaUpper(k / 2, x / 2);
}

function gammaUpper(a, x) {
  if (x <= 0) return 1;
  const lnGamma = (z) => {
    const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = z, t = z + 5.5;
    t -= (z + 0.5) * Math.log(t);
    let ser = 1.000000000190015;
    for (const c of g) ser += c / ++y;
    return -t + Math.log((2.5066282746310005 * ser) / z);
  };
  const gln = lnGamma(a);
  if (x < a + 1) {
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 0; n < 500; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - gln);
  }
  let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - gln) * h;
}

export function drawdownSeries(returns) {
  let equity = 1;
  let peak = 1;
  return returns.map((r) => {
    equity *= 1 + r;
    peak = Math.max(peak, equity);
    return equity / peak - 1;
  });
}

function xirr(flows) {
  const t0 = flows[0].t;
  const f = (rate) => flows.reduce((a, c) => a + c.amount / (1 + rate) ** ((c.t - t0) / 365), 0);
  let lo = -0.99;
  let hi = 10;
  if (f(lo) * f(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

function drawdownOf(V, P0) {
  let peak = P0;
  return V.map((x) => {
    peak = Math.max(peak, x);
    return x / peak - 1;
  });
}

function drawdownEpisodesOf(dd, dates) {
  const out = [];
  let k = 0;
  while (k < dd.length) {
    if (!(dd[k] < 0)) {
      k++;
      continue;
    }
    const start = k;
    let trough = k;
    while (k < dd.length && dd[k] < 0) {
      if (dd[k] < dd[trough]) trough = k;
      k++;
    }
    const end = k;
    const recovered = end < dd.length;
    const peak = Math.max(start - 1, 0);
    out.push({
      peakDate: dates[peak],
      troughDate: dates[trough],
      endDate: recovered ? dates[end] : null,
      depth: dd[trough],
      tradingDaysToTrough: trough - peak,
      tradingDaysToRecover: recovered ? end - trough : null,
      tradingDaysUnder: end - start,
    });
  }
  return out;
}

const percentileOf = (sorted, q) => {
  const pos = (q / 100) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

function distOf(xs) {
  const s = [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    p50: percentileOf(s, 50),
    p75: percentileOf(s, 75),
    p90: percentileOf(s, 90),
    p99: percentileOf(s, 99),
    max: s[s.length - 1],
    min: s[0],
    mean: mean(xs),
  };
}

function paperDist(xs) {
  const d = distOf(xs);
  return { p50: d.p50, p75: d.p75, p90: d.p90, p99: d.p99, max: d.max, mean: d.mean };
}

function avgAbsChange(ws) {
  if (ws.length < 2) return null;
  let total = 0;
  for (let k = 1; k < ws.length; k++) total += Math.abs(ws[k] - ws[k - 1]);
  return total / (ws.length - 1);
}

function alphaAfterCostOf(alpha, avgW) {
  const at = (bp) => (avgW == null ? null : alpha - (bp / 10000) * avgW * 12);
  return { '1': at(1), '10': at(10), '14': at(14) };
}

function breakEvenBpOf(alpha, avgW) {
  return avgW == null || avgW === 0 || alpha <= 0 ? null : (alpha / (avgW * 12)) * 10000;
}

const VARIANT_SPECS = [
  { key: 'variance', label: 'Realized variance', scaling: 'variance', cap: null },
  { key: 'volatility', label: 'Realized volatility', scaling: 'volatility', cap: null },
  { key: 'variance_cap1_5', label: 'Variance, cap 1.5 (50% leverage)', scaling: 'variance', cap: 1.5 },
  { key: 'variance_cap1', label: 'Variance, no leverage', scaling: 'variance', cap: 1 },
];

function corr(x, y) {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

function slopeStats(y, x) {
  const o = ols(y, x);
  return { n: o.n, corr: corr(x, y), slope: o.beta, tSlope: o.tBeta, r2: o.r2 };
}

export function quintilesByLaggedVariance(excess, rv, groups = 5) {
  const idx = [];
  for (let t = 1; t < excess.length; t++) idx.push(t);
  idx.sort((a, b) => rv[a - 1] - rv[b - 1] || a - b);
  const base = Math.floor(idx.length / groups);
  const extra = idx.length % groups;
  const out = [];
  let at = 0;
  for (let g = 0; g < groups; g++) {
    const size = base + (g < extra ? 1 : 0);
    const members = idx.slice(at, at + size);
    at += size;
    const avgExcess = mean(members.map((t) => excess[t]));
    const avgRv = mean(members.map((t) => rv[t]));
    out.push({
      group: g + 1,
      n: size,
      avgLagRv: mean(members.map((t) => rv[t - 1])),
      avgRv,
      avgExcess,
      meanVarianceRatio: avgExcess / avgRv,
    });
  }
  return out;
}

export function paperStudy(rows, { rf = 0 } = {}) {
  const list = monthlyTable(rows);
  const rfm = rf / 12;
  const excess = list.map((m) => m.ret - rfm);
  const rv = list.map((m) => m.rv);
  return paperStudyFromMonthly(excess, rv, { keys: list.map((m) => m.key), rf });
}

export function paperStudyFromMonthly(excess, rv, { keys = null, rf = 0 } = {}) {
  const m = excess.length;
  const keyAt = (t) => (keys ? keys[t] : String(t));

  const persistence = {
    rv: slopeStats(rv.slice(1), rv.slice(0, -1)),
    logRv: slopeStats(rv.slice(1).map(Math.log), rv.slice(0, -1).map(Math.log)),
  };
  const predictability = slopeStats(excess.slice(1), rv.slice(0, -1));
  const nAll = m - 1;
  const dropped = Math.max(1, Math.floor(0.05 * nAll));
  const byLagRv = [];
  for (let t = 1; t < m; t++) byLagRv.push(t);
  byLagRv.sort((a, b) => rv[a - 1] - rv[b - 1] || a - b);
  const kept = byLagRv.slice(0, nAll - dropped);
  const predictabilityTrimmed = {
    trimmedShare: 0.05,
    dropped,
    ...slopeStats(kept.map((t) => excess[t]), kept.map((t) => rv[t - 1])),
  };
  const quintiles = quintilesByLaggedVariance(excess, rv);

  const main = volManage(excess, rv, { normalize: 'full', cost: 0 });
  const managed = main.managed.slice(1);
  const original = excess.slice(1);
  const test = paperTest(managed, original, 12);
  const sharpeManaged = (mean(managed) / sd(managed)) * Math.sqrt(12);
  const uncappedWeights = main.weight.slice(1);
  const paperAvgW = avgAbsChange(uncappedWeights);
  const paper = {
    ...test,
    c: main.c,
    sdOriginal: sd(original),
    sdManaged: sd(managed),
    sharpeManaged,
    sharpeIncrease: sharpeManaged / test.sharpeOriginal - 1,
    maxWeight: Math.max(...main.weight),
    meanWeight: mean(main.weight.slice(1)),
    weights: paperDist(uncappedWeights),
    avgAbsWeightChange: paperAvgW,
    expectedReturnAnnual: 12 * mean(managed),
    alphaAfterCost: alphaAfterCostOf(test.alphaAnnual, paperAvgW),
    breakEvenBp: breakEvenBpOf(test.alphaAnnual, paperAvgW),
  };

  const variants = VARIANT_SPECS.map((spec) => {
    const o = volManage(excess, rv, { normalize: 'full', cost: 0, scaling: spec.scaling, maxExposure: spec.cap ?? Infinity });
    const mg = o.managed.slice(1);
    const t = paperTest(mg, original, 12);
    const ws = o.weight.slice(1);
    const avgW = avgAbsChange(ws);
    return {
      key: spec.key,
      label: spec.label,
      cap: spec.cap,
      alphaAnnual: t.alphaAnnual,
      tAlpha: t.tAlpha,
      tAlphaRobust: t.tAlphaRobust,
      appraisalAnnual: t.appraisalAnnual,
      sharpeManaged: (mean(mg) / sd(mg)) * Math.sqrt(12),
      expectedReturnAnnual: 12 * mean(mg),
      avgAbsWeightChange: avgW,
      breakEvenBp: breakEvenBpOf(t.alphaAnnual, avgW),
      alphaAfterCost: alphaAfterCostOf(t.alphaAnnual, avgW),
      weights: paperDist(ws),
    };
  });

  const costs = [];
  for (const cap of [Infinity, 1.5, 1]) {
    for (const cost of [0, 0.0001, 0.001, 0.002]) {
      const o = volManage(excess, rv, { normalize: 'full', cost, maxExposure: cap });
      const mg = o.managed.slice(1);
      const t = paperTest(mg, original, 12);
      costs.push({
        cap: Number.isFinite(cap) ? cap : null,
        cost,
        alphaAnnual: t.alphaAnnual,
        tAlpha: t.tAlpha,
        appraisalAnnual: t.appraisalAnnual,
        avgTurnover: mean(o.weight.slice(2).map((w, i) => Math.abs(w - o.weight[i + 1]))),
      });
    }
  }

  return {
    n: m - 1,
    from: keyAt(1),
    to: keyAt(m - 1),
    rf,
    persistence,
    predictability,
    predictabilityTrimmed,
    quintiles,
    paper,
    variants,
    costs,
  };
}

export function isoDateOrNull(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && toIsoDate(value) === value ? value : null;
}

const monthKeyOf = (date) => date.slice(0, 7);

function prevMonthKeyOf(key) {
  const t = Number(key.slice(0, 4)) * 12 + (Number(key.slice(5, 7)) - 1) - 1;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}

function navOf(ret) {
  const nav = [1];
  for (let i = 1; i < ret.length; i++) nav.push(ret[i] === null ? nav[i - 1] : nav[i - 1] * (1 + ret[i]));
  return nav;
}

function cashFlowReturns(eq, flow) {
  return eq.map((e, i) => (i > 0 && eq[i - 1] > 0 ? (e - flow[i]) / eq[i - 1] - 1 : null));
}

function dcaLedger(D, P, contribAmt, costBps) {
  let shares = 0;
  let cash = 0;
  return P.map((price, i) => {
    cash += contribAmt[i];
    const buy = cash;
    const cost = (buy * costBps) / 10000;
    const bought = Math.max(buy - cost, 0) / price;
    shares += bought;
    cash = 0;
    const inIndex = shares * price;
    return { date: D[i], price, contribution: contribAmt[i], buy, cost, bought, shares, cash, inIndex, equity: inIndex + cash };
  });
}

function vmLedger(D, P, contribAmt, costBps, targetAt) {
  let shares = 0;
  let cash = 0;
  const days = [];
  const tradeList = [];
  for (let i = 0; i < P.length; i++) {
    const price = P[i];
    const contribution = contribAmt[i];
    cash += contribution;
    const target = targetAt(i);
    let trade = 0;
    let buy = 0;
    let sell = 0;
    let cost = 0;
    if (contribution > 0) {
      const currentValue = shares * price;
      const targetValue = (currentValue + cash) * target;
      trade = targetValue - currentValue;
      if (trade > 0) {
        buy = Math.min(trade, cash);
        cost = (buy * costBps) / 10000;
        shares += Math.max(buy - cost, 0) / price;
        cash -= buy;
      } else if (trade < 0) {
        sell = Math.min(-trade, currentValue);
        cost = (sell * costBps) / 10000;
        shares -= sell / price;
        cash += sell - cost;
      }
    }
    const inIndex = shares * price;
    const equity = inIndex + cash;
    if (Math.abs(trade) > 1e-9) {
      tradeList.push({
        date: D[i],
        side: trade > 0 ? 'buy' : 'sell',
        value: trade > 0 ? buy : sell,
        price,
        fee: cost,
        shareAfter: equity > 0 ? inIndex / equity : 0,
        target,
      });
    }
    days.push({ date: D[i], contribution, target, buy, sell, cost, shares, cash, inIndex, equity });
  }
  return { days, tradeList };
}

function ledgerInvestments(days, tradeList) {
  const contribDays = days.filter((d) => d.contribution > 0);
  const inIdx = days.map((d) => d.inIndex);
  const totalBought = days.reduce((a, d) => a + d.buy, 0);
  const totalSold = days.reduce((a, d) => a + d.sell, 0);
  const last = days[days.length - 1];
  return {
    contributions: contribDays.length,
    totalContributions: contribDays.reduce((a, d) => a + d.contribution, 0),
    rebalances: contribDays.length,
    trades: tradeList.length,
    buys: tradeList.filter((t) => t.side === 'buy').length,
    sells: tradeList.filter((t) => t.side === 'sell').length,
    totalBought,
    totalSold,
    turnover: totalBought + totalSold,
    fees: days.reduce((a, d) => a + d.cost, 0),
    averageTargetExposure: mean(contribDays.map((d) => d.target)),
    averageInIndex: mean(inIdx),
    peakInIndex: Math.max(...inIdx),
    lowestInIndex: Math.min(...inIdx),
    finalIndexValue: last.inIndex,
    cashLeft: last.cash,
  };
}

function dcaInvestments(led, monthly) {
  const totalBought = led.reduce((a, d) => a + d.buy, 0);
  const boughtShares = led.reduce((a, d) => a + d.bought, 0);
  const last = led[led.length - 1];
  return {
    purchases: led.filter((d) => d.contribution > 0).length,
    perPurchase: monthly,
    totalContributions: led.reduce((a, d) => a + d.contribution, 0),
    totalBought,
    fees: led.reduce((a, d) => a + d.cost, 0),
    totalShares: last.shares,
    averageBuyPrice: boughtShares > 0 ? totalBought / boughtShares : null,
    finalIndexValue: last.inIndex,
    cashLeft: last.cash,
  };
}

function planCore(D, eq, inIndex, flow, ret, cost) {
  const n = eq.length;
  const nav = navOf(ret);
  const dd = drawdownOf(nav, 1);
  const r = ret.filter((x) => x !== null);
  const growth = nav[n - 1];
  const years = r.length / 252;
  const cagr = years > 0 && growth > 0 ? growth ** (1 / years) - 1 : NaN;
  const annVol = r.length > 1 ? sd(r) * Math.sqrt(252) : NaN;
  const sharpe = annVol > 0 ? (mean(r) * 252) / annVol : NaN;
  const maxDrawdown = dd.reduce((a, x) => Math.min(a, x), 0);
  let trough = 0;
  for (let i = 1; i < n; i++) if (dd[i] < dd[trough]) trough = i;
  const episodes = drawdownEpisodesOf(dd, D);
  const contributions = flow.reduce((a, x) => a + x, 0);
  const shareOf = eq.map((e, i) => (e > 0 ? inIndex[i] / e : 0));
  const flows = [];
  flow.forEach((f, i) => {
    if (f > 0) flows.push({ t: Date.parse(D[i]) / 86400000, amount: -f });
  });
  flows.push({ t: Date.parse(D[n - 1]) / 86400000, amount: eq[n - 1] });
  return {
    metrics: {
      endingEquity: eq[n - 1],
      totalContributions: contributions,
      profit: eq[n - 1] - contributions,
      twrCumulative: growth - 1,
      twrCagr: cagr,
      annVol,
      sharpe,
      maxDrawdown,
      calmar: maxDrawdown === 0 ? null : cagr / Math.abs(maxDrawdown),
      troughDate: dd[trough] < 0 ? D[trough] : null,
      longestUnderwaterDays: episodes.reduce((a, e) => Math.max(a, e.tradingDaysUnder), 0),
      drawdownEpisodes: [...episodes].sort((a, b) => a.depth - b.depth).slice(0, 3),
      worstDay: Math.min(...r),
      bestDay: Math.max(...r),
      avgExposure: mean(shareOf),
      costTotal: cost.reduce((a, x) => a + x, 0),
      moneyWeightedReturn: xirr(flows),
    },
    dd,
    shareOf,
  };
}

export function dcaVsVm(rows, { monthly = 10000, maxExposure = 1, costBps = 0 } = {}) {
  if (!(monthly > 0)) throw new Error('monthly_amount must be positive.');
  if (!(maxExposure > 0 && maxExposure <= 1)) throw new Error('max_exposure must be in (0, 1].');
  if (!(costBps >= 0)) throw new Error('cost_bps cannot be negative.');
  if (rows.length < 30) throw new Error(`Only ${rows.length} valid rows found; check CSV columns/date format.`);

  const D = rows.map((r) => r.date);
  const P = rows.map((r) => r.close);
  const n = P.length;
  const contribAmt = D.map((d, i) => (i === 0 || monthKeyOf(d) !== monthKeyOf(D[i - 1]) ? monthly : 0));
  const indexRet = P.map((p, i) => (i === 0 ? 0 : p / P[i - 1] - 1));

  const months = [];
  const monthRv = new Map();
  D.forEach((d, i) => {
    const k = monthKeyOf(d);
    if (!monthRv.has(k)) {
      monthRv.set(k, 0);
      months.push(k);
    }
    monthRv.set(k, monthRv.get(k) + indexRet[i] * indexRet[i]);
  });

  const targetOf = new Map();
  const priorRaw = [];
  for (const k of months) {
    const rv = monthRv.get(prevMonthKeyOf(k));
    const raw = rv !== undefined && rv > 0 ? 1 / rv : null;
    targetOf.set(k, raw !== null && priorRaw.length ? Math.min(raw / mean(priorRaw), maxExposure) : 0);
    if (raw !== null) priorRaw.push(raw);
  }
  const priorRv = D.map((d) => {
    const rv = monthRv.get(prevMonthKeyOf(monthKeyOf(d)));
    return rv === undefined ? null : rv;
  });
  const targetAt = (i) => targetOf.get(monthKeyOf(D[i]));

  const dca = dcaLedger(D, P, contribAmt, costBps);
  const vm = vmLedger(D, P, contribAmt, costBps, targetAt);
  const dcaEq = dca.map((d) => d.equity);
  const vmEq = vm.days.map((d) => d.equity);
  const dcaRet = cashFlowReturns(dcaEq, contribAmt);
  const vmRet = cashFlowReturns(vmEq, contribAmt);
  const dcaCore = planCore(D, dcaEq, dca.map((d) => d.inIndex), contribAmt, dcaRet, dca.map((d) => d.cost));
  const vmCore = planCore(D, vmEq, vm.days.map((d) => d.inIndex), contribAmt, vmRet, vm.days.map((d) => d.cost));
  const vmInv = ledgerInvestments(vm.days, vm.tradeList);

  const share = vmInv.averageTargetExposure;
  const ctl = vmLedger(D, P, contribAmt, costBps, () => share);
  const ctlEq = ctl.days.map((d) => d.equity);
  const ctlRet = cashFlowReturns(ctlEq, contribAmt);
  const ctlCore = planCore(D, ctlEq, ctl.days.map((d) => d.inIndex), contribAmt, ctlRet, ctl.days.map((d) => d.cost));
  const ctlInv = ledgerInvestments(ctl.days, ctl.tradeList);

  const daily = D.map((date, i) => ({
    date,
    price: P[i],
    indexReturn: indexRet[i],
    priorMonthRv: priorRv[i],
    vmTarget: vm.days[i].target,
    contribution: contribAmt[i],
    dcaEquity: dcaEq[i],
    vmEquity: vmEq[i],
    dcaCash: dca[i].cash,
    vmCash: vm.days[i].cash,
    dcaShares: dca[i].shares,
    vmShares: vm.days[i].shares,
    dcaCost: dca[i].cost,
    vmCost: vm.days[i].cost,
    dcaReturn: dcaRet[i],
    vmReturn: vmRet[i],
  }));

  const series = D.map((date, i) => ({
    date,
    price: P[i],
    priorMonthVol: priorRv[i] === null ? null : Math.sqrt(priorRv[i] * 12),
    vmTarget: vm.days[i].target,
    dcaEquity: dcaEq[i],
    vmEquity: vmEq[i],
    ctlEquity: ctlEq[i],
    dcaShare: dcaCore.shareOf[i],
    vmShare: vmCore.shareOf[i],
    ctlShare: ctlCore.shareOf[i],
    dcaDd: dcaCore.dd[i],
    vmDd: vmCore.dd[i],
    ctlDd: ctlCore.dd[i],
    contribution: contribAmt[i],
    dcaBuy: dca[i].buy,
    vmTrade: vm.days[i].buy - vm.days[i].sell,
  }));

  return {
    params: { monthly, maxExposure, costBps },
    period: { from: D[0], to: D[n - 1], days: n, months: months.length, indexChange: P[n - 1] / P[0] - 1 },
    daily,
    metrics: {
      dca: {
        ...dcaCore.metrics,
        investments: dcaInvestments(dca, monthly),
        purchaseList: dca.filter((d) => d.buy > 0).map((d) => ({ date: d.date, amount: d.buy, price: d.price, fee: d.cost, shares: d.bought })),
      },
      vm: { ...vmCore.metrics, investments: vmInv, tradeList: vm.tradeList },
    },
    control: { share, ...ctlCore.metrics, investments: ctlInv, tradeList: ctl.tradeList },
    timingEffect: {
      endingEquityDiff: vmCore.metrics.endingEquity - ctlCore.metrics.endingEquity,
      sharpeDiff: vmCore.metrics.sharpe - ctlCore.metrics.sharpe,
      maxDrawdownDiff: vmCore.metrics.maxDrawdown - ctlCore.metrics.maxDrawdown,
      twrCagrDiff: vmCore.metrics.twrCagr - ctlCore.metrics.twrCagr,
    },
    series,
  };
}
