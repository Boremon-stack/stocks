export const WINDOW = 20;

export function parseCsv(text) {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const cols = header.split(',').map((c) => c.trim().toLowerCase());
  const dateCol = cols.indexOf('date');
  const closeCol = cols.indexOf('close');
  if (dateCol < 0 || closeCol < 0) throw new Error('CSV needs date and close columns');
  return lines
    .filter((l) => l.trim())
    .map((line) => {
      const v = line.split(',');
      return { date: v[dateCol].trim(), close: Number(v[closeCol]) };
    })
    .filter((d) => Number.isFinite(d.close) && d.close > 0);
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

function finish(rows, c, weight, bh, strat, split, rf, periodsPerYear) {
  const idx = rows.map((_, i) => i);
  const ins = idx.filter((i) => i < split);
  const oos = idx.filter((i) => i >= split);
  const pick = (arr, ids) => ids.map((i) => arr[i]);
  return {
    c,
    split,
    series: rows.map((r, i) => ({ date: r.date, bh: bh[i], strat: strat[i], weight: weight[i] })),
    insample: {
      buyHold: summarize(pick(bh, ins), { rf, periodsPerYear }),
      strategy: summarize(pick(strat, ins), { rf, periodsPerYear }),
    },
    outOfSample: {
      buyHold: summarize(pick(bh, oos), { rf, periodsPerYear }),
      strategy: summarize(pick(strat, oos), { rf, periodsPerYear }),
    },
  };
}

export function backtestDaily(rows, { cost = 0.001, rf = 0, maxExposure = 1, trainShare = 0.7 } = {}) {
  const closes = rows.map((d) => d.close);
  const r = dailyReturns(closes);
  const v = rollingVariance(r);
  const start = WINDOW;
  const split = start + Math.floor((rows.length - start) * trainShare);

  let sumV = 0;
  for (let t = start; t < split; t++) sumV += v[t];
  const c = sumV / (split - start);

  const weight = new Array(rows.length).fill(0);
  for (let t = start; t < rows.length - 1; t++) weight[t + 1] = Math.min(maxExposure, c / v[t]);

  const from = start + 1;
  const bh = r.slice(from);
  const w = weight.slice(from);
  const strat = bh.map((x, i) => w[i] * x - cost * Math.abs(w[i] - (i ? w[i - 1] : 0)));
  const kept = rows.slice(from);
  return { mode: 'daily', ...finish(kept, c, w, bh, strat, split - from, rf, 252) };
}

export function backtestMonthly(rows, { cost = 0.001, rf = 0, maxExposure = Infinity, trainShare = 0.7 } = {}) {
  const months = new Map();
  let prevClose = null;
  for (const row of rows) {
    const key = row.date.slice(0, 7);
    let m = months.get(key);
    if (!m) {
      m = { key, first: prevClose ?? row.close, last: row.close, rv: 0, end: row.date };
      months.set(key, m);
    }
    if (prevClose != null) {
      const x = row.close / prevClose - 1;
      m.rv += x * x;
    }
    m.last = row.close;
    m.end = row.date;
    prevClose = row.close;
  }
  const list = [...months.values()];
  const ret = list.map((m) => m.last / m.first - 1);
  const rv = list.map((m) => m.rv);

  const start = 1;
  const n = list.length - start;
  const split = start + Math.floor(n * trainShare);
  const raw = [];
  for (let m = start; m < list.length; m++) raw.push(rv[m - 1] > 0 ? 1 / rv[m - 1] : 0);

  let trainRaw = [];
  let trainRet = [];
  for (let m = start; m < split; m++) {
    trainRaw.push(raw[m - start] * ret[m]);
    trainRet.push(ret[m]);
  }
  const c = sd(trainRet) / sd(trainRaw);

  const weight = list.map(() => 0);
  const bh = list.map(() => 0);
  const strat = list.map(() => 0);
  for (let m = start; m < list.length; m++) {
    weight[m] = Math.min(maxExposure, c * raw[m - start]);
    bh[m] = ret[m];
    const prev = m === start ? 1 : weight[m - 1];
    strat[m] = weight[m] * ret[m] - cost * Math.abs(weight[m] - prev);
  }

  const kept = list.map((m, i) => ({ date: m.end, close: m.last }));
  const sliced = (arr) => arr.slice(start);
  const out = finish(
    kept.slice(start),
    c,
    sliced(weight),
    sliced(bh),
    sliced(strat),
    split - start,
    rf,
    12,
  );
  return { mode: 'monthly', ...out };
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
