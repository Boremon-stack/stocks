import { parseCsv, backtest } from './backtest.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

function startShader(canvas) {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true });
  if (!gl) return;
  const vs = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;
  const fs = `
precision mediump float;
uniform vec2 u_res; uniform float u_t;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s+=a*noise(p); p*=2.02; a*=0.5; } return s; }
void main(){
  vec2 uv = gl_FragCoord.xy / u_res.xy;
  vec2 q = vec2(uv.x * u_res.x / u_res.y, uv.y);
  float t = u_t * 0.035;
  vec2 w = vec2(fbm(q*1.6 + vec2(t, -t*0.6)), fbm(q*1.6 + vec2(-t*0.8, t) + 3.1));
  float f = fbm(q*1.2 + 1.8*w + vec2(0.0, t));
  vec3 paper = vec3(0.965, 0.949, 0.914);
  vec3 ochre = vec3(0.86, 0.79, 0.64);
  vec3 sage  = vec3(0.78, 0.82, 0.74);
  vec3 col = mix(paper, ochre, smoothstep(0.35, 0.8, f) * 0.55);
  col = mix(col, sage, smoothstep(0.55, 0.9, w.x) * 0.35);
  float grain = (hash(gl_FragCoord.xy + u_t) - 0.5) * 0.012;
  gl_FragColor = vec4(col + grain, 1.0);
}`;
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const v = sh(gl.VERTEX_SHADER, vs);
  const f = sh(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return;
  const prog = gl.createProgram();
  gl.attachShader(prog, v);
  gl.attachShader(prog, f);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(prog, 'u_res');
  const uT = gl.getUniformLocation(prog, 'u_t');

  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uRes, canvas.width, canvas.height);
  };
  addEventListener('resize', resize);
  resize();

  const t0 = performance.now();
  const frame = () => {
    gl.uniform1f(uT, reduce ? 0 : (performance.now() - t0) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (!reduce) requestAnimationFrame(frame);
  };
  frame();
}

function drawLive(rows) {
  const svg = document.getElementById('live-chart');
  const bt = backtest(rows, { mode: 'daily', cost: 0.001, rf: 0.065 });
  const s = bt.series;
  const W = 900, H = 340, pl = 52, pr = 16, pt = 18, pb = 92;
  const close = new Map(rows.map((r) => [r.date, r.close]));
  const logs = s.map((d) => Math.log(close.get(d.date)));
  const lo = Math.min(...logs), hi = Math.max(...logs);
  const x = (i) => pl + (i / (s.length - 1)) * (W - pl - pr);
  const yPrice = (l) => pt + (1 - (l - lo) / (hi - lo)) * (H - pt - pb);
  const yBar = (w) => H - 8 - Math.min(w, 1) * (pb - 24);
  const path = logs.map((l, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yPrice(l).toFixed(1)}`).join(' ');
  const bars = s
    .map((d, i) => `<rect x="${(x(i) - 0.5).toFixed(1)}" y="${yBar(d.weight).toFixed(1)}" width="1.2" height="${(H - 8 - yBar(d.weight)).toFixed(1)}" fill="var(--accent-soft)"/>`)
    .join('');
  const splitX = x(bt.split).toFixed(1);
  const testShade = `<rect x="${splitX}" y="${pt}" width="${(W - pr - splitX).toFixed(1)}" height="${H - pt - pb + 40}" fill="var(--rule)" opacity="0.45"/>`;
  const ticks = [];
  for (let y = Math.ceil(new Date(s[0].date).getFullYear()); y <= new Date(s.at(-1).date).getFullYear(); y += 3) {
    const i = s.findIndex((d) => d.date.startsWith(String(y)));
    if (i >= 0) ticks.push(`<text x="${x(i).toFixed(1)}" y="${H - 66}" fill="var(--muted)" font-size="12" font-family="var(--sans)">${y}</text>`);
  }
  svg.innerHTML = `
    ${testShade}
    <path d="${path}" fill="none" stroke="var(--ink-2)" stroke-width="1.6"/>
    ${bars}
    ${ticks.join('')}
    <text x="${pl}" y="${pt - 4}" fill="var(--muted)" font-size="12" font-family="var(--sans)">log scale</text>`;

  const oos = bt.outOfSample.strategy, bh = bt.outOfSample.buyHold;
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  document.getElementById('readout').innerHTML = `
    <div class="kpi hi"><span>Test CAGR, managed</span><strong>${pct(oos.cagr)}</strong></div>
    <div class="kpi"><span>Test CAGR, buy and hold</span><strong>${pct(bh.cagr)}</strong></div>
    <div class="kpi"><span>Managed max drawdown</span><strong>${pct(oos.maxDrawdown)}</strong></div>
    <div class="kpi"><span>Buy-and-hold max drawdown</span><strong>${pct(bh.maxDrawdown)}</strong></div>`;
}

startShader(document.getElementById('shader'));

function simulatedRows(n = 4700, seed = 20070917) {
  let s = seed >>> 0;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
  const omega = 2e-6, alpha = 0.09, beta = 0.9;
  let h = omega / (1 - alpha - beta);
  let eps = 0;
  let p = 100;
  const rows = [];
  const d = new Date(Date.UTC(2007, 8, 17));
  while (rows.length < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    h = omega + alpha * eps * eps + beta * h;
    eps = Math.sqrt(h) * gauss();
    p *= Math.exp(0.0003 + eps);
    rows.push({ date: d.toISOString().slice(0, 10), close: p });
  }
  return rows;
}

drawLive(simulatedRows());
document.querySelector('#live .caveat').textContent = 'Simulated GARCH(1,1) prices, not market data. Illustrative only; not investment advice.';
document.querySelector('#live h2').textContent = 'A simulated index with volatility clustering';
document.querySelector('#live .muted').textContent = 'The chart runs the daily rule in your browser on a simulated series, so no market data is hosted here. The line is the simulated index; the bars are the exposure the rule would hold. The grey shaded area is the test period.';
