import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = resolve(root, 'public');
const output = resolve(publicRoot, 'prepared');
await mkdir(output, { recursive: true });
await build({ entryPoints: [resolve(root, 'src/prepare.js')], bundle: true, format: 'esm', outfile: resolve(output, 'prepare.js') });
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path === '/prepare') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<script type="module" src="/prepared/prepare.js"></script>');
      return;
    }
    const file = resolve(publicRoot, '.' + path);
    if (!file.startsWith(publicRoot + '/')) { res.writeHead(403).end(); return; }
    const types = { '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-proxy-server', '--use-angle=metal'] });
try {
  const page = await browser.newPage();
  page.on('console', (message) => { if (message.type() === 'error') console.error(message.text()); });
  const save = async (kind, bytes, extension) => {
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    const name = kind + '-' + hash + extension;
    await writeFile(resolve(output, name), bytes);
    return 'prepared/' + name;
  };
  await page.exposeFunction('savePrepared', (kind, data) => save(kind, gzipSync(Buffer.from(data, 'base64'), { level: 9 }), '.bin.gz'));
  await page.exposeFunction('savePreparedImage', (data) => save('image', Buffer.from(data.split(',')[1], 'base64'), '.png'));
  await page.exposeFunction('savePreparedManifest', async (manifest) => {
    await writeFile(resolve(output, 'manifest.tmp.json'), JSON.stringify(manifest));
    await rename(resolve(output, 'manifest.tmp.json'), resolve(output, 'manifest.json'));
    await writeFile(resolve(output, 'manifest.json.gz'), gzipSync(Buffer.from(JSON.stringify(manifest)), { level: 9 }));
    console.log('Prepared', manifest.chunks.length, 'geometry chunks and', manifest.walls.length, 'walls');
  });
  await page.goto('http://127.0.0.1:' + server.address().port + '/prepare');
  await page.waitForFunction(() => window.preparationDone || window.preparationError, {}, { timeout: 240000 });
  const error = await page.evaluate(() => window.preparationError);
  if (error) throw new Error(error);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
