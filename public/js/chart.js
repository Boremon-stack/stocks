const NS = 'http://www.w3.org/2000/svg';
const PAD = { l: 58, r: 14, t: 10, b: 22 };

export const inr = (x) => `₹${(Math.round(x) || 0).toLocaleString('en-IN')}`;

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
  const ts = series.map((d) => Date.parse(`${d.date}T00:00:00Z`));
  const span = Math.max(1, ts[n - 1] - ts[0]);
  const x = (i) => PAD.l + ((ts[i] - ts[0]) / span) * plotW;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const fmtDay = (t) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const fmtMon = (t) => new Date(t).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const xAt = (t) => PAD.l + ((t - ts[0]) / span) * plotW;
  const first = new Date(ts[0]);
  const stepMonths = plotW / (span / 2.63e9) >= 14 ? 6 : 12;
  const dateTicks = [
    { xx: xAt(ts[0]), label: fmtDay(ts[0]), anchor: 'start' },
    { xx: xAt(ts[n - 1]), label: fmtDay(ts[n - 1]), anchor: 'end' },
  ];
  for (let y = first.getUTCFullYear(); y <= new Date(ts[n - 1]).getUTCFullYear(); y++) {
    for (let m = 0; m < 12; m += stepMonths) {
      const t = Date.UTC(y, m, 1);
      const xx = xAt(t);
      if (t <= ts[0] || t >= ts[n - 1] || xx < PAD.l + 62 || xx > PAD.l + plotW - 62) continue;
      dateTicks.push({ xx, label: fmtMon(t), anchor: 'middle' });
    }
  }

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
      let tag = l.label;
      if (p.markers && !l.dash) {
        const vals = series.map((d) => d[l.key]);
        const at = p.markers === 'min' ? vals.indexOf(Math.min(...vals)) : n - 1;
        tag += ` ${p.markers === 'min' ? 'deepest' : 'ends at'} ${p.markFmt(vals[at])} on ${fmtDay(ts[at])}`;
      }
      legend.appendChild(document.createTextNode(tag));
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
    hi += padY * (p.markers === 'end' ? 3 : 1);
    if (p.zeroMax) lo -= (hi - lo) * 0.08 || 0.01;
    if (p.zeroMin) hi += (hi - lo) * 0.08 || 0.01;
    const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo || 1)) * (p.height - PAD.t - PAD.b);

    for (const t of niceTicks(lo, hi, p.height > 200 ? 5 : 3)) {
      const yy = y(t);
      el('line', { x1: PAD.l, x2: width - PAD.r, y1: yy, y2: yy, stroke: 'var(--rule)', 'stroke-width': 1 }, svg);
      const lab = el('text', { x: PAD.l - 8, y: yy + 4, 'text-anchor': 'end', class: 'lc-axis' }, svg);
      lab.textContent = p.axisFmt(t);
    }
    for (const t of dateTicks) {
      el('line', { x1: t.xx, x2: t.xx, y1: PAD.t, y2: p.height - PAD.b, stroke: 'var(--rule)', 'stroke-width': 1, opacity: 0.5 }, svg);
      el('line', { x1: t.xx, x2: t.xx, y1: p.height - PAD.b, y2: p.height - PAD.b + 4, stroke: 'var(--muted)' }, svg);
      const lab = el('text', { x: t.xx, y: p.height - 5, 'text-anchor': t.anchor, class: 'lc-axis' }, svg);
      lab.textContent = t.label;
    }
    if (base !== null) {
      el('line', { x1: PAD.l, x2: width - PAD.r, y1: y(base), y2: y(base), stroke: 'var(--muted)', 'stroke-dasharray': '3 4' }, svg);
    }

    const notes = [];
    for (const l of p.lines) {
      const pts = series.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[l.key]).toFixed(1)}`).join(' ');
      if (l.fill) {
        const floor = y(p.zeroMax || p.zeroMin ? 0 : lo);
        el('path', { d: `${pts} L${x(n - 1).toFixed(1)},${floor} L${x(0).toFixed(1)},${floor} Z`, fill: l.color, opacity: p.id === 'value' ? 0.07 : 0.14 }, svg);
      }
      const path = el('path', { d: pts, fill: 'none', stroke: l.color, 'stroke-width': l.thin || l.dash ? 1.2 : 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
      if (l.dash) path.setAttribute('stroke-dasharray', '5 4');
      if (p.markers && !l.dash) {
        const vals = series.map((d) => d[l.key]);
        const at = p.markers === 'min' ? vals.indexOf(Math.min(...vals)) : n - 1;
        const lastOf = (q) => series[n - 1][q.key];
        const li = p.lines.filter((q) => !q.dash && lastOf(q) > lastOf(l)).length;
        const px = x(at);
        const py = y(vals[at]);
        el('circle', { cx: px, cy: py, r: 4, fill: l.color, stroke: 'var(--card)', 'stroke-width': 2 }, svg);

      }
      if (!reduce && !l.dash) {
        const len = path.getTotalLength();
        path.style.strokeDasharray = len;
        path.style.strokeDashoffset = len;
        path.getBoundingClientRect();
        path.style.transition = 'stroke-dashoffset 1100ms cubic-bezier(.3,.7,.2,1)';
        path.style.strokeDashoffset = 0;
      }
    }

    const placed = [];
    for (const note of notes.sort((a, b) => Number(a.getAttribute('y')) - Number(b.getAttribute('y')))) {
      for (let guard = 0; guard < 8; guard++) {
        const b = note.getBBox();
        const hit = placed.some((q) => b.x < q.x + q.width && q.x < b.x + b.width && b.y < q.y + q.height && q.y < b.y + b.height);
        if (!hit) break;
        note.setAttribute('y', Number(note.getAttribute('y')) + b.height + 2);
      }
      const b = note.getBBox();
      if (b.y + b.height > p.height - PAD.b) note.setAttribute('y', p.height - PAD.b - 3);
      placed.push(note.getBBox());
    }

    const cross = el('line', { y1: PAD.t, y2: p.height - PAD.b, stroke: 'var(--ink)', 'stroke-width': 1, opacity: 0, 'pointer-events': 'none' }, svg);
    const dots = p.lines.map((l) => el('circle', { r: 4, fill: l.color, stroke: 'var(--card)', 'stroke-width': 2, opacity: 0, 'pointer-events': 'none' }, svg));
    crosshairs.push({ cross, dots, p, y });
    return { svg, p, meta: { lo, hi, top: PAD.t, bottom: p.height - PAD.b } };
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
    const target = ts[0] + ((px - PAD.l) / plotW) * span;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const i = lo > 0 && target - ts[lo - 1] < ts[lo] - target ? lo - 1 : lo;
    show(i);
    const wrapRect = wrap.getBoundingClientRect();
    tip.style.top = `${Math.max(0, e.clientY - wrapRect.top - tip.offsetHeight - 14)}px`;
  });
  root.__audit = { series, ts, span, plotW, width, panels: built };
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

// Chart self-audit: checks drawn geometry against the data it was built from.
// Every plotted point is inverted back to a value, tick dates are checked against real dates,
// marker labels against the data extremes, and all text against overlap and the SVG bounds.
export function auditCharts(root) {
  const a = root.__audit;
  const fails = [];
  let checks = 0;
  const ok = (cond, msg) => { checks++; if (!cond) fails.push(msg); };
  if (!a) return { checks: 0, fails: ['no chart rendered'] };
  const { series, ts, span, plotW, width } = a;
  const n = series.length;
  const dateOf = (px) => Math.round(ts[0] + ((px - PAD.l) / plotW) * span);
  a.panels.forEach(({ svg, p, meta }) => {
    const name = p.title;
    const strokes = [...svg.querySelectorAll('path')].filter((e) => e.getAttribute('fill') === 'none');
    ok(strokes.length === p.lines.length, `${name}: ${strokes.length} lines drawn, ${p.lines.length} expected`);
    p.lines.forEach((l, k) => {
      const pts = (strokes[k]?.getAttribute('d') || '').match(/[ML][-\d.]+,[-\d.]+/g) || [];
      ok(pts.length === n, `${name} / ${l.label}: ${pts.length} points drawn, ${n} in the data`);
      let worstPx = 0;
      let worstDay = 0;
      pts.forEach((s, i) => {
        const [px, py] = s.slice(1).split(',').map(Number);
        const v = meta.hi - ((py - meta.top) / (meta.bottom - meta.top)) * (meta.hi - meta.lo);
        const want = series[i][l.key];
        const perPx = (meta.hi - meta.lo) / (meta.bottom - meta.top) || 1;
        worstPx = Math.max(worstPx, Math.abs(v - want) / perPx);
        worstDay = Math.max(worstDay, Math.abs(dateOf(px) - ts[i]) / 864e5);
      });
      ok(worstPx <= 0.06 + 1e-6, `${name} / ${l.label}: a point is ${worstPx.toFixed(3)} px from its value`);
      ok(worstDay <= 1.5, `${name} / ${l.label}: a point sits ${worstDay.toFixed(2)} days from its date`);
      const vals = series.map((d) => d[l.key]);
      ok(vals.every(Number.isFinite), `${name} / ${l.label}: non-finite value in the data`);
      const [lo, hi] = [Math.min(...vals), Math.max(...vals)];
      ok(lo >= meta.lo - 1e-9 && hi <= meta.hi + 1e-9, `${name} / ${l.label}: data ${lo}..${hi} is cut off by the axis ${meta.lo}..${meta.hi}`);
    });
    const texts = [...svg.querySelectorAll('text')].map((t) => ({ t, b: t.getBBox(), s: t.textContent }));
    texts.forEach(({ b, s }) => ok(b.x >= -1 && b.x + b.width <= width + 1 && b.y >= -1 && b.y + b.height <= svg.viewBox.baseVal.height + 1, `${name}: label "${s}" is outside the chart`));
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const u = texts[i].b;
        const v = texts[j].b;
        const hit = u.x < v.x + v.width - 1 && v.x < u.x + u.width - 1 && u.y < v.y + v.height - 1 && v.y < u.y + u.height - 1;
        ok(!hit, `${name}: labels "${texts[i].s}" and "${texts[j].s}" overlap`);
      }
    }
    const axisDates = texts.map((x) => x.s).filter((s) => /^\d{1,2} [A-Z][a-z]{2} \d{4}$/.test(s));
    const fmt = (t) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    ok(axisDates.includes(fmt(ts[0])) && axisDates.includes(fmt(ts[n - 1])), `${name}: axis does not start and end on the first and last data dates`);
    if (p.markers === 'min') {
      p.lines.filter((l) => !l.dash).forEach((l) => {
        const m = Math.min(...series.map((d) => d[l.key]));
        const at = series.findIndex((d) => d[l.key] === m);
        const tag = `${p.markFmt(m)} on ${fmt(ts[at])}`;
        ok((svg.parentNode.querySelector('.lc-legend')?.textContent || '').includes(tag), `${name} / ${l.label}: legend lacks "${tag}"`);
      });
    }
  });
  return { checks, fails };
}
