export const KERNELS = {
  saxpy: {
    cpu: (x, y, p) => p.a * x + y,
    glsl: 'u_a * x + y',
  },
};

export function cpuRun(name, x, y, params = {}) {
  const k = KERNELS[name];
  if (!k) throw new Error(`unknown kernel: ${name}`);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = k.cpu(x[i], y[i], params);
  return out;
}

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

function fragSource(k) {
  return `#version 300 es
precision highp float;
uniform sampler2D u_x;
uniform sampler2D u_y;
uniform float u_a;
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float x = texelFetch(u_x, c, 0).r;
  float y = texelFetch(u_y, c, 0).r;
  o = vec4(${k.glsl}, 0.0, 0.0, 1.0);
}`;
}

function createGpuBackend() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;

  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const programs = new Map();
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function program(name) {
    if (programs.has(name)) return programs.get(name);
    const k = KERNELS[name];
    if (!k) throw new Error(`unknown kernel: ${name}`);
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragSource(k)));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    programs.set(name, p);
    return p;
  }

  function upload(data, w, h) {
    const tex = gl.createTexture();
    const padded = new Float32Array(w * h * 4);
    for (let i = 0; i < data.length; i++) padded[i * 4] = data[i];
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, padded);
    return tex;
  }

  function run(name, x, y, params = {}) {
    const n = x.length;
    const w = Math.min(n, maxTex);
    const h = Math.ceil(n / w);
    const prog = program(name);
    const tx = upload(x, w, h);
    const ty = upload(y, w, h);
    const out = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, out);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete');

    gl.viewport(0, 0, w, h);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_x'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, ty);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_y'), 1);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_a'), params.a ?? 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const pixels = new Float32Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, pixels);
    const result = new Float32Array(n);
    for (let i = 0; i < n; i++) result[i] = pixels[i * 4];

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(out);
    gl.deleteTexture(tx);
    gl.deleteTexture(ty);
    return result;
  }

  return { run };
}

export function createCompute({ prefer = 'gpu' } = {}) {
  const gpu = prefer === 'gpu' ? createGpuBackend() : null;
  if (gpu) return { backend: 'gpu', run: (name, x, y, p) => gpu.run(name, x, y, p) };
  return { backend: 'cpu', run: (name, x, y, p) => cpuRun(name, x, y, p) };
}
