const pad = (n) => String(n).padStart(2, '0');

function firstEligible(rows, months, startDate) {
  const n = rows.length;
  let start = startDate;
  if (start == null) {
    const last = rows[n - 1].date;
    const total = Number(last.slice(0, 4)) * 12 + (Number(last.slice(5, 7)) - 1) - (months - 1);
    start = `${Math.floor(total / 12)}-${pad((total % 12) + 1)}-01`;
  }
  const s = rows.findIndex((d) => d.date >= start);
  return s < 0 ? n - 1 : s;
}

const sd = (xs, m) => {
  let ss = 0;
  for (let k = 0; k < xs.length; k++) ss += (xs[k] - m) * (xs[k] - m);
  return Math.sqrt(ss / (xs.length - 1));
};

export function precompute(rows, opts = {}) {
  const windows = Array.from(opts.windows ?? []);
  if (!windows.length) throw new Error('precompute: no windows');
  const scaling = opts.scaling ?? 'variance';
  if (scaling !== 'variance' && scaling !== 'volatility') throw new Error(`unknown scaling: ${scaling}`);
  const rebalance = opts.rebalance ?? 'monthly';
  const cashRate = opts.cashRate ?? 0;
  const rfd = cashRate / 252;
  const months = opts.months ?? 60;
  const startDate = opts.startDate ?? '2019-01-02';
  const n = rows.length;
  const D = new Array(n);
  const P = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    D[i] = rows[i].date;
    P[i] = rows[i].close;
  }
  const r = new Float64Array(n);
  r[0] = NaN;
  for (let i = 1; i < n; i++) r[i] = P[i] / P[i - 1] - 1;
  const month = (i) => D[i].slice(0, 7);
  const base = firstEligible(rows, months, startDate);
  const nW = windows.length;
  const s0 = new Int32Array(nW);
  const c = new Float64Array(nW);
  const U = [];
  const flags = [];
  const F = new Float64Array(n);
  const G = new Float64Array(n);

  for (let k = 0; k < nW; k++) {
    const w = windows[k];
    if (!Number.isInteger(w) || w < 1) throw new Error(`precompute: bad window ${w}`);
    const st = Math.max(base, w);
    s0[k] = st;

    const v = new Float64Array(n).fill(NaN);
    for (let t = w; t < n; t++) {
      let s = 0;
      for (let i = t - w + 1; i <= t; i++) s += r[i] * r[i];
      v[t] = s / w;
    }

    const fl = new Uint8Array(n);
    for (let i = st; i <= n - 2; i++) {
      if (i === st || rebalance === 'daily' || month(i + 1) !== month(i)) fl[i] = 1;
    }

    const raw = (t) => (scaling === 'volatility' ? 1 / Math.sqrt(v[t]) : 1 / v[t]);
    let m = 0;
    let R = st;
    for (let s = st + 1; s < n; s++) {
      const rw = raw(R);
      if (Number.isFinite(rw)) {
        const f = r[s] - rfd;
        F[m] = f;
        G[m] = rw * f;
        m++;
      }
      if (fl[s]) R = s;
    }
    if (m < 2) throw new Error('precompute: not enough days to calibrate c');
    let mF = 0;
    let mG = 0;
    for (let q = 0; q < m; q++) {
      mF += F[q];
      mG += G[q];
    }
    mF /= m;
    mG /= m;
    const sdG = sd(G.subarray(0, m), mG);
    const ck = sdG > 0 ? sd(F.subarray(0, m), mF) / sdG : 0;
    c[k] = ck;

    const Uk = new Float64Array(n);
    for (let t = 0; t < n; t++) {
      if (t < w) {
        Uk[t] = NaN;
        continue;
      }
      const rw = raw(t);
      Uk[t] = rw === Infinity ? Infinity : ck * rw;
    }
    U.push(Uk);
    flags.push(fl);
  }

  return {
    n,
    dates: D,
    P,
    r,
    windows,
    s0,
    c,
    U,
    flags,
    scaling,
    rebalance,
    rfd,
    cashRate,
    pool: opts.pool ?? 1000000,
    cost: opts.cost ?? 0.001,
    minExposure: opts.minExposure ?? 0,
    scratch: new Float64Array(n),
  };
}

export function cell(pre, k, hi, opts = {}) {
  const pool = opts.pool ?? pre.pool;
  const cost = opts.cost ?? pre.cost;
  const minExposure = opts.minExposure ?? pre.minExposure;
  const { n, P, rfd } = pre;
  const s0 = pre.s0[k];
  const U = pre.U[k];
  const fl = pre.flags[k];
  const lo = Math.min(minExposure, hi);
  const rho = pre.scratch;
  let cash = pool;
  let units = 0;
  let peak = pool;
  let maxDd = 0;
  let trades = 0;
  let prev = pool;
  let V = pool;
  let m = 0;

  for (let i = s0; i < n; i++) {
    const p = P[i];
    if (i > s0) cash += cash * rfd;
    if (fl[i]) {
      const target = Math.min(hi, Math.max(lo, U[i])) * (cash + units * p);
      const delta = target - units * p;
      if (Math.abs(delta) >= 1e-9) {
        if (delta > 0) {
          const a = Math.min(delta, cash / (1 + cost));
          units += a / p;
          cash -= a + cost * a;
        } else {
          const a = -delta;
          units -= a / p;
          cash += a - cost * a;
        }
        trades++;
      }
    }
    V = cash + units * p;
    if (i > s0) rho[m++] = V / prev - 1;
    prev = V;
    if (V > peak) peak = V;
    const dd = V / peak - 1;
    if (dd < maxDd) maxDd = dd;
  }

  let sum = 0;
  for (let q = 0; q < m; q++) sum += rho[q];
  const meanDaily = sum / m;
  const sdDaily = sd(rho.subarray(0, m), meanDaily);
  const sharpe = sdDaily === 0 ? 0 : ((meanDaily - rfd) / sdDaily) * Math.sqrt(252);
  return { final: V, sharpe, maxDrawdown: maxDd, trades };
}
