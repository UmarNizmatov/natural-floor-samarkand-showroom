// Textures and materials. Photo-based PBR sets from Poly Haven (CC0) plus crisp procedural paving.
import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

const loader = new THREE.TextureLoader();
let gpuLoader, compressedTextures = {};
export function configureTextureStreaming(renderer, formats) {
  if (!gpuLoader) gpuLoader = new KTX2Loader().setTranscoderPath('assets/basis/').setWorkerLimit(2).detectSupport(renderer);
  compressedTextures = formats || compressedTextures;
}
async function readTexture(url) {
  const compressed = compressedTextures[url];
  if (compressed && gpuLoader) {
    try { return await gpuLoader.loadAsync(compressed); }
    catch (error) { console.warn('Загружаем исходную текстуру', error); }
  }
  return loader.loadAsync(url);
}
export const isPhone = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || /Android|iPhone|iPad/.test(navigator.userAgent);
const texDir = 'assets/tex/hi';
const pendingTextures = new Map();
const imageLoads = new Map();
export function loadMaterialTextures(material) {
  return Promise.all((Array.isArray(material) ? material : [material]).flatMap((m) =>
    [...['map', 'normalMap', 'roughnessMap', 'aoMap', 'lightMap'].map((key) => m[key]), ...(m.userData.preparedTextures || [])].map((texture) => pendingTextures.get(texture)?.())
  ));
}
export function registerDeferredTexture(texture, url) {
  texture.userData.url = url;
  let promise;
  pendingTextures.set(texture, () => {
    if (!promise) {
      if (!imageLoads.has(url)) imageLoads.set(url, readTexture(url).catch((error) => {
        imageLoads.delete(url);
        throw error;
      }));
      promise = imageLoads.get(url).then((loaded) => {
        texture.image = loaded.image;
        if (loaded.isCompressedTexture) {
          texture.isCompressedTexture = true;
          texture.mipmaps = loaded.mipmaps;
          texture.format = loaded.format;
          texture.type = loaded.type;
          texture.minFilter = loaded.minFilter;
          texture.generateMipmaps = false;
          texture.flipY = false;
        }
        texture.needsUpdate = true;
        // Retain only a bounded number of decoded images in the CPU cache.
        imageLoads.delete(url);
        imageLoads.set(url, Promise.resolve(loaded));
        if (imageLoads.size > 32) imageLoads.delete(imageLoads.keys().next().value);
      }).catch((error) => { promise = null; throw error; });
    }
    return promise;
  });
  return texture;
}
function deferredTexture(url) {
  return registerDeferredTexture(new THREE.Texture(), url);
}
// A texture rectified from the customer's own site photographs.
export function photoMaterial(file, { normal = null, color, roughness = .92, vertexColors = false, normalScale = 1, anisotropy = 16 } = {}) {
  const prep = (texture, srgb) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = anisotropy;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  const material = new THREE.MeshStandardMaterial({ map: prep(deferredTexture(`assets/photo/${file}.webp`), true), roughness, vertexColors, envMapIntensity: .9 });
  if (normal) { material.normalMap = prep(deferredTexture(`assets/photo/${normal}.webp`)); material.normalScale = new THREE.Vector2(normalScale, normalScale); }
  if (color) material.color.set(color);
  return material;
}

// Standing-seam sheet metal: white here, tinted per building through vertex colours.
export function roofMaterial() {
  const w = 1024, h = 512, color = canvas2(w, h), height = canvas2(w, h);
  const c = color.getContext('2d'), z = height.getContext('2d');
  c.fillStyle = '#d8d8d8'; c.fillRect(0, 0, w, h);
  z.fillStyle = '#555'; z.fillRect(0, 0, w, h);
  const seams = 5, step = w / seams;
  for (let i = 0; i < seams; i++) {
    const x = i * step + step / 2;
    c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(x + 4, 0, 5, h);
    c.fillStyle = 'rgba(255,255,255,.3)'; c.fillRect(x - 3, 0, 4, h);
    z.fillStyle = '#fff'; z.fillRect(x - 4, 0, 8, h);
  }
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * w, y = Math.random() * h, l = 40 + Math.random() * 220;
    c.fillStyle = `rgba(${Math.random() > .5 ? '60,40,30' : '255,245,235'},${Math.random() * .1})`;
    c.fillRect(x, y, 2 + Math.random() * 16, l);
  }
  return new THREE.MeshStandardMaterial({ map: texture(color, true), normalMap: texture(normalFromHeight(height, 2)), roughness: .62, metalness: .35, vertexColors: true });
}

// Granite curb blocks, one metre long, with dark joints.
export function curbMaterial() {
  const size = 512, color = canvas2(size), height = canvas2(size);
  const c = color.getContext('2d'), z = height.getContext('2d');
  c.fillStyle = '#8d8e8c'; c.fillRect(0, 0, size, size);
  z.fillStyle = '#ddd'; z.fillRect(0, 0, size, size);
  for (let n = 0; n < 9000; n++) { const a = Math.random() * .16; c.fillStyle = Math.random() > .5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`; c.fillRect(Math.random() * size, Math.random() * size, 2, 2); }
  c.fillStyle = '#3f3f3d'; c.fillRect(0, 0, size, 5);
  z.fillStyle = '#000'; z.fillRect(0, 0, size, 7);
  return new THREE.MeshStandardMaterial({ map: texture(color, true), normalMap: texture(normalFromHeight(height, 2)), roughness: .88 });
}

export function pbr(name, { repeat = 1, color, roughness = 1, metalness = 0, normalScale = 1, anisotropy = 8, rough = true } = {}) {
  const prep = (texture, srgb) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.anisotropy = anisotropy;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  const material = new THREE.MeshStandardMaterial({
    map: prep(deferredTexture(`${texDir}/${name}_diff.webp`), true),
    normalMap: prep(deferredTexture(`${texDir}/${name}_nor.webp`)),
    roughness, metalness,
    normalScale: new THREE.Vector2(normalScale, normalScale),
  });
  if (rough) material.roughnessMap = prep(deferredTexture(`${texDir}/${name}_rough.webp`));
  if (color) material.color.set(color);
  return material;
}

// Height canvas to tangent-space normal map.
export function normalFromHeight(heightCanvas, strength = 2) {
  const { width: w, height: h } = heightCanvas;
  const source = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d'), image = ctx.createImageData(w, h);
  const at = (x, y) => source[(((y + h) % h) * w + ((x + w) % w)) * 4];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) / 255 * strength, dy = (at(x, y + 1) - at(x, y - 1)) / 255 * strength;
    const len = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    image.data[i] = (-dx / len * .5 + .5) * 255;
    image.data[i + 1] = (dy / len * .5 + .5) * 255;
    image.data[i + 2] = (1 / len * .5 + .5) * 255;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

const texture = (canvas, srgb, anisotropy = 8) => {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
};
const canvas2 = (size, h = size) => { const c = document.createElement('canvas'); c.width = size; c.height = h; return c; };

// Herringbone concrete pavers, as on the real sidewalk. The tile covers tileMetres.
export function paverMaterial(base, { tileMetres = 2.4, anisotropy } = {}) {
  const size = 1024, color = canvas2(size), height = canvas2(size);
  const c = color.getContext('2d'), z = height.getContext('2d');
  c.fillStyle = `rgb(${base[0]*.55},${base[1]*.55},${base[2]*.55})`; c.fillRect(0, 0, size, size);
  z.fillStyle = '#000'; z.fillRect(0, 0, size, size);
  const unit = size / tileMetres * 0.1, tone = () => (Math.random() - .5) * 11;
  const block = (x, y, w, h) => {
    const t = tone(), [r, g, b] = base;
    c.fillStyle = `rgb(${r + t},${g + t},${b + t * .9})`;
    c.fillRect(x + 1, y + 1, w - 2, h - 2);
    z.fillStyle = '#eee'; z.fillRect(x + 1.6, y + 1.6, w - 3.2, h - 3.2);
    z.fillStyle = '#fff'; z.fillRect(x + 3, y + 3, w - 6, h - 6);
  };
  // True herringbone: a horizontal and a vertical brick per lattice cell, period four units.
  const steps = Math.round(size / unit / 4) * 4, u = size / steps;
  for (let m = -steps; m < steps; m++) for (let n = -steps * 2; n < steps * 2; n++) {
    const px = (n + 2 * m) * u, py = (-n + 2 * m) * u;
    if (px < -3 * u || px > size || py < -3 * u || py > size) continue;
    block(px, py, u * 2, u); block(px + u * 2, py, u, u * 2);
  }
  // Fine concrete speckle.
  for (let n = 0; n < 26000; n++) {
    const a = Math.random() * .1;
    c.fillStyle = Math.random() > .5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    c.fillRect(Math.random() * size, Math.random() * size, 1.4, 1.4);
  }
  return new THREE.MeshStandardMaterial({ map: texture(color, true, anisotropy), normalMap: texture(normalFromHeight(height, 1.1), false, anisotropy), roughness: .86, vertexColors: false });
}

export function tactileMaterial() {
  const size = 512, color = canvas2(size), height = canvas2(size);
  const c = color.getContext('2d'), z = height.getContext('2d');
  c.fillStyle = '#a98a3e'; c.fillRect(0, 0, size, size);
  z.fillStyle = '#333'; z.fillRect(0, 0, size, size);
  const n = 8, u = size / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = (i + .5) * u, y = (j + .5) * u;
    c.fillStyle = '#b6964a'; c.beginPath(); c.arc(x, y, u * .33, 0, 7); c.fill();
    z.fillStyle = '#fff'; z.beginPath(); z.arc(x, y, u * .3, 0, 7); z.fill();
  }
  c.strokeStyle = '#6f5a2b'; c.lineWidth = 2; c.strokeRect(0, 0, size, size);
  return new THREE.MeshStandardMaterial({ map: texture(color, true), normalMap: texture(normalFromHeight(height, 3)), roughness: .75 });
}

// The black and white stepped zigzag of the real tiled slopes. U runs along the road (6 m), V up the slope.
export function slopeMaterial(accent = false) {
  const w = 2048, h = 1024, color = canvas2(w, h), height = canvas2(w, h);
  const c = color.getContext('2d'), z = height.getContext('2d');
  z.fillStyle = '#fff'; z.fillRect(0, 0, w, h);
  // U is 6 m along the road, V one slope height: 60 cm by 30 cm slabs in stepped light and dark bands.
  const rows = 14, cols = 10, rowH = h / rows, colW = w / cols;
  for (let r = 0; r < rows; r++) {
    const shift = Math.abs(((r + 2) % 8) - 4) * .5 - 1 + (r % 2) * .5;
    for (let col = -1; col <= cols; col++) {
      const band = ((Math.floor(col + shift + 40) % 10) + 10) % 10 < 5;
      const t = Math.random() * 12 - 6;
      let tone = band ? [52 + t, 54 + t, 58 + t] : [186 + t, 185 + t, 180 + t];
      if (accent && ((Math.floor(col + shift + 40) % 10) + 10) % 10 === 9) tone = [118 + t, 48 + t, 38 + t];
      const x = (col + (r % 2) * .5) * colW, y = r * rowH;
      c.fillStyle = `rgb(${tone})`; c.fillRect(x, y, colW, rowH);
      for (let n = 0; n < 240; n++) { const a = Math.random() * .1; c.fillStyle = Math.random() > .5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`; c.fillRect(x + Math.random() * colW, y + Math.random() * rowH, 2, 2); }
      c.strokeStyle = 'rgba(25,25,25,.7)'; c.lineWidth = 2.5; c.strokeRect(x, y, colW, rowH);
      z.strokeStyle = '#000'; z.lineWidth = 3.5; z.strokeRect(x, y, colW, rowH);
    }
  }
  return new THREE.MeshStandardMaterial({ map: texture(color, true, 16), normalMap: texture(normalFromHeight(height, 1.2), false, 16), roughness: .7 });
}

// Laser-cut girih panels like the real parapet railing.
export function girihPanelMaterial() {
  const w = 1024, h = 512, c = canvas2(w, h), g = c.getContext('2d');
  g.strokeStyle = '#34373a'; g.lineJoin = 'round'; g.lineWidth = 9;
  const cell = 128, star = (cx, cy, r, rotation) => { g.beginPath(); for (let k = 0; k < 4; k++) { const a = rotation + k * Math.PI / 2, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; k ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); g.stroke(); };
  for (let y = -cell; y <= h; y += cell) for (let x = -cell; x <= w; x += cell) {
    const cx = x + cell / 2, cy = y + cell / 2;
    star(cx, cy, cell * .36, 0); star(cx, cy, cell * .36, Math.PI / 4);
    star(cx, cy, cell * .15, Math.PI / 8);
    g.strokeRect(x, y, cell, cell);
    g.beginPath(); g.moveTo(cx - cell * .36, cy); g.lineTo(x, cy); g.moveTo(cx + cell * .36, cy); g.lineTo(x + cell, cy); g.moveTo(cx, cy - cell * .36); g.lineTo(cx, y); g.moveTo(cx, cy + cell * .36); g.lineTo(cx, y + cell); g.stroke();
  }
  g.lineWidth = 20; g.strokeRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map: t, alphaTest: .35, alphaToCoverage: true, side: THREE.DoubleSide, roughness: .6, metalness: .45 });
}

// Stone grain: tiled normal and luminance detail added on top of the painted design.
export function stoneDetail() {
  const size = 512, height = canvas2(size), g = height.getContext('2d');
  g.fillStyle = '#222'; g.fillRect(0, 0, size, size);
  for (let i = 0; i < 5200; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 2.5 + Math.random() * 3.6;
    const tone = 110 + Math.random() * 145;
    g.fillStyle = `rgb(${tone},${tone},${tone})`;
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      g.beginPath(); g.ellipse(x + ox, y + oy, r, r * (.6 + Math.random() * .4), Math.random() * 3, 0, 7); g.fill();
    }
  }
  const normal = texture(normalFromHeight(height, 2.8), false, 16);
  normal.channel = 1;
  const grain = texture(height, false, 16);
  grain.channel = 1;
  return { normal, grain };
}

// A wall material: the painted design, real grain and night-time wash lights near the base.
export function wallMaterial(detail, shared) {
  const material = new THREE.MeshStandardMaterial({ roughness: .96, normalMap: detail.normal, normalScale: new THREE.Vector2(.55, .55) });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.grainMap = { value: detail.grain };
    shader.uniforms.washStrength = shared.washStrength;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vGrainUv;varying float vWallV;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvGrainUv=uv1;vWallV=uv.y;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D grainMap;uniform float washStrength;varying vec2 vGrainUv;varying float vWallV;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float grain=texture2D(grainMap,vGrainUv).r;
        diffuseColor.rgb*=mix(.86,1.1,grain);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance+=diffuseColor.rgb*washStrength*(pow(1.-clamp(vWallV,0.,1.),1.6)*1.5+.08)*vec3(1.,.86,.66);`);
  };
  return material;
}
