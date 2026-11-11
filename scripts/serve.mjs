// Servidor local sin dependencias: sirve public/ y, si existe, la función /api/chat.
//   npm start            -> http://127.0.0.1:5173
//   PORT=8080 npm start  -> otro puerto
// Para probar el modo "IA real" en local, defina ANTHROPIC_API_KEY en SU terminal (nunca en un archivo)
// y ejecute `npm install` una vez (instala el SDK de Anthropic que usa /api/chat).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../public');
const port = Number(process.env.PORT || 5173);
const host = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

const { default: chatHandler } = await import(pathToFileURL(path.resolve(here, '../api/chat.js')).href);

async function toRequest(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  return new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api/chat') {
      const out = await chatHandler(await toRequest(req));
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(await out.text());
      return;
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(root, `.${rel}`);
    if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403); res.end('Prohibido'); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EISDIR') { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('No encontrado'); }
    else { console.error(e); res.writeHead(500); res.end('Error interno'); }
  }
});

server.listen(port, host, () => {
  console.log(`Demo de citas lista en http://${host}:${port}  (Ctrl+C para detener)`);
  console.log(process.env.ANTHROPIC_API_KEY ? 'Modo IA real disponible: /api/chat tiene clave en el entorno.' : 'Modo IA real apagado: no hay ANTHROPIC_API_KEY en el entorno (el modo guion funciona igual).');
});
