import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = resolve(root, 'public');
const manifest = JSON.parse(await readFile(resolve(publicRoot, 'prepared/manifest.json'), 'utf8'));
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
    const file = resolve(publicRoot, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(publicRoot + '/')) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' })[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--no-proxy-server'] });
const errors = [];
try {
  const page = await browser.newPage({ ...devices['iPhone 13'], deviceScaleFactor: 2 });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const started = performance.now();
  await page.goto('http://127.0.0.1:' + server.address().port + '/?fps');
  await page.waitForFunction(() => window.__street?.ready, {}, { timeout: 60000 });
  const initial = await page.evaluate(() => ({
    ...__street.shared.streamStats(),
    bytes: performance.getEntriesByType('resource').reduce((sum, resource) => sum + resource.transferSize, 0),
  }));
  assert(initial.loaded < initial.total, JSON.stringify(initial));
  assert(await page.evaluate(() => !!__street.composer));
  console.log('First frame', Math.round(performance.now() - started), 'ms', initial);
  await page.waitForFunction(() => __street.onFloor);
  const before = await page.evaluate(() => __street.player.end.z);
  await page.locator('[data-walk=forward]').tap();
  await page.waitForFunction((z) => Math.abs(__street.player.end.z - z) > .5, before);
  for (const stop of ['step', 'high', 'low', 'zone68', 'zone52', 'road']) {
    await page.evaluate((stop) => __street.goto(stop), stop);
    await page.waitForFunction(() => __street.onFloor);
    assert(await page.evaluate(() => {
      let valid = true;
      __street.scene.traverse((mesh) => {
        if (mesh.isMesh && mesh.visible && (!mesh.geometry?.attributes.position || (mesh.isInstancedMesh && mesh.instanceMatrix.count < mesh.count))) valid = false;
      });
      return valid;
    }), stop);
  }
  // A later choice must win even when earlier image requests are still running.
  await page.evaluate(() => {
    for (const id of ['assembly', 'shadow', 'plain', 'sky']) __street.applyDesign(__street.DESIGNS.find((design) => design.id === id));
  });
  await page.waitForFunction(() => __street.shared.wallList.flatMap((wall) => wall.segments).filter((segment) => segment.mesh.visible).every((segment) => segment.loadedDesign === 'sky'), {}, { timeout: 30000 });
  for (const time of ['sunset', 'night', 'day']) await page.evaluate((time) => __street.setTime(time), time);
  // Leave the surveyed stretch, then return. Distant geometry must reload correctly.
  await page.evaluate(async () => {
    const { THREE, shared, camera } = __street;
    const far = new THREE.Vector3(0, 3, 490);
    const fakeCamera = camera.clone();
    fakeCamera.position.copy(far); fakeCamera.lookAt(0, 3, 600);
    await shared.stream(fakeCamera, true);
    await shared.stream(camera, true);
  });
  await page.waitForFunction(() => __street.shared.wallList.flatMap((wall) => wall.segments).filter((segment) => segment.mesh.visible).every((segment) => segment.loadedDesign === 'sky'));
  await page.screenshot({ path: '/tmp/samarkand-streaming-verified.png' });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForFunction(() => Math.abs(__street.camera.aspect - innerWidth / innerHeight) < .001);
  assert.deepEqual(errors, []);
  const compressed = await page.evaluate(() => __street.shared.wallList.flatMap((wall) => wall.segments).some((segment) => segment.map.isCompressedTexture));
  assert.equal(compressed, !!manifest.compressedTextures);
  console.log('PASS full-quality mobile scene, route, input, rapid design changes, time of day, geometry reload, GPU textures and orientation');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
