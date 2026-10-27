import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const port = Number(process.env.PORT) || 3000;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const load = async (name) => (await import(pathToFileURL(fileURLToPath(new URL(`../api/${name}.js`, import.meta.url))).href)).default;
const routes = { '/api/backtest': await load('backtest'), '/api/study': await load('study'), '/api/dcavm': await load('dcavm') };

function shim(res) {
  res.status = (code) => ((res.statusCode = code), res);
  res.json = (data) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(data));
    return res;
  };
  return res;
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (routes[url.pathname]) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    req.body = raw ? JSON.parse(raw) : {};
    try {
      await routes[url.pathname](req, shim(res));
    } catch (e) {
      shim(res).status(500).json({ error: e.message });
    }
    return;
  }
  const path = decodeURIComponent(url.pathname);
  if (path.startsWith('/local-data/')) {
    const local = fileURLToPath(new URL('../local-data/', import.meta.url));
    const f = join(local, normalize(path.slice('/local-data/'.length)));
    if (!f.startsWith(local)) {
      res.writeHead(403).end();
      return;
    }
    try {
      res.writeHead(200, { 'content-type': types[extname(f)] ?? 'text/csv; charset=utf-8' });
      res.end(await readFile(f));
    } catch {
      res.writeHead(404).end('not found');
    }
    return;
  }
  const file = join(root, path === '/' ? 'index.html' : normalize(path));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
