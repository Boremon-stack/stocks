const NS = 'http://www.w3.org/2000/svg';
const PAD = { l: 58, r: 14, t: 10, b: 22 };

export const inr = (x) => `₹${Math.round(x).toLocaleString('en-IN')}`;

export function lakh(x) {
  const a = Math.abs(x);
  if (a >= 1e7) return `₹${(x / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(x / 1e5).toFixed(2)} L`;
  return inr(x);
}

export const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

function niceTicks(lo, hi, count) {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

export const SIP_VOL_PANELS = [
  {
    id: 'value',
    title: 'Pool value',
    height: 250,
    lines: [
      { key: 'sipValue', color: 'var(--sip)', label: 'Monthly SIP' },
      { key: 'volValue', color: 'var(--vol)', label: 'Volatility-based', fill: true },
    ],
    axisFmt: (v) => lakh(v).replace(' ', ''),
    baselineKey: 'pool',
  },
  {
    id: 'dd',
    title: 'Fall from the previous high',
    height: 130,
    lines: [
      { key: 'sipDd', color: 'var(--sip)', label: 'Monthly SIP', fill: true },
      { key: 'volDd', color: 'var(--vol)', label: 'Volatility-based', fill: true },
    ],
    axisFmt: (v) => `${(v * 100).toFixed(0)}%`,
    zeroMax: true,
  },
  {
    id: 'vol',
    title: 'Index volatility (last 20 days, per year)',
    height: 110,
    lines: [{ key: 'vol', color: 'var(--ink)', label: 'Volatility', fill: true, thin: true }],
    axisFmt: (v) => `${(v * 100).toFixed(0)}%`,
    zeroMin: true,
  },
  {
    id: 'exp',
    title: 'Share of the pool in the index',
    height: 120,
    lines: [
      { key: 'sipExposure', color: 'var(--sip)', label: 'Monthly SIP' },
      { key: 'volWeight', color: 'var(--vol)', label: 'Volatility-based' },
    ],
    axisFmt: (v) => `${(v * 100).toFixed(0)}%`,
    fixed: [0, 1],
  },
];

export function sipVolTooltip(d, indexName) {
  return {
    rows: [
      { label: indexName, value: Math.round(d.close).toLocaleString('en-IN') },
      { label: 'Monthly SIP', value: `${lakh(d.sipValue)}  (${pct(d.sipExposure, 0)} in index)`, color: 'var(--sip)' },
      { label: 'Volatility-based', value: `${lakh(d.volValue)}  (${pct(d.volWeight, 0)} in index)`, color: 'var(--vol)' },
      { label: 'Fall from high', value: `${pct(d.sipDd)} vs ${pct(d.volDd)}` },
      { label: 'Volatility', value: pct(d.vol) },
    ],
  };
}

export function liveChart(root, series, { baseline = null, panels = SIP_VOL_PANELS, tooltip } = {}) {
  root.textContent = '';
  const wrap = document.createElement('div');
  wrap.className = 'lc';
  root.appendChild(wrap);
  const tip = document.createElement('div');
  tip.className = 'lc-tip';
  tip.hidden = true;
  wrap.appendChild(tip);

  const width = Math.max(280, wrap.clientWidth || root.clientWidth || 600);
  const n = series.length;
  const plotW = width - PAD.l - PAD.r;
  const x = (i) => PAD.l + (i / Math.max(1, n - 1)) * plotW;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const yearTicks = [];
  let lastYear = '';
  series.forEach((d, i) => {
    const y = d.date.slice(0, 4);
    if (y !== lastYear) {
      lastYear = y;
      yearTicks.push({ i, label: y });
    }
  });
  const skip = Math.max(1, Math.ceil(yearTicks.length / Math.max(1, Math.floor(plotW / 64))));

  const crosshairs = [];
  const built = panels.map((p) => {
    const box = document.createElement('div');
    box.className = 'lc-panel';
    const head = document.createElement('div');
    head.className = 'lc-head';
    const title = document.createElement('span');
    title.textContent = p.title;
    head.appendChild(title);
    const legend = document.createElement('span');
    legend.className = 'lc-legend';
    for (const l of p.lines) {
      const k = document.createElement('i');
      k.style.background = l.color;
      legend.appendChild(k);
      legend.appendChild(document.createTextNode(l.label));
    }
    head.appendChild(legend);
    box.appendChild(head);

    const svg = el('svg', { width, height: p.height, viewBox: `0 0 ${width} ${p.height}`, role: 'img', 'aria-label': p.title });
    box.appendChild(svg);
    wrap.appendChild(box);

    const all = p.lines.flatMap((l) => series.map((d) => d[l.key]));
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    const base = p.baselineKey ? baseline : null;
    if (base !== null) {
      lo = Math.min(lo, base);
      hi = Math.max(hi, base);
    }
    if (p.zeroMax) hi = 0;
    if (p.zeroMin) lo = 0;
    if (p.fixed) [lo, hi] = p.fixed;
    const padY = p.fixed || p.zeroMax || p.zeroMin ? 0 : (hi - lo) * 0.06;
    lo -= padY;
    hi += padY;
    if (p.zeroMax) lo -= (hi - lo) * 0.08 || 0.01;
    if (p.zeroMin) hi += (hi - lo) * 0.08 || 0.01;
    const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo || 1)) * (p.height - PAD.t - PAD.b);

    for (const t of niceTicks(lo, hi, p.height > 200 ? 5 : 3)) {
      const yy = y(t);
      el('line', { x1: PAD.l, x2: width - PAD.r, y1: yy, y2: yy, stroke: 'var(--rule)', 'stroke-width': 1 }, svg);
      const lab = el('text', { x: PAD.l - 8, y: yy + 4, 'text-anchor': 'end', class: 'lc-axis' }, svg);
      lab.textContent = p.axisFmt(t);
    }
    yearTicks.forEach((t, k) => {
      if (k % skip) return;
      const xx = x(t.i);
      el('line', { x1: xx, x2: xx, y1: p.height - PAD.b, y2: p.height - PAD.b + 4, stroke: 'var(--muted)' }, svg);
      const lab = el('text', { x: xx, y: p.height - 5, 'text-anchor': 'middle', class: 'lc-axis' }, svg);
      lab.textContent = t.label;
    });
    if (base !== null) {
      el('line', { x1: PAD.l, x2: width - PAD.r, y1: y(base), y2: y(base), stroke: 'var(--muted)', 'stroke-dasharray': '3 4' }, svg);
    }

    for (const l of p.lines) {
      const pts = series.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[l.key]).toFixed(1)}`).join(' ');
      if (l.fill) {
        const floor = y(p.zeroMax || p.zeroMin ? 0 : lo);
        el('path', { d: `${pts} L${x(n - 1).toFixed(1)},${floor} L${x(0).toFixed(1)},${floor} Z`, fill: l.color, opacity: p.id === 'value' ? 0.07 : 0.14 }, svg);
      }
      const path = el('path', { d: pts, fill: 'none', stroke: l.color, 'stroke-width': l.thin ? 1.2 : 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
      if (!reduce) {
        const len = path.getTotalLength();
        path.style.strokeDasharray = len;
        path.style.strokeDashoffset = len;
        path.getBoundingClientRect();
        path.style.transition = 'stroke-dashoffset 1100ms cubic-bezier(.3,.7,.2,1)';
        path.style.strokeDashoffset = 0;
      }
    }

    const cross = el('line', { y1: PAD.t, y2: p.height - PAD.b, stroke: 'var(--ink)', 'stroke-width': 1, opacity: 0, 'pointer-events': 'none' }, svg);
    const dots = p.lines.map((l) => el('circle', { r: 4, fill: l.color, stroke: 'var(--card)', 'stroke-width': 2, opacity: 0, 'pointer-events': 'none' }, svg));
    crosshairs.push({ cross, dots, p, y });
    return { svg, p };
  });

  function show(i) {
    const d = series[i];
    for (const { cross, dots, p, y } of crosshairs) {
      const xx = x(i);
      cross.setAttribute('x1', xx);
      cross.setAttribute('x2', xx);
      cross.setAttribute('opacity', 0.35);
      p.lines.forEach((l, k) => {
        dots[k].setAttribute('cx', xx);
        dots[k].setAttribute('cy', y(d[l.key]));
        dots[k].setAttribute('opacity', 1);
      });
    }
    tip.textContent = '';
    const date = document.createElement('div');
    date.className = 'lc-date';
    date.textContent = new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    tip.appendChild(date);
    for (const r of tooltip(d).rows) {
      const row = document.createElement('div');
      row.className = 'lc-row';
      const a = document.createElement('span');
      if (r.color) {
        const sw = document.createElement('i');
        sw.style.background = r.color;
        a.appendChild(sw);
      }
      a.appendChild(document.createTextNode(r.label));
      const b = document.createElement('b');
      b.textContent = r.value;
      row.append(a, b);
      tip.appendChild(row);
    }
    tip.hidden = false;
    const tw = tip.offsetWidth;
    const left = x(i) + 14 + tw > width ? x(i) - 14 - tw : x(i) + 14;
    tip.style.left = `${Math.max(4, left)}px`;
  }

  function hide() {
    tip.hidden = true;
    for (const { cross, dots } of crosshairs) {
      cross.setAttribute('opacity', 0);
      dots.forEach((c) => c.setAttribute('opacity', 0));
    }
  }

  wrap.addEventListener('pointermove', (e) => {
    const rect = built[0].svg.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < PAD.l - 6 || px > width - PAD.r + 6) return hide();
    const i = Math.round(((px - PAD.l) / plotW) * (n - 1));
    show(Math.min(n - 1, Math.max(0, i)));
    const wrapRect = wrap.getBoundingClientRect();
    tip.style.top = `${Math.max(0, e.clientY - wrapRect.top - tip.offsetHeight - 14)}px`;
  });
  wrap.addEventListener('pointerleave', hide);
  wrap.style.touchAction = 'pan-y';
  return { width };
}

export function barChart(root, { labels, series, fmt, height = 170, zeroLine = true }) {
  root.textContent = '';
  const width = Math.max(240, root.clientWidth || 300);
  const padL = 44;
  const padB = 24;
  const padT = 8;
  const all = series.flatMap((s) => s.values);
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo || 1)) * (height - padT - padB);
  const svg = el('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' });
  root.appendChild(svg);
  for (const t of niceTicks(lo, hi, 3)) {
    el('line', { x1: padL, x2: width - 6, y1: y(t), y2: y(t), stroke: 'var(--rule)' }, svg);
    const lab = el('text', { x: padL - 6, y: y(t) + 4, 'text-anchor': 'end', class: 'lc-axis' }, svg);
    lab.textContent = fmt(t);
  }
  if (zeroLine) el('line', { x1: padL, x2: width - 6, y1: y(0), y2: y(0), stroke: 'var(--muted)' }, svg);
  const groupW = (width - padL - 6) / labels.length;
  const barW = Math.min(26, (groupW - 8) / series.length);
  labels.forEach((label, g) => {
    series.forEach((s, k) => {
      const v = s.values[g];
      const x0 = padL + g * groupW + (groupW - barW * series.length) / 2 + k * barW;
      const top = Math.min(y(v), y(0));
      el('rect', { x: x0, y: top, width: barW - 2, height: Math.max(1, Math.abs(y(v) - y(0))), fill: s.color, rx: 2 }, svg);
    });
    const lab = el('text', { x: padL + g * groupW + groupW / 2, y: height - 6, 'text-anchor': 'middle', class: 'lc-axis' }, svg);
    lab.textContent = label;
  });
}
