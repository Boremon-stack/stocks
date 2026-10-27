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

export function startIndexFor(rows, months, window, explicitStart = null) {
  const last = rows[rows.length - 1].date;
  const total = Number(last.slice(0, 4)) * 12 + (Number(last.slice(5, 7)) - 1) - (months - 1);
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const startDate = explicitStart ?? `${y}-${String(m).padStart(2, '0')}-01`;
  let s0 = rows.findIndex((d) => d.date >= startDate);
  if (s0 < 0) s0 = rows.length - 1;
  return { s0: Math.max(s0, window), requested: startDate, moved: s0 < window };
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

function planMetrics(V, dd, share, P0, dates, fees, rfd, indexGain, interest) {
  const L = V.length;
  const rho = [];
  for (let k = 1; k < L; k++) rho.push(V[k] / V[k - 1] - 1);
  const final = V[L - 1];
  const years = (Date.parse(dates[L - 1]) - Date.parse(dates[0])) / 86400000 / 365.25;
  const meanDaily = mean(rho);
  const sdDaily = sd(rho);
  const cagr = (final / P0) ** (1 / years) - 1;
  const maxDrawdown = dd.reduce((a, x) => Math.min(a, x), 0);
  const episodes = drawdownEpisodesOf(dd, dates);
  const longestUnderwaterDays = episodes.reduce((a, e) => Math.max(a, e.tradingDaysUnder), 0);
  const deepest = [...episodes].sort((a, b) => a.depth - b.depth).slice(0, 3);
  return {
    final,
    profit: final - P0,
    returnPct: final / P0 - 1,
    cagr,
    annVol: sdDaily * Math.sqrt(252),
    sharpe: sdDaily === 0 ? 0 : ((meanDaily - rfd) / sdDaily) * Math.sqrt(252),
    calmar: maxDrawdown === 0 ? null : cagr / Math.abs(maxDrawdown),
    sharpeParts: { meanDaily, sdDaily, rfd, years, annReturnArithmetic: meanDaily * 252 },
    maxDrawdown,
    troughDate: deepest.length ? deepest[0].troughDate : null,
    longestUnderwaterDays,
    worstDay: rho.reduce((a, x) => Math.min(a, x), Infinity),
    bestDay: rho.reduce((a, x) => Math.max(a, x), -Infinity),
    avgExposure: mean(share),
    costTotal: fees,
    drawdownEpisodes: deepest,
    components: { indexGain, interest, costs: fees },
  };
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

function isResetDay(D, s0, rebalance, i) {
  return i >= s0 && i <= D.length - 2 && (i === s0 || rebalance === 'daily' || D[i + 1].slice(0, 7) !== D[i].slice(0, 7));
}

function runLedger(P, D, s0, pool, cost, rfd, rebalance, shareAt) {
  const last = P.length - 1;
  let cash = pool;
  let units = 0;
  let fees = 0;
  let interest = 0;
  let indexGain = 0;
  let resets = 0;
  let totalBought = 0;
  let totalSold = 0;
  let buys = 0;
  let sells = 0;
  const tradeList = [];
  const decisionDays = [];
  const days = [];
  for (let i = s0; i <= last; i++) {
    const p = P[i];
    if (i > s0) {
      const iv = cash * rfd;
      cash += iv;
      interest += iv;
      indexGain += units * (p - P[i - 1]);
    }
    let trade = 0;
    let fee = 0;
    if (isResetDay(D, s0, rebalance, i)) {
      resets++;
      decisionDays.push(i);
      const V = cash + units * p;
      const target = shareAt(i) * V;
      const current = units * p;
      const delta = target - current;
      if (Math.abs(delta) >= 1e-9) {
        let a;
        let side;
        if (delta > 0) {
          a = Math.min(delta, cash / (1 + cost));
          fee = cost * a;
          units += a / p;
          cash -= a + fee;
          side = 'buy';
          totalBought += a;
          buys++;
          trade = a;
        } else {
          a = -delta;
          fee = cost * a;
          units -= a / p;
          cash += a - fee;
          side = 'sell';
          totalSold += a;
          sells++;
          trade = -a;
        }
        fees += fee;
        tradeList.push({ date: D[i], side, amount: a, price: p, fee, units: a / p, shareAfter: (units * p) / (cash + units * p) });
      }
    }
    const value = cash + units * p;
    days.push({ value, inIndex: units * p, share: (units * p) / value, trade, fee });
  }
  const inV = days.map((d) => d.inIndex);
  const shV = days.map((d) => d.share);
  const investments = {
    trades: tradeList.length,
    buys,
    sells,
    totalBought,
    totalSold,
    netPutIn: totalBought - totalSold,
    turnover: totalBought + totalSold,
    fees,
    averageInIndex: mean(inV),
    peakInIndex: inV.reduce((a, x) => Math.max(a, x), -Infinity),
    lowestInIndex: inV.reduce((a, x) => Math.min(a, x), Infinity),
    finalIndexValue: units * P[last],
    cashLeft: cash,
    resets,
    averageShare: mean(shV),
  };
  return { days, decisionDays, tradeList, investments, indexGain, interest, fees };
}

export function compareSipVsVol(
  rows,
  {
    pool = 1000000,
    sip = 10000,
    window = WINDOW,
    minExposure = 0,
    maxExposure = 1,
    cost = 0.001,
    cashRate = 0,
    months = 60,
    rebalance = 'monthly',
    startDate = null,
    scaling = 'variance',
    calibration = 'paper',
  } = {},
) {
  if (scaling !== 'variance' && scaling !== 'volatility') throw new Error(`unknown scaling: ${scaling}`);
  if (calibration !== 'paper' && calibration !== 'average') throw new Error(`unknown calibration: ${calibration}`);
  const n = rows.length;
  const P = rows.map((d) => d.close);
  const D = rows.map((d) => d.date);
  const month = (i) => D[i].slice(0, 7);
  const r = [NaN];
  for (let i = 1; i < n; i++) r.push(P[i] / P[i - 1] - 1);
  const v = new Array(n).fill(NaN);
  for (let t = window; t < n; t++) {
    let s = 0;
    for (let i = t - window + 1; i <= t; i++) s += r[i] * r[i];
    v[t] = s / window;
  }
  const cbar = new Array(n).fill(NaN);
  let vSum = 0;
  for (let t = window; t < n; t++) {
    vSum += v[t];
    cbar[t] = vSum / (t - window + 1);
  }
  const rfd = cashRate / 252;
  const { s0, requested, moved } = startIndexFor(rows, months, window, startDate);
  const lo = Math.min(minExposure, maxExposure);
  const hi = maxExposure;
  const last = n - 1;
  const rawOf = (t) => (scaling === 'volatility' ? 1 / Math.sqrt(v[t]) : 1 / v[t]);

  let c = NaN;
  if (calibration === 'paper') {
    const fs = [];
    const gs = [];
    let R = s0;
    for (let s = s0 + 1; s < n; s++) {
      if (isResetDay(D, s0, rebalance, s - 1)) R = s - 1;
      if (!(v[R] > 0)) continue;
      const f = r[s] - rfd;
      fs.push(f);
      gs.push(rawOf(R) * f);
    }
    c = sd(fs) / sd(gs);
  }
  const uncapped = (t) => {
    if (v[t] === 0) return Infinity;
    if (calibration === 'paper') return c * rawOf(t);
    const q = cbar[t] / v[t];
    return scaling === 'volatility' ? Math.sqrt(q) : q;
  };
  const shareAt = (t) => clamp(uncapped(t), lo, hi);

  const volLedger = runLedger(P, D, s0, pool, cost, rfd, rebalance, shareAt);
  const ctlShare = clamp(volLedger.investments.averageShare, lo, hi);
  const ctlLedger = runLedger(P, D, s0, pool, cost, rfd, rebalance, () => ctlShare);

  let cashS = pool;
  let unitsS = 0;
  let feesS = 0;
  let interestS = 0;
  let indexGainS = 0;
  let totalPutIn = 0;
  const purchaseList = [];
  const flows = [];
  const sipDays = [];
  for (let i = s0; i < n; i++) {
    const p = P[i];
    if (i > s0) {
      const isInt = cashS * rfd;
      cashS += isInt;
      interestS += isInt;
      indexGainS += unitsS * (p - P[i - 1]);
    }
    let sipBuy = 0;
    let sipFee = 0;
    if (i === s0 || month(i) !== month(i - 1)) {
      const a = Math.min(sip, cashS / (1 + cost));
      sipFee = cost * a;
      unitsS += a / p;
      cashS -= a + sipFee;
      feesS += sipFee;
      totalPutIn += a;
      sipBuy = a;
      purchaseList.push({ date: D[i], amount: a, price: p, fee: sipFee, units: a / p });
      flows.push({ t: Date.parse(D[i]) / 86400000, amount: -(a + sipFee) });
    }
    const valS = cashS + unitsS * p;
    sipDays.push({ value: valS, inIndex: unitsS * p, share: (unitsS * p) / valS, buy: sipBuy, fee: sipFee });
  }

  const dates = D.slice(s0);
  const Vv = volLedger.days.map((d) => d.value);
  const Vs = sipDays.map((d) => d.value);
  const Vc = ctlLedger.days.map((d) => d.value);
  const ddV = drawdownOf(Vv, pool);
  const ddS = drawdownOf(Vs, pool);
  const ddC = drawdownOf(Vc, pool);

  const volMetrics = planMetrics(Vv, ddV, volLedger.days.map((d) => d.share), pool, dates, volLedger.fees, rfd, volLedger.indexGain, volLedger.interest);
  const sipMetrics = planMetrics(Vs, ddS, sipDays.map((d) => d.share), pool, dates, feesS, rfd, indexGainS, interestS);
  const ctlMetrics = planMetrics(Vc, ddC, ctlLedger.days.map((d) => d.share), pool, dates, ctlLedger.fees, rfd, ctlLedger.indexGain, ctlLedger.interest);

  const sipFlows = [...flows, { t: Date.parse(D[last]) / 86400000, amount: unitsS * P[last] }];
  const sipInvestments = {
    purchases: purchaseList.length,
    perPurchase: sip,
    totalPutIn,
    fees: feesS,
    units: unitsS,
    averageBuyPrice: totalPutIn / unitsS,
    finalIndexValue: unitsS * P[last],
    cashLeft: cashS,
    moneyWeightedReturn: xirr(sipFlows),
  };

  const decided = volLedger.decisionDays.map(uncapped);
  const capped = decided.map((x) => clamp(x, lo, hi));
  const weights = {
    count: decided.length,
    uncapped: distOf(decided),
    capped: distOf(capped),
    shareAtCap: decided.filter((x) => x >= hi).length / decided.length,
  };
  const avgAbsWeightChange = avgAbsChange(capped);

  const diff = (a, b) => (a == null || b == null ? null : a - b);
  const timingEffect = {
    finalDiff: volMetrics.final - ctlMetrics.final,
    sharpeDiff: volMetrics.sharpe - ctlMetrics.sharpe,
    maxDrawdownDiff: volMetrics.maxDrawdown - ctlMetrics.maxDrawdown,
    calmarDiff: diff(volMetrics.calmar, ctlMetrics.calmar),
  };

  const series = Vv.map((value, k) => {
    const i = s0 + k;
    return {
      date: D[i],
      close: P[i],
      vol: Math.sqrt(v[i] * 252),
      volWeight: volLedger.days[k].share,
      sipExposure: sipDays[k].share,
      volInIndex: volLedger.days[k].inIndex,
      sipInIndex: sipDays[k].inIndex,
      sipValue: sipDays[k].value,
      volValue: value,
      sipCost: sipDays[k].fee,
      volCost: volLedger.days[k].fee,
      volTrade: volLedger.days[k].trade,
      sipBuy: sipDays[k].buy,
      ctlValue: Vc[k],
      ctlInIndex: ctlLedger.days[k].inIndex,
      volDd: ddV[k],
      sipDd: ddS[k],
      ctlDd: ddC[k],
    };
  });

  const rhoV = Vv.slice(1).map((x, k) => x / Vv[k] - 1);
  const L = Vv.length;
  const regression = L - 1 > 30
    ? paperTest(
        rhoV.map((x) => x - rfd),
        Array.from({ length: L - 1 }, (_, j) => r[s0 + 1 + j] - rfd),
        252,
      )
    : null;

  return {
    c: calibration === 'paper' ? c : null,
    params: { pool, sip, window, minExposure: lo, maxExposure, cost, cashRate, months, rebalance, scaling, calibration },
    period: {
      from: D[s0],
      to: D[last],
      days: n - s0,
      requested,
      moved,
      niftyChange: P[last] / P[s0] - 1,
    },
    sip: { ...sipMetrics, investments: sipInvestments, purchaseList },
    vol: { ...volMetrics, investments: volLedger.investments, tradeList: volLedger.tradeList, weights, avgAbsWeightChange },
    control: { share: ctlShare, ...ctlMetrics, investments: ctlLedger.investments, tradeList: ctlLedger.tradeList },
    timingEffect,
    regression,
    series,
  };
}

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
