import { readFile, writeFile, mkdir, copyFile, access, readdir, unlink, rename, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = resolve(root, 'public');
const toktx = process.argv[2] || 'toktx';
const manifestPath = resolve(publicRoot, 'prepared/manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const types = new Map();
const imageURLs = new Map(manifest.images.map((image) => [image.uuid, image.url]));
manifest.textures.forEach((texture) => {
  const url = imageURLs.get(texture.image);
  types.set(url, texture.colorSpace === 'srgb' ? 'srgb' : 'linear');
});
manifest.walls.forEach((wall) => wall.segments.forEach((segment) => Object.values(segment.designs).forEach((url) => types.set(url, 'srgb'))));
types.set(manifest.grainUrl, 'linear');
const compressed = {};
const scratch = resolve(root, 'node_modules/.cache/texture-preparation');
await mkdir(scratch, { recursive: true });
for (const [url, colorSpace] of types) {
  const inputPath = resolve(publicRoot, url);
  const bytes = await readFile(inputPath);
  const hash = createHash('sha256').update(bytes).update(colorSpace + '-lower-left-uastc2-v2').digest('hex').slice(0, 16);
  const outputURL = 'prepared/gpu-' + hash + '.ktx2';
  const outputPath = resolve(publicRoot, outputURL);
  try { if ((await stat(outputPath)).size < 80) throw new Error('Incomplete texture'); }
  catch {
    const input = resolve(scratch, hash + '.png');
    execFileSync('magick', [inputPath, input]);
    const temporaryOutput = outputPath + '.tmp.ktx2';
    execFileSync(toktx, ['--t2', '--threads', '4', '--lower_left_maps_to_s0t0', '--encode', 'uastc', '--uastc_quality', '2', '--zcmp', '9', '--genmipmap', '--assign_oetf', colorSpace, '--assign_primaries', 'bt709', temporaryOutput, input], { stdio: 'pipe' });
    await rename(temporaryOutput, outputPath);
  }
  compressed[url] = outputURL;
  console.log('Texture', Object.keys(compressed).length, '/', types.size);
}
manifest.compressedTextures = compressed;
await writeFile(manifestPath, JSON.stringify(manifest));
await writeFile(manifestPath + '.gz', gzipSync(Buffer.from(JSON.stringify(manifest)), { level: 9 }));
const basisRoot = resolve(root, 'node_modules/three/examples/jsm/libs/basis');
await mkdir(resolve(publicRoot, 'assets/basis'), { recursive: true });
for (const name of ['basis_transcoder.js', 'basis_transcoder.wasm']) await copyFile(resolve(basisRoot, name), resolve(publicRoot, 'assets/basis', name));
await copyFile(resolve(root, 'node_modules/three/LICENSE'), resolve(publicRoot, 'assets/basis/LICENSE.txt'));
console.log('Prepared', Object.keys(compressed).length, 'GPU-compressed textures');


// Remove stale hashed files only after publishing the complete new manifest.
const referenced = new Set(['manifest.json', 'manifest.json.gz']);
const visit = (value) => {
  if (typeof value === 'string' && value.startsWith('prepared/')) referenced.add(value.slice('prepared/'.length));
  else if (Array.isArray(value)) value.forEach(visit);
  else if (value && typeof value === 'object') Object.values(value).forEach(visit);
};
visit(manifest);
for (const name of await readdir(resolve(publicRoot, 'prepared'))) {
  if (!referenced.has(name)) await unlink(resolve(publicRoot, 'prepared', name));
}
