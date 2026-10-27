import { precompute, cell } from './sweep-cpu.js';

self.onmessage = (e) => {
  const { rows, windows, caps, opts, range } = e.data;
  try {
    const [a, b] = range;
    const nC = caps.length;
    const pre = precompute(rows, { ...opts, windows });
    const out = new Float64Array((b - a) * 4);
    for (let idx = a, j = 0; idx < b; idx++, j++) {
      const wi = Math.floor(idx / nC);
      const res = cell(pre, wi, caps[idx - wi * nC]);
      out[j * 4] = res.final;
      out[j * 4 + 1] = res.sharpe;
      out[j * 4 + 2] = res.maxDrawdown;
      out[j * 4 + 3] = res.trades;
    }
    self.postMessage({ start: a, out }, [out.buffer]);
  } catch (err) {
    self.postMessage({ error: String((err && err.message) || err) });
  }
};
