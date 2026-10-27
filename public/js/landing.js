import { liveChart, SIP_VOL_PANELS, sipVolTooltip, inr, lakh, pct } from './chart.js';

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

startShader(document.getElementById('shader'));


const readout = document.getElementById('readout');
const chartRoot = document.getElementById('live-chart');
let stored = null;

function kpi(label, value, hi = false) {
  const box = document.createElement('div');
  box.className = hi ? 'kpi hi' : 'kpi';
  const span = document.createElement('span');
  span.textContent = label;
  const strong = document.createElement('strong');
  strong.textContent = value;
  box.append(span, strong);
  return box;
}

function drawLive() {
  if (!stored) return;
  liveChart(chartRoot, stored.series, {
    baseline: 1000000,
    panels: [SIP_VOL_PANELS[0], SIP_VOL_PANELS[1]],
    tooltip: (d) => sipVolTooltip(d, 'Nifty 50'),
  });
}

async function load() {
  try {
    const csv = await fetch('data/nifty.csv').then((r) => {
      if (!r.ok) throw new Error(`data ${r.status}`);
      return r.text();
    });
    const res = await fetch('api/compare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csv, start: '2019-01-02', months: 240, pool: 1000000, sip: 10000, window: 20, rebalance: 'monthly', cost: 0.001, cashRate: 0, minExposure: 0, maxExposure: 1 }),
    });
    if (!res.ok) throw new Error(`compare ${res.status}`);
    const data = await res.json();
    const { vol, sip } = data;
    readout.replaceChildren(
      kpi('Volatility-based, final value', lakh(vol.final), true),
      kpi('Monthly SIP, final value', lakh(sip.final)),
      kpi('Volatility-based, biggest fall', pct(vol.maxDrawdown)),
      kpi('Monthly SIP, biggest fall', pct(sip.maxDrawdown)),
    );
    stored = data;
    drawLive();
  } catch {
    readout.textContent = 'Live numbers could not be loaded. The past results page has the full back-test.';
  }
}

let resizeTimer;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(drawLive, 200);
});

load();
