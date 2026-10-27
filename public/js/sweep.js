import { compareSipVsVol } from './backtest.js';
import { precompute, cell } from './sweep-cpu.js';
import { gpuSupported, runGpu } from './sweep-gpu.js';
import { inr, pct } from './chart.js';

const DEFAULT_START = '2019-01-02';
const CPU_WORKER_MAX = 8;
const TRIAL_MIN_CELLS = 600;
const TRIAL_FRACTION = 0.15;
const SPEED_SUBSET_CELLS = 1000;

export function defaultGrid() {
  const windows = [];
  for (let w = 5; w <= 250; w++) windows.push(w);
  const caps = [];
  for (let i = 0; i <= 140; i++) caps.push(Math.round((0.3 + i * 0.005) * 1000) / 1000);
  return { windows, caps };
}

function spread(lo, hi, count, digits) {
  const out = [];
  const f = 10 ** digits;
  for (let i = 0; i < count; i++) out.push(Math.round((lo + (i * (hi - lo)) / (count - 1)) * f) / f);
  return out;
}

const GRIDS = {
  small: () => ({ windows: spread(5, 250, 16, 0), caps: spread(0.3, 1, 11, 2) }),
  medium: () => ({ windows: spread(5, 250, 61, 0), caps: spread(0.3, 1, 36, 2) }),
  full: () => defaultGrid(),
};

function normOpts(o = {}) {
  return {
    pool: o.pool ?? 1000000,
    cost: o.cost ?? 0.001,
    cashRate: o.cashRate ?? 0,
    scaling: o.scaling ?? 'variance',
    minExposure: o.minExposure ?? 0,
    startDate: o.startDate ?? DEFAULT_START,
    months: o.months ?? 60,
    rebalance: o.rebalance ?? 'monthly',
  };
}

const slimRows = (rows) => rows.map((d) => ({ date: d.date, close: d.close }));

function toCells(out, count) {
  const cells = new Array(count);
  for (let j = 0; j < count; j++) {
    cells[j] = { final: out[j * 4], sharpe: out[j * 4 + 1], maxDrawdown: out[j * 4 + 2], trades: out[j * 4 + 3] };
  }
  return cells;
}

function runChunk(rows, windows, caps, opts, a, b) {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') {
      reject(new Error('Web Workers are not available'));
      return;
    }
    const worker = new Worker(new URL('./sweep-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      worker.terminate();
      if (e.data.error) reject(new Error(e.data.error));
      else resolve({ start: e.data.start, out: e.data.out });
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'worker failed'));
    };
    worker.postMessage({ rows: slimRows(rows), windows, caps, opts, range: [a, b] });
  });
}

async function runOnGpu(rows, windows, caps, opts) {
  if (!gpuSupported()) throw new Error('WebGL2 with EXT_color_buffer_float is not available');
  const pre = precompute(rows, { ...opts, windows });
  const out = await runGpu(pre, windows, caps, opts);
  return { cells: toCells(out, windows.length * caps.length), label: 'GPU (WebGL2, float32)' };
}

async function runOnWorkers(rows, windows, caps, opts) {
  const total = windows.length * caps.length;
  const hc = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  const k = Math.max(1, Math.min(CPU_WORKER_MAX, hc, total));
  const chunk = Math.ceil(total / k);
  const jobs = [];
  for (let j = 0; j < k; j++) {
    const a = j * chunk;
    const b = Math.min(total, a + chunk);
    if (a < b) jobs.push(runChunk(rows, windows, caps, opts, a, b));
  }
  const parts = await Promise.all(jobs);
  const cells = new Array(total);
  for (const { start, out } of parts) {
    const count = out.length / 4;
    for (let j = 0; j < count; j++) {
      cells[start + j] = { final: out[j * 4], sharpe: out[j * 4 + 1], maxDrawdown: out[j * 4 + 2], trades: out[j * 4 + 3] };
    }
  }
  return { cells, label: `CPU workers x ${jobs.length} (float64)` };
}

function runOnMain(rows, windows, caps, opts) {
  const pre = precompute(rows, { ...opts, windows });
  const nC = caps.length;
  const cells = new Array(windows.length * nC);
  for (let wi = 0; wi < windows.length; wi++) {
    for (let ci = 0; ci < nC; ci++) cells[wi * nC + ci] = cell(pre, wi, caps[ci]);
  }
  return { cells, label: 'CPU (float64)' };
}

const BACKEND_NAMES = {
  gpu: 'GPU (WebGL2, float32)',
  'cpu-workers': 'CPU workers (float64)',
  cpu: 'CPU, main thread (float64)',
};

const autoWinners = new Map();

function sizeClass(total) {
  const step = total < 10000 ? 1000 : total < 100000 ? 10000 : 100000;
  return Math.max(step, Math.round(total / step) * step);
}

function pickEven(list, k) {
  if (list.length <= k) return list;
  const out = [];
  for (let i = 0; i < k; i++) out.push(list[Math.round((i * (list.length - 1)) / (k - 1))]);
  return out;
}

function trialGrid(W, C, cells) {
  const nC = Math.min(C.length, 24);
  const nW = Math.min(W.length, Math.round(cells / nC));
  return { windows: pickEven(W, nW), caps: pickEven(C, nC) };
}

async function chooseAuto(rows, o, W, C) {
  const total = W.length * C.length;
  const key = sizeClass(total);
  if (autoWinners.has(key)) return { ...autoWinners.get(key) };
  if (!gpuSupported()) return null;
  const want = Math.min(total, Math.max(TRIAL_MIN_CELLS, Math.round(total * TRIAL_FRACTION)));
  const trial = trialGrid(W, C, want);
  const trialCells = trial.windows.length * trial.caps.length;
  try {
    const t0 = performance.now();
    await runOnGpu(rows, trial.windows, trial.caps, o);
    const gpuMs = performance.now() - t0;
    const t1 = performance.now();
    await runOnWorkers(slimRows(rows), trial.windows, trial.caps, o);
    const workersMs = performance.now() - t1;
    const winner = {
      gpuMs: Math.round(gpuMs),
      workersMs: Math.round(workersMs),
      chosen: gpuMs <= workersMs ? 'gpu' : 'cpu-workers',
      trialCells,
      totalCells: total,
    };
    autoWinners.set(key, winner);
    return { ...winner };
  } catch {
    return null;
  }
}

export async function runSweep(rows, { windows, caps, opts = {}, prefer = 'auto' } = {}) {
  const g = defaultGrid();
  const W = windows ?? g.windows;
  const C = caps ?? g.caps;
  const o = normOpts(opts);
  let autoChoice = null;
  let chain;
  if (prefer === 'gpu') chain = ['gpu'];
  else if (prefer === 'cpu-workers') chain = ['workers', 'cpu'];
  else if (prefer === 'cpu') chain = ['cpu'];
  else {
    autoChoice = await chooseAuto(rows, o, W, C);
    chain = autoChoice?.chosen === 'cpu-workers' ? ['workers', 'cpu'] : ['gpu', 'workers', 'cpu'];
  }
  const reasons = [];
  for (const backend of chain) {
    const t0 = performance.now();
    try {
      let res;
      if (backend === 'gpu') res = await runOnGpu(rows, W, C, o);
      else if (backend === 'workers') res = await runOnWorkers(slimRows(rows), W, C, o);
      else res = runOnMain(rows, W, C, o);
      const backendName = backend === 'gpu' ? 'gpu' : backend === 'workers' ? 'cpu-workers' : 'cpu';
      return {
        backend: backendName,
        backendLabel: res.label,
        ms: performance.now() - t0,
        windows: W,
        caps: C,
        cells: res.cells,
        fallbackReason: reasons.length ? reasons.join('; ') : null,
        opts: o,
        autoChoice,
      };
    } catch (err) {
      reasons.push(`${backend}: ${(err && err.message) || err}`);
    }
  }
  throw new Error(`No backend could run the sweep. ${reasons.join('; ')}`);
}

function reasonOf(err) {
  return String((err && err.message) || err)
    .replace(/^No backend could run the sweep\. /, '')
    .replace(/^(gpu|workers|cpu-workers|cpu): /, '');
}

export async function compareBackends(rows, { windows, caps, opts = {}, full = false } = {}) {
  const W = windows;
  const C = caps;
  const total = W.length * C.length;
  const runs = [
    {
      key: 'gpu',
      grid: { windows: W, caps: C },
      unavailable: gpuSupported() ? null : 'WebGL2 with EXT_color_buffer_float is not available',
    },
    {
      key: 'cpu-workers',
      grid: { windows: W, caps: C },
      unavailable: typeof Worker === 'undefined' ? 'Web Workers are not available' : null,
    },
    {
      key: 'cpu',
      grid: full ? trialGrid(W, C, SPEED_SUBSET_CELLS) : { windows: W, caps: C },
      unavailable: null,
    },
  ];
  const lines = [];
  const timed = [];
  for (const run of runs) {
    const name = BACKEND_NAMES[run.key];
    if (run.unavailable) {
      lines.push(`${name}: not available (${run.unavailable})`);
      continue;
    }
    try {
      const res = await runSweep(rows, { windows: run.grid.windows, caps: run.grid.caps, opts, prefer: run.key });
      if (res.backend !== run.key) throw new Error(res.fallbackReason || `it ran as ${res.backendLabel}`);
      const n = res.cells.length;
      const perSecond = (n / Math.max(res.ms, 1e-3)) * 1000;
      let line = `${res.backendLabel}: ${n.toLocaleString('en-US')} back-tests in ${Math.round(res.ms)} ms (${Math.round(perSecond).toLocaleString('en-US')} per second)`;
      if (run.key === 'cpu' && full) {
        const fullMs = Math.round((total / perSecond) * 1000);
        line += `; measured on a ${n.toLocaleString('en-US')}-cell subset of the ${total.toLocaleString('en-US')}-cell full grid, so the rate is scaled to the full grid, which at this rate would take about ${fullMs.toLocaleString('en-US')} ms`;
      }
      lines.push(`${line}.`);
      timed.push({ label: res.backendLabel, perSecond });
    } catch (err) {
      lines.push(`${name}: not available (${reasonOf(err)})`);
    }
  }
  if (timed.length === 0) lines.push('No backend ran, so there is no speed to compare.');
  else if (timed.length === 1) lines.push(`Only ${timed[0].label} ran, so there is no speed ratio to report.`);
  else {
    const sorted = [...timed].sort((a, b) => b.perSecond - a.perSecond);
    const fast = sorted[0];
    const slow = sorted[sorted.length - 1];
    lines.push(
      `The fastest backend here is ${fast.label}, ${(fast.perSecond / slow.perSecond).toFixed(1)} times faster than the slowest, ${slow.label}.`,
    );
  }
  return lines;
}

function lineNodes(texts) {
  return texts.map((text) => {
    const p = document.createElement('div');
    p.textContent = text;
    return p;
  });
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function compareErrors(list, ref) {
  const keys = ['final', 'sharpe', 'maxDrawdown'];
  const rel = { final: 0, sharpe: 0, maxDrawdown: 0 };
  const abs = { final: 0, sharpe: 0, maxDrawdown: 0 };
  const scaled = { final: 0, sharpe: 0, maxDrawdown: 0 };
  let tradeMismatches = 0;
  list.forEach((a, k) => {
    const b = ref[k];
    for (const key of keys) {
      const d = Math.abs(a[key] - b[key]);
      abs[key] = Math.max(abs[key], d);
      rel[key] = Math.max(rel[key], d / Math.max(Math.abs(b[key]), 1e-12));
      scaled[key] = Math.max(scaled[key], d / Math.max(Math.abs(b[key]), 1));
    }
    if (a.trades !== b.trades) tradeMismatches++;
  });
  return { rel, abs, scaled, tradeMismatches };
}

export async function selfTest(rows, opts = {}) {
  const o = normOpts(opts);
  const g = defaultGrid();
  const rng = mulberry32(20261028);
  const sel = [];
  for (let k = 0; k < 40; k++) {
    sel.push({
      w: g.windows[Math.floor(rng() * g.windows.length)],
      c: g.caps[Math.floor(rng() * g.caps.length)],
    });
  }
  const windows = sel.map((s) => s.w);
  const caps = sel.map((s) => s.c);

  const engine = sel.map((s) =>
    compareSipVsVol(rows, {
      pool: o.pool,
      window: s.w,
      minExposure: o.minExposure,
      maxExposure: s.c,
      cost: o.cost,
      cashRate: o.cashRate,
      months: o.months,
      rebalance: o.rebalance,
      startDate: o.startDate,
      scaling: o.scaling,
      calibration: 'paper',
    }).vol,
  );
  const engineCells = engine.map((v) => ({ final: v.final, sharpe: v.sharpe, maxDrawdown: v.maxDrawdown, trades: v.investments.trades }));

  const pre = precompute(rows, { ...o, windows });
  const cpuCells = sel.map((s, k) => cell(pre, k, s.c));
  const cpu = compareErrors(cpuCells, engineCells);
  const cpuPass = keysPass(cpu.scaled, 1e-9);

  let gpu = null;
  let gpuPass = null;
  let gpuError = null;
  if (gpuSupported()) {
    try {
      const out = await runGpu(pre, windows, caps, o);
      const n = windows.length;
      const gpuCells = sel.map((_, k) => {
        const j = (k * n + k) * 4;
        return { final: out[j], sharpe: out[j + 1], maxDrawdown: out[j + 2], trades: out[j + 3] };
      });
      const e = compareErrors(gpuCells, engineCells);
      gpu = { maxRelErr: e.rel, maxAbsErr: e.abs, tradeMismatches: e.tradeMismatches };
      gpuPass = e.rel.final <= 1e-4 && e.abs.sharpe <= 1e-3 && e.abs.maxDrawdown <= 1e-3;
    } catch (err) {
      gpuError = (err && err.message) || String(err);
    }
  } else {
    gpuError = 'WebGL2 with EXT_color_buffer_float is not available';
  }

  return {
    cells: sel.length,
    scaling: o.scaling,
    cpu: { maxRelErr: cpu.rel, maxAbsErr: cpu.abs, tradeMismatches: cpu.tradeMismatches },
    cpuPass,
    gpu,
    gpuPass,
    gpuError,
    tolerance: {
      cpu: 'relative 1e-9 (absolute 1e-9 where the engine value is below 1)',
      gpu: 'relative 1e-4 on final value; absolute 1e-3 on Sharpe and max drawdown',
    },
  };
}

function keysPass(scaled, tol) {
  return Object.values(scaled).every((x) => x <= tol);
}

// ---- UI ----

const STYLE_ID = 'sweep-style';
const STYLE = `
.sweep { display: grid; gap: 14px; }
.sweep-controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
.sweep-controls .field { min-width: 160px; }
.sweep-map { margin: 0; }
.sweep-map figcaption { font: 600 13px var(--sans); color: var(--ink-2); margin-bottom: 4px; }
.sweep-canvas-wrap { position: relative; width: 100%; }
.sweep-canvas { display: block; width: 100%; height: auto; touch-action: none; }
.sweep-legend { display: flex; align-items: center; gap: 8px; font: 12px var(--sans); color: var(--muted); margin-top: 4px; }
.sweep-strip { flex: 1; height: 10px; border-radius: 3px; border: 1px solid var(--rule); }
.sweep-tip { position: absolute; pointer-events: none; background: var(--card); color: var(--ink); border: 1px solid var(--rule); border-radius: 6px; padding: 6px 8px; font: 12px/1.45 var(--sans); white-space: nowrap; z-index: 2; }
.sweep-tip[hidden] { display: none; }
.sweep-check { font: 13px/1.5 var(--sans); color: var(--ink-2); }
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = STYLE;
  document.head.appendChild(s);
}

function cssColor(name, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const ctx = document.createElement('canvas').getContext('2d');
  const probe = '#010203';
  ctx.fillStyle = probe;
  ctx.fillStyle = raw;
  if (ctx.fillStyle === probe) ctx.fillStyle = fallback;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

function srgbToLin(c) {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}
function linToSrgb(x) {
  const y = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, y)) * 255);
}
function toOklab([r, g, b]) {
  const R = srgbToLin(r);
  const G = srgbToLin(g);
  const B = srgbToLin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function rampColor(lo, hi, t) {
  const L = toOklab(lo);
  const H = toOklab(hi);
  const u = Math.min(1, Math.max(0, t));
  return fromOklab([0, 1, 2].map((k) => L[k] + (H[k] - L[k]) * u));
}

const rgb = ([r, g, b]) => `rgb(${r},${g},${b})`;

const METRICS = [
  {
    key: 'final',
    title: 'Final value (rupees)',
    fmt: (v) => inr(v),
    legend: (v) => inr(v),
    reverse: false,
  },
  {
    key: 'sharpe',
    title: 'Sharpe ratio (annualised)',
    fmt: (v) => v.toFixed(2),
    legend: (v) => v.toFixed(2),
    reverse: false,
  },
  {
    key: 'maxDrawdown',
    title: 'Maximum drawdown',
    fmt: (v) => pct(v, 1),
    legend: (v) => pct(v, 1),
    reverse: true,
  },
];

const AXIS_WINDOWS = [5, 50, 100, 150, 200, 250];

export function renderSweep(container, rows, uiOpts = {}) {
  if (!container) throw new Error('renderSweep needs a container element');
  ensureStyle();
  if (container._sweepCleanup) container._sweepCleanup();
  container.replaceChildren();

  const state = { result: null, token: 0, grid: uiOpts.grid && GRIDS[uiOpts.grid] ? uiOpts.grid : 'medium', maps: [] };
  const root = document.createElement('section');
  root.className = 'sweep';

  const controls = document.createElement('div');
  controls.className = 'sweep-controls';
  const field = document.createElement('label');
  field.className = 'field';
  field.textContent = 'Grid size';
  const select = document.createElement('select');
  [
    ['small', 'Small 16x11'],
    ['medium', 'Medium 61x36'],
    ['full', 'Full 246x141'],
  ].forEach(([value, label]) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  });
  select.value = state.grid;
  field.appendChild(select);
  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.className = 'btn';
  runBtn.textContent = 'Run again';
  const checkBtn = document.createElement('button');
  checkBtn.type = 'button';
  checkBtn.className = 'btn ghost';
  checkBtn.textContent = 'Check against the engine';
  const speedBtn = document.createElement('button');
  speedBtn.type = 'button';
  speedBtn.className = 'btn ghost';
  speedBtn.textContent = 'Compare speed of each backend';
  controls.append(field, runBtn, checkBtn, speedBtn);

  const readout = document.createElement('p');
  readout.className = 'status';
  readout.setAttribute('aria-live', 'polite');

  const note = document.createElement('p');
  note.className = 'note';
  note.textContent =
    'Your browser gives this page one GPU; Vercel servers have none, so the sweep runs on your own machine. ' +
    'The GPU is not always faster: on integrated graphics a pool of CPU workers can match it, so use the speed comparison to see which is quicker here. ' +
    'GPU results are float32; the built-in check requires agreement with the double-precision engine to within 1e-4 on final value (about 1e-6 in the runs we measured).';

  const mapsWrap = document.createElement('div');
  mapsWrap.className = 'sweep-maps';
  const checkOut = document.createElement('p');
  checkOut.className = 'sweep-check';
  checkOut.setAttribute('aria-live', 'polite');
  const speedOut = document.createElement('div');
  speedOut.className = 'sweep-check';
  speedOut.setAttribute('aria-live', 'polite');

  root.append(controls, readout, note, mapsWrap, checkOut, speedOut);
  container.appendChild(root);

  for (const m of METRICS) {
    const fig = document.createElement('figure');
    fig.className = 'sweep-map';
    const cap = document.createElement('figcaption');
    cap.textContent = m.title;
    const wrap = document.createElement('div');
    wrap.className = 'sweep-canvas-wrap';
    const canvas = document.createElement('canvas');
    canvas.className = 'sweep-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${m.title} across window length and maximum share`);
    const legend = document.createElement('div');
    legend.className = 'sweep-legend';
    const lo = document.createElement('span');
    const strip = document.createElement('div');
    strip.className = 'sweep-strip';
    const hi = document.createElement('span');
    legend.append(lo, strip, hi);
    const tip = document.createElement('div');
    tip.className = 'sweep-tip';
    tip.hidden = true;
    wrap.append(canvas, tip);
    fig.append(cap, wrap, legend);
    mapsWrap.appendChild(fig);
    state.maps.push({ m, canvas, tip, lo, hi, strip, base: null, layout: null });
  }

  function setReadout(text) {
    readout.textContent = text;
  }

  function describeResult(res) {
    const extra = res.fallbackReason ? ` (fell back: ${res.fallbackReason})` : '';
    const base = `${res.cells.length.toLocaleString('en-US')} back-tests in ${Math.round(res.ms)} ms on ${res.backendLabel}${extra}`;
    if (!res.autoChoice) return base;
    const a = res.autoChoice;
    return `${base}; auto-chose ${res.backendLabel} (GPU ${a.gpuMs} ms vs workers ${a.workersMs} ms on a ${a.trialCells.toLocaleString('en-US')}-cell trial of ${a.totalCells.toLocaleString('en-US')})`;
  }

  function draw() {
    const res = state.result;
    if (!res) return;
    const nW = res.windows.length;
    const nC = res.caps.length;
    const colour = {
      lo: cssColor('--paper-2', '#efece4'),
      hi: cssColor('--vol', '#2f6b5c'),
      ink: cssColor('--ink', '#1f1d1a'),
      muted: cssColor('--muted', '#6b665c'),
    };
    const styles = getComputedStyle(document.documentElement);
    const sans = styles.getPropertyValue('--sans').trim() || 'sans-serif';
    for (const map of state.maps) {
      const { m, canvas } = map;
      const width = Math.max(280, Math.round(canvas.parentElement.clientWidth || container.clientWidth || 340));
      const plotH = Math.min(300, Math.max(190, Math.round(width * 0.6)));
      const ml = 52;
      const mr = 8;
      const mt = 6;
      const mb = 26;
      const plotW = width - ml - mr;
      const H = plotH + mt + mb;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.aspectRatio = `${width} / ${H}`;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, H);

      let vmin = Infinity;
      let vmax = -Infinity;
      for (const c of res.cells) {
        const v = c[m.key];
        if (!Number.isFinite(v)) continue;
        if (v < vmin) vmin = v;
        if (v > vmax) vmax = v;
      }
      const span = vmax - vmin || 1;
      const cw = plotW / nC;
      const ch = plotH / nW;
      for (let wi = 0; wi < nW; wi++) {
        for (let ci = 0; ci < nC; ci++) {
          const c = res.cells[wi * nC + ci];
          const v = c[m.key];
          let t;
          if (!Number.isFinite(v)) t = 0;
          else if (m.reverse) t = (vmax - v) / span;
          else t = (v - vmin) / span;
          ctx.fillStyle = rgb(rampColor(colour.lo, colour.hi, t));
          const x = ml + ci * cw;
          const y = mt + (nW - 1 - wi) * ch;
          ctx.fillRect(x, y, cw + 0.5, ch + 0.5);
        }
      }

      ctx.fillStyle = rgb(colour.muted);
      ctx.font = `11px ${sans}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      for (const target of AXIS_WINDOWS) {
        const wi = nearestIndex(res.windows, target);
        if (wi < 0) continue;
        const y = mt + (nW - 1 - wi) * ch + ch / 2;
        ctx.fillText(String(res.windows[wi]), ml - 6, y);
      }
      ctx.save();
      ctx.translate(12, mt + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText('window (days)', 0, 0);
      ctx.restore();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let p = 30; p <= 100; p += 10) {
        const ci = nearestIndex(res.caps, p / 100);
        if (ci < 0) continue;
        const x = ml + ci * cw + cw / 2;
        ctx.fillText(`${p}%`, x, mt + plotH + 6);
      }
      ctx.fillText('maximum share in the index', ml + plotW / 2, mt + plotH + 6 + 12);

      const mk = uiOpts.window != null && uiOpts.cap != null
        ? { wi: nearestIndex(res.windows, uiOpts.window), ci: nearestIndex(res.caps, uiOpts.cap) }
        : null;
      if (mk && mk.wi >= 0 && mk.ci >= 0) {
        ctx.strokeStyle = rgb(colour.ink);
        ctx.lineWidth = 2;
        ctx.strokeRect(ml + mk.ci * cw + 1, mt + (nW - 1 - mk.wi) * ch + 1, cw - 2, ch - 2);
      }

      map.base = ctx.getImageData(0, 0, canvas.width, canvas.height);
      map.layout = { ml, mt, plotW, plotH, cw, ch, nW, nC, vmin, vmax, width, H, m, res };
      const loVal = m.reverse ? vmax : vmin;
      const hiVal = m.reverse ? vmin : vmax;
      map.lo.textContent = m.legend(loVal);
      map.hi.textContent = m.legend(hiVal);
      const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => rgb(rampColor(colour.lo, colour.hi, t)));
      map.strip.style.background = `linear-gradient(to right, ${stops.join(', ')})`;
      attachPointer(map, colour);
    }
  }

  function nearestIndex(list, target) {
    let best = -1;
    let bestD = Infinity;
    list.forEach((x, i) => {
      const d = Math.abs(x - target);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  function attachPointer(map, colour) {
    const { canvas, tip } = map;
    if (canvas._sweepBound) return;
    canvas._sweepBound = true;
    const onMove = (ev) => {
      const L = map.layout;
      if (!L) return;
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const scale = L.width / rect.width;
      const px = x * scale;
      const py = y * scale;
      const ci = Math.floor((px - L.ml) / L.cw);
      const wi = L.nW - 1 - Math.floor((py - L.mt) / L.ch);
      if (ci < 0 || ci >= L.nC || wi < 0 || wi >= L.nW || px < L.ml || py > L.mt + L.plotH) {
        hide();
        return;
      }
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.putImageData(map.base, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cx = L.ml + ci * L.cw + L.cw / 2;
      const cy = L.mt + (L.nW - 1 - wi) * L.ch + L.ch / 2;
      ctx.strokeStyle = rgb(colour.ink);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, L.mt);
      ctx.lineTo(cx, L.mt + L.plotH);
      ctx.moveTo(L.ml, cy);
      ctx.lineTo(L.ml + L.plotW, cy);
      ctx.stroke();
      ctx.setLineDash([]);
      const c = L.res.cells[wi * L.nC + ci];
      tip.replaceChildren();
      const lines = [
        `Window ${L.res.windows[wi]} days, max share ${pct(L.res.caps[ci], 1)}`,
        `Final value ${inr(c.final)}`,
        `Sharpe ${c.sharpe.toFixed(2)}`,
        `Max drawdown ${pct(c.maxDrawdown, 1)}`,
        `Trades ${c.trades}`,
      ];
      lines.forEach((text, i) => {
        const line = document.createElement('div');
        if (i === 0) line.style.fontWeight = '600';
        line.textContent = text;
        tip.appendChild(line);
      });
      tip.hidden = false;
      const tipLeft = Math.min(Math.max(0, cx / scale - 40), L.width - 200);
      tip.style.left = `${tipLeft}px`;
      tip.style.top = '0px';
    };
    const hide = () => {
      tip.hidden = true;
      if (map.base) {
        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.putImageData(map.base, 0, 0);
      }
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onMove);
    canvas.addEventListener('pointerleave', hide);
  }

  async function run() {
    if (!rows || rows.length < 2) {
      setReadout('No price rows to sweep.');
      return;
    }
    const token = ++state.token;
    runBtn.disabled = true;
    setReadout('Running the sweep...');
    try {
      const grid = GRIDS[state.grid]();
      const res = await runSweep(rows, { windows: grid.windows, caps: grid.caps, opts: uiOpts.opts ?? {}, prefer: uiOpts.prefer ?? 'auto' });
      if (token !== state.token) return;
      state.result = res;
      setReadout(describeResult(res));
      draw();
    } catch (err) {
      if (token === state.token) setReadout(`The sweep failed: ${(err && err.message) || err}`);
    } finally {
      if (token === state.token) {
        runBtn.disabled = false;
      }
    }
  }

  async function check() {
    checkBtn.disabled = true;
    checkOut.textContent = 'Checking 40 random cells against the engine...';
    try {
      const r = await selfTest(rows, uiOpts.opts ?? {});
      checkOut.replaceChildren(...describeCheck(r));
    } catch (err) {
      checkOut.textContent = `The check failed: ${(err && err.message) || err}`;
    } finally {
      checkBtn.disabled = false;
    }
  }

  function describeCheck(r) {
    const e = (x) => (x === 0 ? '0' : x.toExponential(1));
    const out = [];
    const line = (text) => {
      const p = document.createElement('div');
      p.textContent = text;
      out.push(p);
    };
    line(`Checked ${r.cells} random cells against the engine (${r.scaling} scaling).`);
    line(
      `CPU kernel (float64): largest relative error ${e(r.cpu.maxRelErr.final)} on final value, ${e(r.cpu.maxRelErr.sharpe)} on Sharpe, ${e(r.cpu.maxRelErr.maxDrawdown)} on max drawdown. ${r.cpuPass ? 'Matches the engine.' : 'Does NOT match the engine.'} Trade counts differ in ${r.cpu.tradeMismatches} of ${r.cells} cells.`,
    );
    if (r.gpu) {
      line(
        `GPU kernel (float32): largest relative error ${e(r.gpu.maxRelErr.final)} on final value, largest absolute error ${e(r.gpu.maxAbsErr.sharpe)} on Sharpe and ${e(r.gpu.maxAbsErr.maxDrawdown)} on max drawdown. ${r.gpuPass ? 'Within tolerance.' : 'Outside tolerance.'} Trade counts differ in ${r.gpu.tradeMismatches} of ${r.cells} cells.`,
      );
    } else {
      line(`GPU kernel: not run here (${r.gpuError}).`);
    }
    line(`Tolerances: CPU ${r.tolerance.cpu}; GPU ${r.tolerance.gpu}.`);
    return out;
  }

  async function compareSpeed() {
    if (!rows || rows.length < 2) {
      speedOut.textContent = 'No price rows to sweep.';
      return;
    }
    speedBtn.disabled = true;
    runBtn.disabled = true;
    speedOut.textContent = 'Timing each backend on the current grid...';
    try {
      const grid = GRIDS[state.grid]();
      const lines = await compareBackends(rows, {
        windows: grid.windows,
        caps: grid.caps,
        opts: uiOpts.opts ?? {},
        full: state.grid === 'full',
      });
      speedOut.replaceChildren(...lineNodes(lines));
    } catch (err) {
      speedOut.textContent = `The speed comparison failed: ${(err && err.message) || err}`;
    } finally {
      speedBtn.disabled = false;
      runBtn.disabled = false;
    }
  }

  runBtn.addEventListener('click', run);
  checkBtn.addEventListener('click', check);
  speedBtn.addEventListener('click', compareSpeed);
  select.addEventListener('change', () => {
    state.grid = select.value;
    run();
  });

  let ro = null;
  const redraw = () => draw();
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(redraw);
    ro.observe(mapsWrap);
  } else {
    window.addEventListener('resize', redraw);
  }
  container._sweepCleanup = () => {
    if (ro) ro.disconnect();
    else window.removeEventListener('resize', redraw);
  };

  run();
  return { run, check };
}
