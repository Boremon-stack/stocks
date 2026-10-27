const VERT = `#version 300 es
in vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uU;
uniform highp sampler2D uFlag;
uniform highp sampler2D uP;
uniform highp sampler2D uS0;
uniform highp sampler2D uCaps;
uniform int uN;
uniform int uTW;
uniform int uRPW;
uniform float uRfd;
uniform float uCost;
uniform float uPool;
uniform float uMinExp;
uniform float uTradeTol;
out vec4 outColor;

float fetchAt(sampler2D tex, int wi, int i) {
  int q = i / uTW;
  return texelFetch(tex, ivec2(i - q * uTW, wi * uRPW + q), 0).r;
}

void main() {
  int ci = int(gl_FragCoord.x);
  int wi = int(gl_FragCoord.y);
  float hi = texelFetch(uCaps, ivec2(ci, 0), 0).r;
  int s0 = int(texelFetch(uS0, ivec2(wi, 0), 0).r + 0.5);
  float lo = min(uMinExp, hi);
  float cash = uPool;
  float units = 0.0;
  float peak = uPool;
  float maxDd = 0.0;
  float trades = 0.0;
  float prev = uPool;
  float V = uPool;
  float mu = 0.0;
  float m2 = 0.0;
  float cnt = 0.0;
  for (int i = s0; i < 1000000; i++) {
    if (i >= uN) break;
    float p = fetchAt(uP, 0, i);
    if (i > s0) cash += cash * uRfd;
    if (fetchAt(uFlag, wi, i) > 0.5) {
      float share = min(hi, max(lo, fetchAt(uU, wi, i)));
      float target = share * (cash + units * p);
      float delta = target - units * p;
      if (abs(delta) >= uTradeTol) {
        if (delta > 0.0) {
          float a = min(delta, cash / (1.0 + uCost));
          units += a / p;
          cash -= a + uCost * a;
        } else {
          float a = -delta;
          units -= a / p;
          cash += a - uCost * a;
        }
        trades += 1.0;
      }
    }
    V = cash + units * p;
    if (i > s0) {
      float rho = V / prev - 1.0;
      cnt += 1.0;
      float d = rho - mu;
      mu += d / cnt;
      m2 += d * (rho - mu);
    }
    prev = V;
    peak = max(peak, V);
    maxDd = min(maxDd, V / peak - 1.0);
  }
  float sdv = cnt > 1.0 ? sqrt(m2 / (cnt - 1.0)) : 0.0;
  float sharpe = sdv == 0.0 ? 0.0 : (mu - uRfd) / sdv * sqrt(252.0);
  outColor = vec4(V, sharpe, maxDd, trades);
}
`;

let probe;

export function gpuSupported() {
  if (probe !== undefined) return probe;
  probe = false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { powerPreference: 'high-performance' });
    if (gl) {
      probe = !!gl.getExtension('EXT_color_buffer_float');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    probe = false;
  }
  return probe;
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader compile failed: ${log}`);
  }
  return sh;
}

function link(gl, vs, fs) {
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, 'aPos');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`program link failed: ${log}`);
  }
  return prog;
}

const yieldTask = () => new Promise((resolve) => setTimeout(resolve, 0));

export async function runGpu(pre, windows, caps, opts = {}) {
  if (!gpuSupported()) throw new Error('WebGL2 with EXT_color_buffer_float is not available');
  const nW = windows.length;
  const nC = caps.length;
  const n = pre.n;
  if (pre.windows.length !== nW) throw new Error('precompute windows do not match the requested windows');

  const canvas = document.createElement('canvas');
  let lost = false;
  const onLost = (ev) => {
    ev.preventDefault();
    lost = true;
  };
  canvas.addEventListener('webglcontextlost', onLost);
  const gl = canvas.getContext('webgl2', { powerPreference: 'high-performance', antialias: false, depth: false, stencil: false });
  if (!gl) throw new Error('WebGL2 context unavailable');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is not available');

  const texes = [];
  let prog = null;
  let fbo = null;
  let vao = null;
  let vbo = null;
  let vs = null;
  let fs = null;
  try {
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const maxVp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    if (nC > maxTex || nW > maxTex || nC > maxVp[0] || nW > maxVp[1]) throw new Error('grid larger than the GPU render target limits');
    const TW = Math.min(maxTex, n);
    const RPW = Math.ceil(n / TW);
    const H = nW * RPW;
    if (H > maxTex) throw new Error('window count does not fit one texture column');

    const uData = new Float32Array(TW * H);
    const fData = new Float32Array(TW * H);
    for (let wi = 0; wi < nW; wi++) {
      const U = pre.U[wi];
      const fl = pre.flags[wi];
      for (let i = 0; i < n; i++) {
        const idx = (wi * RPW + Math.floor(i / TW)) * TW + (i % TW);
        const u = U[i];
        uData[idx] = Number.isNaN(u) ? 0 : u;
        fData[idx] = fl[i];
      }
    }
    const pData = new Float32Array(TW * RPW);
    for (let i = 0; i < n; i++) pData[Math.floor(i / TW) * TW + (i % TW)] = pre.P[i];
    const s0Data = new Float32Array(nW);
    for (let wi = 0; wi < nW; wi++) s0Data[wi] = pre.s0[wi];
    const capData = new Float32Array(nC);
    for (let ci = 0; ci < nC; ci++) capData[ci] = caps[ci];

    vs = compile(gl, gl.VERTEX_SHADER, VERT);
    fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    prog = link(gl, vs, fs);
    gl.useProgram(prog);

    const makeTex = (unit, w, h, data, name) => {
      const t = gl.createTexture();
      texes.push(t);
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, data);
      gl.uniform1i(gl.getUniformLocation(prog, name), unit);
    };
    makeTex(0, TW, H, uData, 'uU');
    makeTex(1, TW, H, fData, 'uFlag');
    makeTex(2, TW, RPW, pData, 'uP');
    makeTex(3, nW, 1, s0Data, 'uS0');
    makeTex(4, nC, 1, capData, 'uCaps');

    const setI = (name, v) => gl.uniform1i(gl.getUniformLocation(prog, name), v);
    const setF = (name, v) => gl.uniform1f(gl.getUniformLocation(prog, name), v);
    const pool = opts.pool ?? pre.pool;
    setI('uN', n);
    setI('uTW', TW);
    setI('uRPW', RPW);
    setF('uRfd', pre.rfd);
    setF('uCost', opts.cost ?? pre.cost);
    setF('uPool', pool);
    setF('uMinExp', opts.minExposure ?? pre.minExposure);
    setF('uTradeTol', 1e-6 * pool);

    const outTex = gl.createTexture();
    texes.push(outTex);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, outTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, nC, nW, 0, gl.RGBA, gl.FLOAT, null);
    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outTex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('float render target incomplete');
    gl.viewport(0, 0, nC, nW);

    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.SCISSOR_TEST);
    const rowsPerDraw = Math.max(1, Math.floor(2e6 / (n * nC)));
    for (let y0 = 0; y0 < nW; y0 += rowsPerDraw) {
      if (lost) throw new Error('WebGL context lost during the sweep');
      gl.scissor(0, y0, nC, Math.min(rowsPerDraw, nW - y0));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.flush();
      await yieldTask();
    }
    gl.finish();
    if (lost) throw new Error('WebGL context lost during the sweep');

    const out = new Float32Array(nC * nW * 4);
    gl.readPixels(0, 0, nC, nW, gl.RGBA, gl.FLOAT, out);
    const err = gl.getError();
    if (err !== gl.NO_ERROR) throw new Error(`readPixels failed with GL error ${err}`);
    return out;
  } finally {
    if (!lost) {
      for (const t of texes) gl.deleteTexture(t);
      if (fbo) gl.deleteFramebuffer(fbo);
      if (vao) gl.deleteVertexArray(vao);
      if (vbo) gl.deleteBuffer(vbo);
      if (prog) gl.deleteProgram(prog);
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
    }
    canvas.removeEventListener('webglcontextlost', onLost);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
