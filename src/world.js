// Builds the finished street from the survey: road, sidewalks, walls, slopes, railing, buildings, lamps.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { stations, station, walls, bays, westCrest, eastCrest, crestAt, ROAD, across } from './site.js';
import { pbr, photoMaterial, roofMaterial, curbMaterial, slopeMaterial, girihPanelMaterial, stoneDetail, wallMaterial } from './materials.js';
import { DESIGNS, paintDesign } from './designs.js';
import { chunkGroup } from './culling.js';

const { SIDEWALK, LANE, CURB_DROP } = ROAD;
// Stairs up the slopes, like the one in photo 121139, opposite the zebra crossings.
const STAIRS = [{ side: 'west', Y: 1965 }, { side: 'east', Y: 2042 }, { side: 'west', Y: 2060 }];

const tmp = new THREE.Vector3();
function seeded(seed) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

// A surface swept along stations between two functions that give points in world space.
function sweep(from, to, a, b, { uMetres = 1, vMetres = 1, lateral = 1, colorFn, every = 1 } = {}) {
  const positions = [], uvs = [], colors = [], indices = [];
  const rows = [];
  for (let i = from; i <= to; i += every) rows.push(i);
  if (rows[rows.length - 1] !== to) rows.push(to);
  rows.forEach((i, r) => {
    const A = a(stations[i], i), B = b(stations[i], i);
    const width = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
    for (let k = 0; k <= lateral; k++) {
      const t = k / lateral;
      positions.push(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
      uvs.push(t * width / uMetres, stations[i].arc / vMetres);
      if (colorFn) { const c = colorFn(t, i); colors.push(c, c, c); }
    }
    if (r) for (let k = 0; k < lateral; k++) {
      const n = lateral + 1, p = (r - 1) * n + k, q = r * n + k;
      indices.push(p, p + 1, q, p + 1, q + 1, q);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (colorFn) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  // Every surface must face up or toward the road; flip when the sweep came out reversed.
  const normal = g.attributes.normal;
  let up = 0; for (let i = 0; i < normal.count; i += 7) up += normal.getY(i);
  if (up < 0) { const flipped = []; for (let i = 0; i < indices.length; i += 3) flipped.push(indices[i], indices[i + 2], indices[i + 1]); g.setIndex(flipped); g.computeVertexNormals(); }
  return g;
}

// Cross-section helper: d is metres from the west edge, the road sits one curb lower.
const axis = (s) => { const w = s.width; return [(s.E[0] - s.W[0]) / w, (s.E[2] - s.W[2]) / w]; };
export function sectionPoint(s, d, lift = 0) {
  const [ax, az] = axis(s), t = d / s.width;
  const curb = Math.min(1, Math.max(0, Math.min(d - (SIDEWALK - .2), s.width - (SIDEWALK - .2) - d) / .2));
  const median = s.width - 2 * (SIDEWALK + LANE);
  const m = Math.min(1, Math.max(0, (Math.abs(d - s.width / 2) < median / 2 + .2 ? 1 : 0) * Math.min(1, (median / 2 + .2 - Math.abs(d - s.width / 2)) / .2)));
  return [s.W[0] + ax * d, s.W[1] + (s.E[1] - s.W[1]) * t - CURB_DROP * curb + CURB_DROP * m + lift, s.W[2] + az * d];
}
const roadPoint = (s, d, lift) => sectionPoint(s, d, lift);

function geometryToMesh(geometry, material, group, { cast = false, receive = true } = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = cast; mesh.receiveShadow = receive;
  group.add(mesh);
  return mesh;
}

// A running box along a polyline: coping, handrail.
function rail(points, width, height, yOffset = 0) {
  const pos = [], idx = [], uv = [];
  let s = 0;
  points.forEach((p, i) => {
    const q = points[Math.min(i + 1, points.length - 1)], o = points[Math.max(i - 1, 0)];
    const tx = q[0] - o[0], tz = q[2] - o[2], l = Math.hypot(tx, tz) || 1, nx = -tz / l * width / 2, nz = tx / l * width / 2;
    if (i) s += Math.hypot(p[0] - points[i - 1][0], p[2] - points[i - 1][2]);
    const y = p[1] + yOffset;
    pos.push(p[0] + nx, y, p[2] + nz, p[0] + nx, y + height, p[2] + nz, p[0] - nx, y + height, p[2] - nz, p[0] - nx, y, p[2] - nz);
    uv.push(s / 2, 0, s / 2, .3, s / 2, .6, s / 2, 0.9);
    if (i) for (let k = 0; k < 4; k++) {
      const a = (i - 1) * 4 + k, b = i * 4 + k, a1 = (i - 1) * 4 + (k + 1) % 4, b1 = i * 4 + (k + 1) % 4;
      idx.push(a, b, a1, a1, b, b1);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const flat = g.toNonIndexed(); flat.computeVertexNormals();
  return flat;
}

// Walls ---------------------------------------------------------------------------------------
function wallNormal(curve, i, sign) {
  const a = curve[Math.max(0, i - 1)], b = curve[Math.min(curve.length - 1, i + 1)];
  const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
  return [-tz / l * sign, tx / l * sign];
}

function baseAt(curve, s) {
  for (let i = 1; i < curve.length; i++) if (s <= curve[i].s) {
    const t = (s - curve[i - 1].s) / Math.max(1e-6, curve[i].s - curve[i - 1].s);
    return { x: curve[i - 1].x + (curve[i].x - curve[i - 1].x) * t, z: curve[i - 1].z + (curve[i].z - curve[i - 1].z) * t, base: curve[i - 1].base + (curve[i].base - curve[i - 1].base) * t };
  }
  return curve[curve.length - 1];
}

// Rays from a viewing spot: draws a star that only looks right from that one spot.
function anamorph(wall, sEye, sTarget, offset) {
  const curve = wall.curve;
  const eyeBase = baseAt(curve, sEye);
  const index = curve.findIndex((p) => p.s >= sEye);
  const [nx, nz] = wallNormal(curve, Math.max(index, 0), wall.normalSign);
  const eye = new THREE.Vector3(eyeBase.x + nx * offset, eyeBase.base + 1.62, eyeBase.z + nz * offset);
  const heightAt = (s) => { const b = baseAt(curve, s); let top = b.base; for (let i = 1; i < curve.length; i++) if (s <= curve[i].s) { top = curve[i].top; break; } return top - b.base; };
  const target = baseAt(curve, sTarget);
  const look = new THREE.Vector3(target.x, target.base + heightAt(sTarget) * .52, target.z).sub(eye).normalize();
  const right = new THREE.Vector3().crossVectors(look, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, look).normalize();
  const distance = new THREE.Vector3(target.x, 0, target.z).distanceTo(new THREE.Vector3(eye.x, 0, eye.z));
  const angular = Math.atan((heightAt(sTarget) * .46) / distance);
  const project = (ax, ay) => {
    const dir = look.clone().addScaledVector(right, Math.tan(ax)).addScaledVector(up, Math.tan(ay));
    let best = null, nearest = Infinity;
    for (let i = 1; i < curve.length; i++) {
      const a = curve[i - 1], b = curve[i], ex = b.x - a.x, ez = b.z - a.z;
      const denom = dir.x * ez - dir.z * ex;
      if (Math.abs(denom) < 1e-6) continue;
      const t = ((a.x - eye.x) * ez - (a.z - eye.z) * ex) / denom, w = ((a.x - eye.x) * dir.z - (a.z - eye.z) * dir.x) / denom;
      if (t > 0 && t < nearest && w >= -0.001 && w <= 1.001) {
        const s = a.s + (b.s - a.s) * w, base = a.base + (b.base - a.base) * w;
        nearest = t; best = [s, eye.y + dir.y * t - base];
      }
    }
    return best;
  };
  const shape = (radius, inner, tips, rotation) => {
    const points = [];
    for (let i = 0; i < tips * 2; i++) {
      const r0 = i % 2 ? radius * inner : radius, a0 = rotation + i * Math.PI / tips;
      const r1 = (i + 1) % 2 ? radius * inner : radius, a1 = rotation + (i + 1) * Math.PI / tips;
      for (let k = 0; k < 10; k++) {
        const t = k / 10, x0 = Math.cos(a0) * r0, y0 = Math.sin(a0) * r0, x1 = Math.cos(a1) * r1, y1 = Math.sin(a1) * r1;
        const p = project(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
        if (p) points.push(p);
      }
    }
    return points;
  };
  const ring = (radius) => {
    const points = [];
    for (let i = 0; i < 96; i++) { const a = i / 96 * Math.PI * 2, p = project(Math.cos(a) * radius, Math.sin(a) * radius); if (p) points.push(p); }
    return points;
  };
  const rings = [
    { stone: 'BlackCoffee', points: ring(angular) },
    { stone: 'Arktika', points: ring(angular * .93) },
    { stone: 'Rubin', points: shape(angular * .88, .46, 8, Math.PI / 8) },
    { stone: 'Safari', points: shape(angular * .52, .52, 8, 0) },
    { stone: 'BlackCoffee', points: ring(angular * .2) },
  ];
  return { rings, eye, look };
}

function buildWall(wall, tier, detail, shared, group, colliders) {
  const curve = wall.curve, L = curve[curve.length - 1].s;
  const H = Math.max(...curve.map((p) => p.top - p.base)) + .02;
  wall.L = L; wall.H = H;
  const pxPerMetre = tier === 'high' ? 110 : 44;
  const maxSegment = Math.floor(4096 / pxPerMetre);
  const count = Math.max(1, Math.ceil(L / maxSegment));
  wall.segments = [];
  for (let seg = 0; seg < count; seg++) {
    const s0 = seg * L / count, s1 = (seg + 1) * L / count;
    const row = [];
    for (const p of curve) if (p.s > s0 - 1e-6 && p.s < s1 + 1e-6) row.push({ s: p.s, x: p.x, z: p.z, base: p.base, top: p.top });
    const edge = (s) => { for (let i = 1; i < curve.length; i++) if (s <= curve[i].s + 1e-6) { const a = curve[i - 1], b = curve[i], t = (s - a.s) / Math.max(1e-6, b.s - a.s); return { s, x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, base: a.base + (b.base - a.base) * t, top: a.top + (b.top - a.top) * t }; } return curve[curve.length - 1]; };
    if (!row.length || row[0].s > s0 + 1e-3) row.unshift(edge(s0));
    if (row[row.length - 1].s < s1 - 1e-3) row.push(edge(s1));
    const pos = [], uv = [], uv1 = [], idx = [];
    row.forEach((p, i) => {
      const h = p.top - p.base;
      pos.push(p.x, p.base, p.z, p.x, p.top, p.z);
      uv.push((p.s - s0) / (s1 - s0), 0, (p.s - s0) / (s1 - s0), h / H);
      uv1.push(p.s / .34, 0, p.s / .34, h / .34);
      if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Face the road.
    const nx0 = g.attributes.normal.getX(0), nz0 = g.attributes.normal.getZ(0), [wx, wz] = wallNormal(curve, 0, wall.normalSign);
    if (nx0 * wx + nz0 * wz < 0) { const flipped = []; for (let i = 0; i < idx.length; i += 3) flipped.push(idx[i], idx[i + 2], idx[i + 1]); g.setIndex(flipped); g.computeVertexNormals(); }
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil((s1 - s0) * pxPerMetre); canvas.height = Math.ceil(H * pxPerMetre);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 16;
    // Normals from the curve itself so neighbouring segments join without a visible seam.
    const front = g.attributes.normal;
    row.forEach((p, i) => {
      const k = curve.reduce((best, q, j) => (Math.abs(q.s - p.s) < Math.abs(curve[best].s - p.s) ? j : best), 0);
      const [fx, fz] = wallNormal(curve, k, wall.normalSign);
      const facing = front.getX(i * 2) * fx + front.getZ(i * 2) * fz < 0 ? -1 : 1;
      front.setXYZ(i * 2, fx * facing, 0, fz * facing); front.setXYZ(i * 2 + 1, fx * facing, 0, fz * facing);
    });
    const material = wallMaterial(detail, shared);
    material.map = map; material.side = THREE.DoubleSide;
    const mesh = geometryToMesh(g, material, group, { cast: true });
    mesh.userData.keepWhole = true;
    wall.segments.push({ canvas, map, s0, s1, mesh });
  }
  // Coping and the railing go on top of the finished wall.
  const top = curve.map((p) => [p.x, p.top, p.z]);
  const mid = wallNormal(curve, Math.floor(curve.length / 2), wall.normalSign);
  colliders.push(...thick(curve.map((p) => [p.x, p.base - 2, p.z]), top, mid[0], mid[1]));
  return top;
}

// The capsule test is one-sided, so a solid wall is two sheets back to back, a little apart.
function thick(a, b, nx, nz, depth = .4) {
  const orient = (g, dx, dz) => {
    g.computeVertexNormals();
    if (g.attributes.normal.getX(0) * dx + g.attributes.normal.getZ(0) * dz < 0) {
      const index = g.index.array, flipped = [];
      for (let i = 0; i < index.length; i += 3) flipped.push(index[i], index[i + 2], index[i + 1]);
      g.setIndex(flipped);
    }
    return g;
  };
  const shift = (list) => list.map((p) => [p[0] - nx * depth, p[1], p[2] - nz * depth]);
  return [orient(sheet(a, b), nx, nz), orient(sheet(shift(a), shift(b)), -nx, -nz)];
}

function sheet(a, b) {
  const pos = [], idx = [];
  a.forEach((p, i) => { pos.push(...p, ...b[i]); if (i) { const k = (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); } });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// Repaints one wall piece per frame, so switching a design never stalls the walk.
const paintTokens = new WeakMap();
export function paintAllWalls(allWalls, design, tier, immediate = false) {
  const pxPerMetre = tier === 'high' ? 110 : 44;
  const jobs = [];
  allWalls.forEach((wall) => {
    const token = (paintTokens.get(wall) || 0) + 1;
    paintTokens.set(wall, token);
    const seed = 7 + wall.id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    wall.segments.forEach((segment) => jobs.push(() => {
      if (paintTokens.get(wall) !== token) return;
      if (segment.selectDesign) { segment.selectDesign(design.id); return; }
      paintDesign(segment.canvas.getContext('2d'), design, { L: wall.L, H: wall.H, s0: segment.s0, pxPerMetre, wall, seed });
      segment.map.needsUpdate = true;
      segment.mesh.material.map = segment.map;
    }));
  });
  if (immediate) { jobs.forEach((job) => job()); return; }
  const next = () => {
    if (!jobs.length) return;
    jobs.shift()();
    if (jobs.length) requestAnimationFrame(next);
  };
  next();
}

// Slopes -----------------------------------------------------------------------------------------
function slopeBand(side, fromI, toI, material, group, colliders, uMetres = 6) {
  const foot = (s) => (side === 'west' ? sectionPoint(s, .35, .02) : sectionPoint(s, s.width - .35, .02));
  const crest = (s) => crestAt(side === 'west' ? westCrest : eastCrest, s.Y);
  const pos = [], uv = [], idx = [];
  const n = 4;
  let row = 0;
  for (let i = fromI; i <= toI; i++) {
    const s = stations[i], A = foot(s), B = crest(s);
    if (!B) continue;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      pos.push(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
      uv.push(s.arc / uMetres, t);
    }
    if (row) for (let k = 0; k < n; k++) { const a = (row - 1) * (n + 1) + k, b = row * (n + 1) + k; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    row++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) { const flipped = []; for (let i = 0; i < idx.length; i += 3) flipped.push(idx[i], idx[i + 2], idx[i + 1]); g.setIndex(flipped); g.computeVertexNormals(); }
  const mesh = geometryToMesh(g, material, group);
  colliders.push(g);
  return mesh;
}

// The bare concrete bays on the slopes behave like walls for the designs.
function buildBay(bay, tier, detail, shared, group, colliders) {
  const side = bay.side, curveSet = side === 'west' ? westCrest : eastCrest;
  const fromI = stations.findIndex((s) => s.Y >= bay.yFrom), toI = stations.findIndex((s) => s.Y >= bay.yTo);
  const pos = [], uv = [], uv1 = [], idx = [];
  let L = 0, last = null;
  const foot = (s) => (side === 'west' ? sectionPoint(s, .35, .03) : sectionPoint(s, s.width - .35, .03));
  const rows = [];
  for (let i = fromI; i <= toI; i++) {
    const s = stations[i], A = foot(s), B = crestAt(curveSet, s.Y);
    const mid = [(A[0] + B[0]) / 2, (A[2] + B[2]) / 2];
    if (last) L += Math.hypot(mid[0] - last[0], mid[1] - last[1]);
    last = mid;
    rows.push({ A, B, s: L, h: Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]) });
  }
  const H = Math.max(...rows.map((r) => r.h));
  rows.forEach((r, i) => {
    pos.push(...r.A, ...r.B);
    uv.push(r.s / L, 0, r.s / L, r.h / H);
    uv1.push(r.s / .34, 0, r.s / .34, r.h / .34);
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) { const flipped = []; for (let i = 0; i < idx.length; i += 3) flipped.push(idx[i], idx[i + 2], idx[i + 1]); g.setIndex(flipped); g.computeVertexNormals(); }
  const pxPerMetre = tier === 'high' ? 110 : 44;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(L * pxPerMetre); canvas.height = Math.ceil(H * pxPerMetre);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 16;
  const material = wallMaterial(detail, shared);
  material.map = map; material.side = THREE.DoubleSide;
  const mesh = geometryToMesh(g, material, group);
  mesh.userData.keepWhole = true;
  bay.L = L; bay.H = H;
  bay.segments = [{ canvas, map, s0: 0, s1: L, mesh }];
  bay.fromI = fromI; bay.toI = toI;
}

// Buildings --------------------------------------------------------------------------------------
class BuildingBatch {
  constructor() { this.walls = []; this.roofs = []; this.glass = []; this.frames = []; this.colliders = []; this.facades = { tan: [], gate: [], garage: [], house: [] }; }

  box(list, x, y, z, w, h, d, yaw, color) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv, normal = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      const horizontal = Math.abs(normal.getY(i)) > .5;
      const across = Math.abs(normal.getX(i)) > .5 ? d : w;
      uv.setXY(i, uv.getX(i) * (horizontal ? w : across) / 3, uv.getY(i) * (horizontal ? d : h) / 3);
    }
    const c = new THREE.Color(color || '#ffffff');
    const colors = new Float32Array(uv.count * 3);
    for (let i = 0; i < uv.count; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y + h / 2, z));
    list.push(g);
    return g;
  }

  // Hipped roof: two trapezoids and two triangles over the footprint.
  hip(list, x, y, z, w, d, rise, yaw, color) {
    const r = Math.min(w, d) * .42, hw = w / 2 + .3, hd = d / 2 + .3;
    const v = [[-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd], [-hw + r, rise, 0], [hw - r, rise, 0]];
    const faces = [[0, 5, 1, 0, 4, 5], [2, 4, 3, 2, 5, 4], [1, 5, 2], [3, 4, 0]];
    const pos = [], uv = [];
    faces.forEach((f) => f.forEach((k) => { pos.push(...v[k]); uv.push((v[k][0] + hw) / 2.4, (v[k][2] + hd + v[k][1] * 1.3) / 2.4); }));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const c = new THREE.Color(color), colors = new Float32Array(pos.length);
    for (let i = 0; i < pos.length / 3; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z));
    list.push(g);
  }

  // One flat wall piece with texture coordinates, in the house's own axes.
  panel(list, x, y, z, yaw, a, b, height, offset, u, v0 = 0, v1 = 1, color = '#ffffff') {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([a, 0, offset, b, 0, offset, a, height, offset, b, height, offset], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, v0, u, v0, 0, v1, u, v1], 2));
    const c = new THREE.Color(color), colors = new Float32Array(12);
    for (let i = 0; i < 4; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setIndex([0, 1, 2, 1, 3, 2]);
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z));
    list.push(g);
  }

  // Fronts come from real photographs of the street; yaw turns the photographed side (+Z) to the road.
  house(x, y, z, w, d, floors, yaw, random, detailed = true) {
    const tints = { tan: '#d9b78f', gate: '#c9c8c4', garage: '#d8cfbd', house: '#a9a8a6' };
    const roofs = ['#6d3430', '#6d3430', '#733a30', '#5f6367', '#4f5f63', '#6d3430'];
    const pick = random();
    const kind = floors > 1 ? 'house' : pick < .42 ? 'tan' : pick < .68 ? 'gate' : 'garage';
    const h = floors > 1 ? floors * 2.9 : 3.1;
    const tile = { tan: 12.4, gate: 15.6, garage: 8, house: 10.4 }[kind];
    const tint = tints[kind], repeat = Math.max(1, Math.round(w / tile));
    this.box(this.walls, x, y - 3.5, z, w - .04, h + 3.5, d - .04, yaw, tint);
    if (detailed) {
      this.panel(this.facades[kind], x, y, z, yaw, -w / 2, w / 2, h, d / 2, repeat, 0, 1 * (floors > 1 ? floors : 1));
      this.panel(this.facades[kind], x, y, z, yaw + Math.PI, -w / 2, w / 2, h, d / 2, repeat, 0, 1 * (floors > 1 ? floors : 1));
    }
    // Eaves: dark fascia and soffit so the roof never looks hollow from below.
    this.box(this.walls, x, y + h - .02, z, w + 1, .14, d + 1, yaw, '#6d6258');
    this.hip(this.roofs, x, y + h + .1, z, w + .3, d + .3, Math.min(w, d) * .17, yaw, roofs[Math.floor(random() * roofs.length)]);
    if (floors > 1) {
      const cos = Math.cos(yaw), sin = Math.sin(yaw);
      [-1, 1].forEach((face) => {
        const lx = (w / 2 + .03) * face, wy = y + 3.9;
        this.box(this.frames, x + lx * cos, wy - .07, z - lx * sin, .12, 1.5, 1.3, yaw, '#5b4a3c');
        this.box(this.glass, x + (lx + .05 * face) * cos, wy, z - (lx + .05 * face) * sin, .04, 1.36, 1.14, yaw);
      });
    }
    if (detailed) {
      const cos = Math.cos(yaw), sin = Math.sin(yaw), at = (lx, lz) => [x + lx * cos + lz * sin, z - lx * sin + lz * cos];
      // Yellow gas pipe along the front, as on every house in the photographs.
      const front = at(0, d / 2 + .1);
      this.box(this.frames, front[0], y + h - .42, front[1], w, .07, .07, yaw, '#b8982f');
      for (let lx = -w / 2 + 2; lx < w / 2; lx += 7 + random() * 4) { const r = at(lx, d / 2 + .1); this.box(this.frames, r[0], y, r[1], .06, h - .4, .06, yaw, '#b8982f'); }
      // Chimney or vent, sometimes a satellite dish on the roof.
      const vent = at((random() - .5) * w * .5, (random() - .5) * d * .3);
      this.box(this.frames, vent[0], y + h + .2, vent[1], .32, 1.05, .32, yaw, '#8c8a84');
      if (random() > .55) { const dish = at((random() - .5) * w * .6, d * .28); this.box(this.frames, dish[0], y + h + .35, dish[1], .05, .6, .05, yaw, '#b5b5b0'); this.box(this.frames, dish[0], y + h + .85, dish[1], .62, .55, .05, yaw, '#d6d4cd'); }
    }
    const footprint = new THREE.BoxGeometry(w, h, d);
    footprint.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y + h / 2, z));
    this.colliders.push(footprint);
  }

  meshes(group, materials, colliders) {
    const add = (list, material, shadow = true) => {
      if (!list.length) return;
      const clean = list.map((g) => { const c = g.index ? g.toNonIndexed() : g; return c; });
      geometryToMesh(mergeGeometries(clean, false), material, group, { cast: shadow });
    };
    add(this.walls, materials.plaster);
    add(this.roofs, materials.roof);
    add(this.frames, materials.frame, false);
    add(this.glass, materials.glass, false);
    Object.entries(this.facades).forEach(([kind, list]) => add(list, materials[kind]));
    colliders.push(...this.colliders);
  }
}

// Skyline ring: distant city, domes and the Zarafshan range in haze.
function skylineRing(shared) {
  const c = document.createElement('canvas'); c.width = 4096; c.height = 512;
  const g = c.getContext('2d');
  const random = seeded(9);
  const layer = (color, base, amp, freq) => {
    g.fillStyle = color; g.beginPath(); g.moveTo(0, 512);
    for (let x = 0; x <= 4096; x += 8) g.lineTo(x, base - (Math.sin(x * freq) + Math.sin(x * freq * 2.3 + 1) * .5 + Math.sin(x * freq * 5.1 + 2) * .2) * amp);
    g.lineTo(4096, 512); g.closePath(); g.fill();
  };
  layer('#9eadbd', 340, 70, .006);
  layer('#a9b3b9', 420, 22, .013);
  g.fillStyle = '#94a0a6';
  for (let x = 0; x < 4096; x += 14 + random() * 26) {
    const w = 14 + random() * 36, h = 8 + random() * 34;
    g.fillRect(x, 490 - h, w, h + 22);
    if (random() > .93) { g.beginPath(); g.arc(x + w / 2, 490 - h, w / 1.4, Math.PI, 0); g.fill(); g.fillRect(x - 5, 490 - h - 44, 5, 44 + h); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  const material = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide, color: '#ffffff' });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1900, 1900, 150, 96, 1, true), material);
  mesh.position.y = 60;
  mesh.userData.keepWhole = true;
  shared.skyline = material;
  return mesh;
}

// Ceremonial gate that also closes the walkable part of the road in an interesting way.
function gate(s, batchMaterial, group, colliders) {
  const c = across(s, .5), [ax, az] = axis(s), width = s.width + 6, height = 15;
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0); shape.lineTo(width / 2, 0); shape.lineTo(width / 2, height); shape.lineTo(-width / 2, height); shape.closePath();
  const open = new THREE.Path(), hw = width / 2 - 5;
  open.moveTo(-hw, 0); open.lineTo(hw, 0); open.lineTo(hw, 6.5);
  open.bezierCurveTo(hw, 10.2, 3.2, 11.6, 0, 13.1); open.bezierCurveTo(-3.2, 11.6, -hw, 10.2, -hw, 6.5); open.closePath();
  shape.holes.push(open);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 3.2, bevelEnabled: false });
  geometry.translate(0, 0, -1.6);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2.2, uv.getY(i) / 2.2);
  const mesh = new THREE.Mesh(geometry, batchMaterial);
  mesh.position.set(c[0], c[1] - .6, c[2]);
  mesh.rotation.y = -Math.atan2(az, ax);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.keepWhole = true;
  group.add(mesh);
  const barrier = new THREE.BoxGeometry(width, 12, .8);
  barrier.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.atan2(az, ax)).setPosition(c[0], c[1] + 4, c[2]));
  colliders.push(barrier);
}

function gateMaterial() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#1f5e74'; g.fillRect(0, 0, 512, 512);
  const cell = 128;
  for (let y = 0; y < 512; y += cell) for (let x = 0; x < 512; x += cell) {
    const cx = x + cell / 2, cy = y + cell / 2;
    g.fillStyle = '#e6d9b8'; g.beginPath();
    for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, r = i % 2 ? cell * .2 : cell * .42; i ? g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) : g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    g.closePath(); g.fill();
    g.fillStyle = '#c2912f'; g.beginPath(); g.arc(cx, cy, cell * .12, 0, 7); g.fill();
    g.strokeStyle = '#123f50'; g.lineWidth = 3; g.strokeRect(x, y, cell, cell);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map: t, roughness: .3, metalness: .05 });
}

// Everything -------------------------------------------------------------------------------------
export function buildWorld(scene, tier) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const shared = { washStrength: { value: 0 } };
  const aniso = tier === 'high' ? 12 : 4;

  const asphalt = photoMaterial('asphalt', { normal: 'asphalt_nor', vertexColors: true, roughness: .95, normalScale: .7 });
  const pavers = photoMaterial('pavers_gray', { normal: 'pavers_gray_nor', roughness: .9, normalScale: .45 });
  const redPavers = photoMaterial('pavers_red', { normal: 'pavers_gray_nor', roughness: .9, normalScale: .45 });
  const beige = photoMaterial('pavers_tan', { normal: 'pavers_gray_nor', roughness: .9, normalScale: .45 });
  const tactile = photoMaterial('pavers_yellow', { roughness: .85 });
  const curbStone = curbMaterial();
  const lawn = pbr('aerial_grass_rock', { color: '#8b9a6a', anisotropy: aniso });
  const ground = pbr('brown_mud_dry', { color: '#d9c5a4', anisotropy: aniso });
  const coping = pbr('concrete_pavement', { color: '#d6d4cf', roughness: .85, anisotropy: aniso });
  coping.side = THREE.DoubleSide;

  const last = stations.length - 1;
  const d = (fn) => (s) => fn(s);

  // Asphalt with a darker wheel-track tone, both carriageways.
  // Dust gathers along the curbs, wheels keep the middle of each lane darker.
  const trackTone = (t) => { const w = Math.sin(t * Math.PI * 4), edge = Math.abs(2 * t - 1) ** 4; return .9 + .07 * w * w + .2 * edge; };
  geometryToMesh(sweep(0, last, d((s) => roadPoint(s, SIDEWALK)), d((s) => roadPoint(s, SIDEWALK + LANE)), { uMetres: 9, vMetres: 9, lateral: 8, colorFn: trackTone }), asphalt, group);
  geometryToMesh(sweep(0, last, d((s) => roadPoint(s, s.width - SIDEWALK - LANE)), d((s) => roadPoint(s, s.width - SIDEWALK)), { uMetres: 9, vMetres: 9, lateral: 8, colorFn: trackTone }), asphalt, group);

  // Sidewalk bands on both sides, as measured from the photographs.
  const bandsWest = [[0, .35, beige], [.35, 3.6, pavers], [3.6, 4.2, tactile], [4.2, 5.6, redPavers], [5.6, 5.8, curbStone]];
  bandsWest.forEach(([a, b, material]) => {
    const uMetres = material === pavers || material === redPavers || material === beige ? 3.2 : material === tactile ? 1.2 : 1;
    geometryToMesh(sweep(0, last, (s) => sectionPoint(s, a), (s) => sectionPoint(s, b), { uMetres, vMetres: uMetres }), material, group);
    geometryToMesh(sweep(0, last, (s) => sectionPoint(s, s.width - b), (s) => sectionPoint(s, s.width - a), { uMetres, vMetres: uMetres }), material, group);
  });
  // Median: granite curbs, a red strip like the photo, planted where the survey leaves room.
  const medianA = (s) => SIDEWALK + LANE, medianB = (s) => s.width - SIDEWALK - LANE;
  geometryToMesh(sweep(0, last, (s) => sectionPoint(s, medianA(s)), (s) => sectionPoint(s, medianA(s) + .24), { uMetres: 1, vMetres: 1 }), curbStone, group);
  geometryToMesh(sweep(0, last, (s) => sectionPoint(s, medianB(s) - .24), (s) => sectionPoint(s, medianB(s)), { uMetres: 1, vMetres: 1 }), curbStone, group);
  // Median as photographed: curb, a narrow red strip, curb. Any extra width is planted further below.
  const stripA = (s) => s.width / 2 - .28, stripB = (s) => s.width / 2 + .28;
  geometryToMesh(sweep(0, last, (s) => sectionPoint(s, stripA(s)), (s) => sectionPoint(s, stripB(s)), { uMetres: 3.2, vMetres: 3.2 }), redPavers, group);
  geometryToMesh(sweep(0, last, (s) => sectionPoint(s, medianA(s) + .24), (s) => sectionPoint(s, stripA(s)), { uMetres: 1, vMetres: 1 }), curbStone, group);
  geometryToMesh(sweep(0, last, (s) => sectionPoint(s, stripB(s)), (s) => sectionPoint(s, medianB(s) - .24), { uMetres: 1, vMetres: 1 }), curbStone, group);
  const wideFrom = stations.findIndex((s) => s.width - 2 * (SIDEWALK + LANE) > 3);
  const wideRanges = [];
  let open = -1;
  stations.forEach((s, i) => {
    const wide = s.width - 2 * (SIDEWALK + LANE) > 3;
    if (wide && open < 0) open = i;
    if ((!wide || i === last) && open >= 0) { wideRanges.push([open, i - 1]); open = -1; }
  });
  wideRanges.forEach(([from, to]) => {
    if (to - from < 3) return;
    geometryToMesh(sweep(from, to, (s) => sectionPoint(s, medianA(s) + .4, .05), (s) => sectionPoint(s, medianB(s) - .4, .05), { uMetres: 6, vMetres: 6 }), lawn, group);
  });
  void wideFrom;

  // Lane markings.
  const paint = new THREE.MeshStandardMaterial({ color: '#e8e6e0', roughness: .6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const marks = [];
  const laneLine = (offset, dashed) => {
    for (let i = 0; i < last - 2; i += dashed ? 3 : 1) {
      const span = dashed ? 1 : 1;
      const p = stations[i], q = stations[i + span];
      const pos = [...sectionPoint(p, offset(p) - .06, .012), ...sectionPoint(p, offset(p) + .06, .012), ...sectionPoint(q, offset(q) - .06, .012), ...sectionPoint(q, offset(q) + .06, .012)];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      g.setIndex(pos[2] < 0 ? [0, 2, 1, 1, 2, 3] : [0, 2, 1, 1, 2, 3]);
      marks.push(g);
    }
  };
  laneLine(() => SIDEWALK + LANE / 2, true);
  laneLine((s) => s.width - SIDEWALK - LANE / 2, true);
  laneLine(() => SIDEWALK + .22, false);
  laneLine((s) => s.width - SIDEWALK - .22, false);
  // Zebra crossings at the middle of the slopes.
  [1965, 2042].forEach((Y) => {
    const i0 = stations.indexOf(station(Y));
    const s = stations[i0], t = stations[i0 + 2];
    for (let d = SIDEWALK + .3; d < s.width - SIDEWALK - .5; d += 1) {
      const pos = [...sectionPoint(s, d, .014), ...sectionPoint(s, d + .5, .014), ...sectionPoint(t, d, .014), ...sectionPoint(t, d + .5, .014)];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      g.setIndex([0, 2, 1, 1, 2, 3]);
      marks.push(g);
    }
  });
  const marksMesh = geometryToMesh(mergeGeometries(marks), paint, group);
  marksMesh.material.side = THREE.DoubleSide;

  // Walkable ground for physics: a coarse copy of the section.
  const coarse = 3;
  [[0, SIDEWALK - .05], [SIDEWALK - .05, SIDEWALK + .05]].forEach(() => {});
  const collideBand = (a, b) => colliders.push(sweep(0, last, a, b, { every: coarse }));
  collideBand((s) => sectionPoint(s, 0), (s) => sectionPoint(s, SIDEWALK - .25));
  collideBand((s) => sectionPoint(s, SIDEWALK - .25), (s) => sectionPoint(s, SIDEWALK + .05));
  collideBand((s) => sectionPoint(s, SIDEWALK + .05), (s) => sectionPoint(s, medianA(s) - .05));
  collideBand((s) => sectionPoint(s, medianA(s) - .05), (s) => sectionPoint(s, medianA(s) + .3));
  collideBand((s) => sectionPoint(s, medianA(s) + .3), (s) => sectionPoint(s, medianB(s) - .3));
  collideBand((s) => sectionPoint(s, medianB(s) - .3), (s) => sectionPoint(s, medianB(s) + .05));
  collideBand((s) => sectionPoint(s, medianB(s) + .05), (s) => sectionPoint(s, s.width - SIDEWALK - .05));
  collideBand((s) => sectionPoint(s, s.width - SIDEWALK - .05), (s) => sectionPoint(s, s.width - SIDEWALK + .25));
  collideBand((s) => sectionPoint(s, s.width - SIDEWALK + .25), (s) => sectionPoint(s, s.width));

  // Design walls ---------------------------------------------------------------------------------
  const detail = stoneDetail();
  shared.wallDetail = detail;
  const wallList = [];
  const tops = {};
  Object.values(walls).forEach((wall) => { tops[wall.id] = buildWall(wall, tier, detail, shared, group, colliders); wallList.push(wall); });

  // One viewing spot on the low wall and one on the high wall for the "assembly" design.
  const markLow = anamorph(walls.low, 104, 95, 3);
  const markLow2 = anamorph(walls.low, 8, 17, 3);
  const markHigh = anamorph(walls.high, 50, 35, 4);
  walls.low.anamorph = { assembly: [markLow, markLow2] };
  walls.high.anamorph = { assembly: [markHigh] };
  shared.viewpoints = [markLow, markHigh, markLow2];

  // Slopes with the existing tile pattern, leaving the two bays for the designs.
  const slopeA = slopeMaterial(false), slopeB = slopeMaterial(true);
  Object.values(bays).forEach((bay) => { buildBay(bay, tier, detail, shared, group, colliders); wallList.push(bay); });
  const iW0 = stations.findIndex((s) => s.Y >= westCrest[0][1]), iW1 = stations.findIndex((s) => s.Y >= westCrest[westCrest.length - 1][1]) - 1;
  const iE0 = stations.findIndex((s) => s.Y >= eastCrest[0][1]), iE1 = stations.findIndex((s) => s.Y >= eastCrest[eastCrest.length - 1][1]) - 1;
  slopeBand('west', iW0, bays.zone68.fromI, slopeA, group, colliders);
  slopeBand('west', bays.zone68.toI, iW1, slopeB, group, colliders);
  slopeBand('east', iE0, bays.zone52.fromI, slopeB, group, colliders);
  slopeBand('east', bays.zone52.toI, iE1, slopeA, group, colliders);
  [bays.zone68, bays.zone52].forEach((bay) => {
    colliders.push(new THREE.BufferGeometry().copy(bay.segments[0].mesh.geometry));
  });

  // Crest line per side, used by the railing and the terrain above.
  const crestLine = { west: [], east: [] };
  stations.forEach((s, i) => {
    if (i % 2) return;
    const westWall = s.Y >= 1840.5 && s.Y <= 1890.54, eastWall = s.Y >= 1850.54 && s.Y <= 1958.61;
    const wc = crestAt(westCrest, s.Y);
    const ec = crestAt(eastCrest, s.Y);
    const [ax, az] = axis(s);
    const bank = (side) => {
      const edge = side < 0 ? s.W : s.E;
      return [edge[0] + side * ax * 2.5, edge[1] + .8, edge[2] + side * az * 2.5];
    };
    const onCurve = (wall, Y) => { const near = wall.curve.reduce((best, p) => (Math.abs(-p.z - (Y - 1960)) < Math.abs(-best.z - (Y - 1960)) ? p : best), wall.curve[0]); return [near.x, near.top, near.z]; };
    crestLine.west.push(westWall ? onCurve(walls.high, s.Y) : wc || bank(-1));
    crestLine.east.push(eastWall ? onCurve(walls.low, s.Y) : ec || bank(1));
  });
  const coarseStations = stations.filter((_, i) => i % 2 === 0);

  // Promenade and ground above the crest line.
  const outward = (list, side, offset, lift) => list.map((p, i) => {
    const s = coarseStations[i], [ax, az] = axis(s);
    return [p[0] + side * ax * offset, p[1] + lift, p[2] + side * az * offset];
  });
  const stripFrom = (a, b, material, u = 2.4) => {
    const pos = [], uv = [], idx = [];
    a.forEach((p, i) => {
      pos.push(...p, ...b[i]);
      const l = Math.hypot(b[i][0] - p[0], b[i][2] - p[2]);
      uv.push(0, i * 4 / u, l / u, i * 4 / u);
      if (i) { const k = (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) { const flipped = []; for (let i = 0; i < idx.length; i += 3) flipped.push(idx[i], idx[i + 2], idx[i + 1]); g.setIndex(flipped); g.computeVertexNormals(); }
    geometryToMesh(g, material, group);
    colliders.push(g);
    return g;
  };
  const panelMaterial = girihPanelMaterial();
  const panels = [], posts = [];
  const matrix = new THREE.Matrix4();
  const railMetal = new THREE.MeshStandardMaterial({ color: '#25282a', roughness: .4, metalness: .7, side: THREE.DoubleSide });
  // The side street cuts the east side, so each side is a list of continuous pieces.
  const pieceRanges = { west: [[-1e9, 1e9]], east: [[-1e9, 1826], [1851, 1e9]] };
  [['west', -1], ['east', 1]].forEach(([name, side]) => {
    pieceRanges[name].forEach(([yFrom, yTo]) => {
      const keep = crestLine[name].map((p, i) => ({ p, s: coarseStations[i], i })).filter(({ s }) => s.Y >= yFrom && s.Y <= yTo);
      const line = keep.map((k) => k.p);
      const out = (offset, lift) => keep.map(({ p, s }) => { const [ax, az] = axis(s); return [p[0] + side * ax * offset, p[1] + lift, p[2] + side * az * offset]; });
      const prom = out(3.4, .05), far = out(22, .35), farther = out(420, 3);
      stripFrom(line.map((p) => [p[0], p[1], p[2]]), prom, pavers, 3.2);
      stripFrom(prom, far, lawn, 8);
      stripFrom(far, farther, ground, 18);
      const copingLine = line.map((p) => [p[0], p[1], p[2]]);
      geometryToMesh(rail(copingLine, .55, .22), coping, group, { cast: true });
      // The railing opens where a staircase comes up the slope.
      const inGap = (Y) => STAIRS.some((st) => st.side === name && Math.abs(Y - st.Y) < 2.6);
      const runs2 = [];
      keep.forEach((k) => {
        if (inGap(k.s.Y)) { runs2.push(null); return; }
        if (!runs2.length || runs2[runs2.length - 1] === null) runs2.push([]);
        runs2[runs2.length - 1].push(k);
      });
      runs2.filter((r) => r && r.length > 1).forEach((r) => {
        const pts = r.map((k) => [k.p[0], k.p[1], k.p[2]]);
        geometryToMesh(rail(pts.map((p) => [p[0], p[1] + 1.3, p[2]]), .07, .05), railMetal, group, { cast: true });
        const [railX, railZ] = axis(r[Math.floor(r.length / 2)].s);
        colliders.push(...thick(pts, pts.map((p) => [p[0], p[1] + 1.6, p[2]]), -side * railX, -side * railZ, .3));
      });
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i], b = line[i + 1];
        if (Math.abs(a[1] - b[1]) > .6 || inGap(keep[i].s.Y) || inGap(keep[i + 1].s.Y)) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute([a[0], a[1] + .3, a[2], b[0], b[1] + .3, b[2], a[0], a[1] + 1.26, a[2], b[0], b[1] + 1.26, b[2]], 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 1, 2, 1], 2));
        g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
        g.setIndex([0, 1, 2, 1, 3, 2]);
        panels.push(g);
        posts.push(a);
      }
      // Grass bank from the sidewalk up to the crest where no wall or slope stands.
      const banks = keep.filter(({ s }) => (name === 'west' ? s.Y < 1842 || s.Y > 2090 : s.Y < 1826 || s.Y > 2070));
      const runs = [];
      banks.forEach((k) => { const r = runs[runs.length - 1]; if (r && k.i === r[r.length - 1].i + 1) r.push(k); else runs.push([k]); });
      runs.filter((r) => r.length > 1).forEach((r) => stripFrom(r.map(({ s }) => (name === 'west' ? s.W : s.E)), r.map(({ p }) => [p[0], p[1], p[2]]), lawn, 8));
    });
  });
  geometryToMesh(mergeGeometries(panels), panelMaterial, group, { cast: true });
  const finial = new THREE.SphereGeometry(.05, 10, 8); finial.translate(0, .65, 0);
  const postShape = mergeGeometries([new THREE.BoxGeometry(.11, 1.2, .11).toNonIndexed(), finial.toNonIndexed()]);
  const postMesh = new THREE.InstancedMesh(postShape, new THREE.MeshStandardMaterial({ color: '#35383b', roughness: .5, metalness: .5 }), posts.length);
  posts.forEach((p, i) => postMesh.setMatrixAt(i, matrix.makeTranslation(p[0], p[1] + .78, p[2])));
  postMesh.castShadow = true;
  group.add(postMesh);

  // Staircases: real steps to look at, the slope under them carries the walker.
  const stepMaterial = coping;
  STAIRS.forEach(({ side: stairSide, Y }) => {
    const s = station(Y), foot = stairSide === 'west' ? sectionPoint(s, .3) : sectionPoint(s, s.width - .3), top = crestAt(stairSide === 'west' ? westCrest : eastCrest, Y);
    if (!top) return;
    const count = Math.max(3, Math.round((top[1] - foot[1]) / .17)), yaw = Math.atan2(top[0] - foot[0], top[2] - foot[2]);
    for (let k = 0; k < count; k++) {
      const t = (k + .5) / count, h = (top[1] - foot[1]) / count;
      const g = new THREE.BoxGeometry(4.2, h * 1.4, Math.hypot(top[0] - foot[0], top[2] - foot[2]) / count + .02);
      g.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw).setPosition(foot[0] + (top[0] - foot[0]) * t, foot[1] + (top[1] - foot[1]) * t + h * .1, foot[2] + (top[2] - foot[2]) * t));
      geometryToMesh(g, stepMaterial, group, { cast: true });
    }
  });

  // Concrete wing walls close the jumps where a wall ends and the crest line carries on lower.
  // Faced with the real board-formed concrete from the site photo, one texture spans 33 m by 5.4 m.
  const wingMaterial = photoMaterial('concrete', { roughness: .95 }); wingMaterial.side = THREE.DoubleSide;
  const wing = (wall, atEnd, slopeBottom, slopeTop) => {
    const c = wall.curve[atEnd ? wall.curve.length - 1 : 0];
    const length = Math.hypot(slopeTop[0] - c.x, slopeTop[2] - c.z), low = Math.min(c.base, slopeBottom[1]) - 1;
    const v = (y) => (y - low) / 5.4, u = length / 33;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([c.x, c.base - 1, c.z, c.x, c.top, c.z, slopeTop[0], slopeTop[1], slopeTop[2], slopeBottom[0], slopeBottom[1] - 1, slopeBottom[2]], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, v(c.base - 1), 0, v(c.top), u, v(slopeTop[1]), u, v(slopeBottom[1] - 1)], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    geometryToMesh(g, wingMaterial, group, { cast: true });
    const ex = slopeTop[0] - c.x, ez = slopeTop[2] - c.z, el = Math.hypot(ex, ez) || 1;
    const centre = across(station(1960 - (c.z + slopeTop[2]) / 2), .5);
    const n = (ez / el) * (centre[0] - c.x) + (-ex / el) * (centre[2] - c.z) > 0 ? [ez / el, -ex / el] : [-ez / el, ex / el];
    colliders.push(...thick([[c.x, c.base - 2, c.z], [slopeBottom[0], slopeBottom[1] - 2, slopeBottom[2]]], [[c.x, c.top + 1, c.z], [slopeTop[0], slopeTop[1] + 1, slopeTop[2]]], n[0], n[1]));
  };
  const sW = station(westCrest[0][1] + 1), sE = station(eastCrest[0][1] + 1), sHigh = station(1838);
  wing(walls.high, true, sectionPoint(sW, .3), crestAt(westCrest, sW.Y));
  wing(walls.low, true, sectionPoint(sE, sE.width - .3), crestAt(eastCrest, sE.Y));
  wing(walls.high, false, sHigh.W, [sHigh.W[0] - 2.5, sHigh.W[1] + .8, sHigh.W[2]]);
  { // South end of the long wall turns the corner into the side street.
    const c = walls.low.curve[0], s = station(1849), p = [s.E[0] + 4, c.base - .4, s.E[2] + 2.5];
    wing(walls.low, false, p, [p[0], c.top - .2, p[2]]);
  }

  // Buildings above the crest lines, rows thinning out with distance.
  const batch = new BuildingBatch();
  const random = seeded(4242);
  ['west', 'east'].forEach((name) => {
    const side = name === 'west' ? -1 : 1, line = crestLine[name];
    for (let row = 0; row < 3; row++) {
      let i = 2 + Math.floor(random() * 3);
      while (i < line.length - 2) {
        const s = coarseStations[i], [ax, az] = axis(s);
        if (name === 'east' && s.Y > 1690 && s.Y < 1856) { i += 4; continue; }
        const nearSurvey = s.Y > 1780 && s.Y < 2160;
        const span = row === 0 ? 16 + random() * 12 : 10 + random() * 12;
        const offset = 5.5 + row * 15 + random() * 1.2;
        const base = line[i], depth = 8 + random() * 3;
        const x = base[0] + side * ax * (offset + depth / 2), z = base[2] + side * az * (offset + depth / 2);
        const span2 = Math.min(span, 26);
        // Long row-house fronts along the road: the long side faces the street.
        batch.house(x, base[1] + .3 + row * .4, z, span2, depth, random() > .8 ? 2 : 1, Math.atan2(-side * ax, -side * az), random, row === 0);
        void nearSurvey;
        i += Math.ceil((span2 + (row === 0 ? .4 : 3 + random() * 6)) / 4);
      }
    }
  });
  // House on the mound above the stepped wall, like photo 121133.
  const hr = seeded(11);
  { const e0 = walls.step.curve[walls.step.curve.length - 1], f0 = walls.step.curve[0], l0 = Math.hypot(f0.x - e0.x, f0.z - e0.z), ux0 = (f0.x - e0.x) / l0, uz0 = (f0.z - e0.z) / l0;
    batch.house(f0.x + ux0 * 12 - uz0 * 8, e0.top + .05, f0.z + uz0 * 12 + ux0 * 8, 12, 8, 2, Math.atan2(-uz0, ux0), hr); }
  // Low buildings along the far side of the side street.
  { const e = walls.step.curve[walls.step.curve.length - 1], f = walls.step.curve[0], l = Math.hypot(f.x - e.x, f.z - e.z), ax = (f.x - e.x) / l, az = (f.z - e.z) / l;
    for (let k = 0; k < 4; k++) batch.house(e.x + ax * (8 + k * 17) + az * 18, e.base + .5 + k * .2, e.z + az * (8 + k * 17) - ax * 18, 15, 8, k % 2 ? 2 : 1, Math.atan2(-az, ax), hr);
  }
  const buildingMaterials = {
    plaster: photoMaterial('stucco', { vertexColors: true, anisotropy: 4 }),
    roof: roofMaterial(),
    frame: new THREE.MeshStandardMaterial({ color: '#efe9de', roughness: .6, vertexColors: true }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#27384a', roughness: .06, metalness: .95, emissive: '#ffcf8c', emissiveIntensity: 0 }),
    tan: photoMaterial('facade_tan', { anisotropy: 8 }), gate: photoMaterial('facade_gate', { anisotropy: 8 }),
    garage: photoMaterial('facade_garage', { anisotropy: 8 }), house: photoMaterial('facade_house', { anisotropy: 8 }),
  };
  shared.windows = buildingMaterials.glass;
  batch.meshes(group, buildingMaterials, colliders);

  // Side street between the stepped wall and the low wall.
  const stepEnd = walls.step.curve[walls.step.curve.length - 1], stepStart = walls.step.curve[0];
  const sx = stepStart.x - stepEnd.x, sz = stepStart.z - stepEnd.z, sl = Math.hypot(sx, sz), ux = sx / sl, uz = sz / sl, vx = uz, vz = -ux;
  const sideStreetStart = [stepEnd.x - ux * 6, stepEnd.base - .02, stepEnd.z - uz * 6];
  const corner = (along, off, lift = 0) => [sideStreetStart[0] + ux * along + vx * off, sideStreetStart[1] + lift + along * .012, sideStreetStart[2] + uz * along + vz * off];
  const sideQuad = (a0, a1, o0, o1, material, uMetres = 4) => {
    const pos = [], uv = [], idx = [];
    for (let k = 0; k <= 16; k++) {
      const a = a0 + (a1 - a0) * k / 16;
      pos.push(...corner(a, o0), ...corner(a, o1));
      uv.push(0, a / uMetres, Math.abs(o1 - o0) / uMetres, a / uMetres);
      if (k) { const n = (k - 1) * 2; idx.push(n, n + 1, n + 2, n + 1, n + 3, n + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const c = new Float32Array(pos.length).fill(.95);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.setIndex(idx); g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) { const flipped = []; for (let i = 0; i < idx.length; i += 3) flipped.push(idx[i], idx[i + 2], idx[i + 1]); g.setIndex(flipped); g.computeVertexNormals(); }
    geometryToMesh(g, material, group);
    colliders.push(g);
  };
  { // Land around the side street at street level.
    const c = corner(30, 5);
    const land = new THREE.PlaneGeometry(190, 170); land.rotateX(-Math.PI / 2);
    const uvL = land.attributes.uv; for (let i = 0; i < uvL.count; i++) uvL.setXY(i, uvL.getX(i) * 22, uvL.getY(i) * 20);
    land.translate(c[0] + 42, stepEnd.base - .25, c[2] + 26);
    geometryToMesh(land, lawn, group);
    colliders.push(land);
  }
  sideQuad(-4, 70, 1.8, 9, asphalt, 4);
  sideQuad(-4, 70, 0, 1.8, pavers, 2.4);
  sideQuad(-4, 70, 9, 11, pavers, 2.4);

  // The block behind the stepped wall: neat concrete retaining walls, a lawn on top that dips to the low steps.
  {
    const level = stepEnd.top + .05;
    const concrete = photoMaterial('concrete', { roughness: .95 }); concrete.side = THREE.DoubleSide;
    const rows = stations.filter((st) => st.Y >= 1822 && st.Y <= 1841);
    const edge = rows.filter((_, i) => i % 2 === 0).map((st) => [st.E[0], st.E[1], st.E[2]]);
    const far = [stepStart.x + ux * 24, stepStart.base, stepStart.z + uz * 24];
    const retaining = (line, nx, nz) => {
      let run = 0;
      const pos2 = [], uv2 = [], idx2 = [];
      line.forEach((p, i) => {
        if (i) run += Math.hypot(p[0] - line[i - 1][0], p[2] - line[i - 1][2]);
        pos2.push(p[0], p[1] - 1, p[2], p[0], p[3] ?? level, p[2]);
        uv2.push(run / 33, 0, run / 33, ((p[3] ?? level) - p[1] + 1) / 5.4);
        if (i) { const k = (i - 1) * 2; idx2.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos2, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv2, 2));
      g.setIndex(idx2); g.computeVertexNormals();
      geometryToMesh(g, concrete, group, { cast: true });
      colliders.push(...thick(line.map((p) => [p[0], p[1] - 1, p[2]]), line.map((p) => [p[0], (p[3] ?? level) + 1.5, p[2]]), nx, nz));
    };
    retaining(edge, -1, 0);
    retaining([edge[0], [far[0], far[1], far[2]]], -.5, .85);
    retaining([[stepStart.x, stepStart.base, stepStart.z], [far[0], far[1], far[2]]], vx, vz);
    const northEdge = edge[edge.length - 1];
    retaining([northEdge, [stepEnd.x, stepEnd.base, stepEnd.z]], vx, vz);
    // The block sits at the lowest step, so the higher steps rise clear of it with a plain concrete back.
    const edgeX = (z) => edge.reduce((best, e) => (Math.abs(e[2] - z) < Math.abs(best[2] - z) ? e : best), edge[0])[0];
    const setBack = walls.step.curve.map((p) => { const z = p.z - vz * .25; return [Math.max(p.x - vx * .25, edgeX(z) + .05), level, z]; });
    retaining(walls.step.curve.map((p, i) => [setBack[i][0], level - 1, setBack[i][2], p.top + .1]), -vx, -vz);
    const outline = [...setBack.slice().reverse(), far, ...edge].map((p) => new THREE.Vector2(p[0], -p[2]));
    if (THREE.ShapeUtils.isClockWise(outline)) outline.reverse();
    const top = new THREE.ShapeGeometry(new THREE.Shape(outline), 1);
    top.rotateX(-Math.PI / 2); top.translate(0, level, 0);
    const uvTop = top.attributes.uv; for (let i = 0; i < uvTop.count; i++) uvTop.setXY(i, uvTop.getX(i) / 8, uvTop.getY(i) / 8);
    geometryToMesh(top, lawn, group);
  }
  geometryToMesh(rail(walls.step.curve.map((p) => [p.x, p.top, p.z]), .5, .18), coping, group, { cast: true });

  // Far ground and low city fill so the world never ends at an edge.
  const farGround = new THREE.Mesh(new THREE.CircleGeometry(2400, 48), new THREE.MeshStandardMaterial({ color: '#a79b82', roughness: 1 }));
  farGround.rotation.x = -Math.PI / 2; farGround.position.y = -6; farGround.receiveShadow = false;
  farGround.userData.keepWhole = true;
  group.add(farGround);
  const q = new THREE.Quaternion(), pos = new THREE.Vector3(), scale = new THREE.Vector3();
  group.add(skylineRing(shared));

  // Gates close the walkable stretch far beyond the surveyed part.
  const gateMat = gateMaterial();
  shared.ends = { south: station(1640).Y, north: station(2400).Y };
  gate(station(1640), gateMat, group, colliders);
  gate(station(2400), gateMat, group, colliders);

  // Street lamps along both curbs.
  const lampSpots = [];
  for (let i = 8; i < last - 8; i += 16) {
    const s = stations[i];
    lampSpots.push({ p: sectionPoint(s, 4.9), dir: axis(s), sign: 1 });
    lampSpots.push({ p: sectionPoint(s, s.width - 4.9), dir: axis(s), sign: -1 });
  }
  const steel = new THREE.MeshStandardMaterial({ color: '#aeb2b3', roughness: .5, metalness: .55 });
  const poleG = new THREE.CylinderGeometry(.05, .095, 9.4, 10); poleG.translate(0, 4.7, 0);
  const fork = (sign) => { const arm = new THREE.BoxGeometry(2.3, .05, .05); arm.translate(1.15, 0, 0); arm.applyMatrix4(new THREE.Matrix4().makeRotationZ(sign > 0 ? .62 : Math.PI - .62).setPosition(0, 9.3, 0)); return arm.toNonIndexed(); };
  const armG = mergeGeometries([fork(1), fork(-1)]);
  const head = (sign) => { const part = new THREE.BoxGeometry(.6, .06, .2); part.translate(sign * 2.05, 10.67, 0); return part.toNonIndexed(); };
  const lampHead = mergeGeometries([head(1), head(-1)]);
  const baseG = new THREE.CylinderGeometry(.17, .2, .5, 12); baseG.translate(0, .25, 0);
  const lampMaterial = new THREE.MeshStandardMaterial({ color: '#f4f4f0', emissive: '#ffdca8', emissiveIntensity: 0 });
  shared.lampMaterial = lampMaterial;
  const instance = (geometry, material) => {
    const mesh = new THREE.InstancedMesh(geometry, material, lampSpots.length);
    lampSpots.forEach(({ p, dir, sign }, i) => {
      const angle = -Math.atan2(dir[1], dir[0]) + (sign > 0 ? 0 : Math.PI);
      mesh.setMatrixAt(i, matrix.makeRotationY(angle).setPosition(p[0], p[1], p[2]));
    });
    mesh.castShadow = geometry !== lampHead;
    group.add(mesh);
    return mesh;
  };
  instance(mergeGeometries([poleG.index ? poleG.toNonIndexed() : poleG, armG, baseG.index ? baseG.toNonIndexed() : baseG]), steel); instance(lampHead, lampMaterial);
  // Small things that make a street believable: drains, manholes, signs, bins, tufts of grass.
  const flatDisc = (canvasDraw, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; canvasDraw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: .02, roughness: .75, metalness: .25, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }); };
  const drainMaterial = flatDisc((g, w, h) => { g.fillStyle = '#26282a'; g.fillRect(0, 0, w, h); g.fillStyle = '#4d4f50'; for (let i = 0; i < 9; i++) g.fillRect(6 + i * (w - 12) / 9, 6, (w - 12) / 18, h - 12); g.strokeStyle = '#55565a'; g.lineWidth = 8; g.strokeRect(0, 0, w, h); }, 256, 128);
  const manholeMaterial = flatDisc((g, w) => { g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 2, 0, 7); g.fillStyle = '#3a3b3d'; g.fill(); g.lineWidth = 10; g.strokeStyle = '#242526'; g.stroke(); g.strokeStyle = '#55575a'; g.lineWidth = 5; for (let r = 30; r < w / 2 - 20; r += 26) { g.beginPath(); g.arc(w / 2, w / 2, r, 0, 7); g.stroke(); } for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.beginPath(); g.moveTo(w / 2 + Math.cos(a) * 30, w / 2 + Math.sin(a) * 30); g.lineTo(w / 2 + Math.cos(a) * (w / 2 - 24), w / 2 + Math.sin(a) * (w / 2 - 24)); g.stroke(); } }, 256, 256);
  const decals = { drain: [], manhole: [] };
  const flatQuad = (list, s, d, along, across_) => {
    const [ax, az] = axis(s), tx = -az, tz = ax, c = sectionPoint(s, d, .018);
    const corner = (a, b) => [c[0] + ax * a + tx * b, c[1], c[2] + az * a + tz * b];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...corner(-across_, -along), ...corner(across_, -along), ...corner(-across_, along), ...corner(across_, along)], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
    g.setIndex([0, 2, 1, 1, 2, 3]);
    list.push(g);
  };
  const detailRandom = seeded(909);
  for (let i = 30; i < last - 30; i += 13) {
    const s = stations[i];
    flatQuad(decals.drain, s, SIDEWALK + .42, .45, .22);
    flatQuad(decals.drain, stations[i + 6], stations[i + 6].width - SIDEWALK - .42, .45, .22);
  }
  for (let i = 25; i < last - 25; i += 34) { const s = stations[i], left = detailRandom() > .5; flatQuad(decals.manhole, s, left ? SIDEWALK + LANE * .5 : s.width - SIDEWALK - LANE * .5, .4, .4); }
  geometryToMesh(mergeGeometries(decals.drain), drainMaterial, group);
  geometryToMesh(mergeGeometries(decals.manhole), manholeMaterial, group);
  // Pedestrian crossing signs at both zebras.
  const signFace = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.fillStyle = '#1e5aa8'; g.fillRect(0, 0, 256, 256); g.strokeStyle = '#fff'; g.lineWidth = 12; g.strokeRect(10, 10, 236, 236); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(128, 30); g.lineTo(232, 226); g.lineTo(24, 226); g.closePath(); g.fill(); g.fillStyle = '#16181a'; g.beginPath(); g.arc(128, 96, 14, 0, 7); g.fill(); g.fillRect(118, 112, 20, 56); g.save(); g.translate(128, 150); g.rotate(.5); g.fillRect(-7, 0, 14, 56); g.restore(); g.save(); g.translate(128, 150); g.rotate(-.5); g.fillRect(-7, 0, 14, 56); g.restore(); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshStandardMaterial({ map: t, roughness: .4, metalness: .2, side: THREE.DoubleSide }); })();
  const signPole = [], signPlates = [];
  [1965, 2042].forEach((Y) => {
    const s = station(Y), [ax, az] = axis(s);
    [[SIDEWALK - .35, 1], [s.width - SIDEWALK + .35, -1]].forEach(([d, face]) => {
      const p = sectionPoint(s, d);
      const pole = new THREE.CylinderGeometry(.03, .03, 2.7, 8); pole.translate(p[0], p[1] + 1.35, p[2]);
      signPole.push(pole.toNonIndexed());
      const plate = new THREE.PlaneGeometry(.62, .62); plate.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.atan2(az, -ax) * 0 + (face > 0 ? Math.PI : 0)).setPosition(p[0], p[1] + 2.45, p[2]));
      signPlates.push(plate);
    });
  });
  geometryToMesh(mergeGeometries(signPole), new THREE.MeshStandardMaterial({ color: '#9ea2a4', roughness: .45, metalness: .6 }), group, { cast: true });
  geometryToMesh(mergeGeometries(signPlates), signFace, group);
  // Grass tufts, so the lawns stop looking like a painted floor up close.
  const tuftCanvas = document.createElement('canvas'); tuftCanvas.width = 256; tuftCanvas.height = 128;
  { const g = tuftCanvas.getContext('2d'); for (let i = 0; i < 90; i++) { const x = Math.random() * 256, h = 40 + Math.random() * 86, lean = (Math.random() - .5) * 34, tone = 70 + Math.random() * 60; g.strokeStyle = `rgb(${tone * .75 + 18},${tone * .85 + 26},${tone * .4})`; g.lineWidth = 1.6 + Math.random() * 2.4; g.beginPath(); g.moveTo(x, 128); g.quadraticCurveTo(x + lean * .2, 128 - h * .6, x + lean, 128 - h); g.stroke(); } }
  const tuftTexture = new THREE.CanvasTexture(tuftCanvas); tuftTexture.colorSpace = THREE.SRGBColorSpace; tuftTexture.anisotropy = 4;
  const tuftMaterial = new THREE.MeshStandardMaterial({ map: tuftTexture, color: '#9aa487', alphaTest: .35, side: THREE.DoubleSide, roughness: 1 });
  const tuftShape = mergeGeometries([new THREE.PlaneGeometry(.5, .17).translate(0, .085, 0), new THREE.PlaneGeometry(.5, .17).rotateY(Math.PI / 2).translate(0, .085, 0)]);
  { const up = tuftShape.attributes.normal; for (let i = 0; i < up.count; i++) up.setXYZ(i, 0, 1, 0); }
  const tuftSpots = [];
  stations.forEach((s, i) => {
    const room = s.width - 2 * (SIDEWALK + LANE);
    if (room < 3.4 || s.Y < 1660 || s.Y > 2380) return;
    for (let n = 0; n < Math.min(46, room * 2.4); n++) { const d = SIDEWALK + LANE + .6 + detailRandom() * (room - 1.2); if (Math.abs(d - s.width / 2) > .5) tuftSpots.push(sectionPoint(s, d, .05)); }
  });
  const tufts = new THREE.InstancedMesh(tuftShape, tuftMaterial, tuftSpots.length);
  const tuftQ = new THREE.Quaternion(), tuftP = new THREE.Vector3(), tuftS = new THREE.Vector3(), tuftUp = new THREE.Vector3(0, 1, 0);
  tuftSpots.forEach((p, i) => { const k = .7 + detailRandom() * .8; tufts.setMatrixAt(i, matrix.compose(tuftP.set(p[0], p[1], p[2]), tuftQ.setFromAxisAngle(tuftUp, detailRandom() * 3.14), tuftS.set(k, k, k))); });
  group.add(tufts);

  // Benches sit next to the walls, leaving a clear walking lane.
  // Concrete utility poles and sagging wires behind the railing, a big part of what makes the street read as real.
  const poleConcrete = new THREE.MeshStandardMaterial({ color: '#a9a69f', roughness: .92 });
  const wireMetal = new THREE.MeshStandardMaterial({ color: '#1e2022', roughness: .6 });
  const utilityBody = new THREE.BoxGeometry(.2, 8.6, .2); utilityBody.translate(0, 4.3, 0);
  const crossArm = new THREE.BoxGeometry(1.7, .08, .08); crossArm.translate(0, 8.1, 0);
  const utilityShape = mergeGeometries([utilityBody.toNonIndexed(), crossArm.toNonIndexed()]);
  const utilitySpots = [], wires = [];
  [['west', -1], ['east', 1]].forEach(([name, side]) => {
    const spots = [];
    crestLine[name].forEach((p, i) => {
      const s = coarseStations[i];
      if (i % 10 || s.Y < 1680 || s.Y > 2360 || (name === 'east' && s.Y > 1800 && s.Y < 1856)) return;
      const [ax, az] = axis(s);
      spots.push({ x: p[0] + side * ax * 3.6, y: p[1], z: p[2] + side * az * 3.6, ax, az });
    });
    spots.forEach((a, i) => {
      const yaw = -Math.atan2(a.az, a.ax);
      utilitySpots.push({ a, yaw });
      const b = spots[i + 1];
      if (!b) return;
      [-.72, 0, .72].forEach((off) => {
        const points = [];
        for (let k = 0; k <= 10; k++) {
          const t = k / 10, sag = 4 * t * (1 - t) * .55;
          points.push([a.x + (b.x - a.x) * t + a.ax * off, a.y + (b.y - a.y) * t + 8.14 - sag, a.z + (b.z - a.z) * t + a.az * off]);
        }
        wires.push(rail(points, .022, .022));
      });
    });
  });
  const utilityMesh = new THREE.InstancedMesh(utilityShape, poleConcrete, utilitySpots.length);
  utilitySpots.forEach(({ a, yaw }, i) => utilityMesh.setMatrixAt(i, matrix.makeRotationY(yaw).setPosition(a.x, a.y, a.z)));
  utilityMesh.castShadow = true;
  group.add(utilityMesh);
  geometryToMesh(mergeGeometries(wires), wireMetal, group);
  utilitySpots.forEach(({ a }) => { const box = new THREE.BoxGeometry(.4, 4, .4); box.translate(a.x, a.y + 2, a.z); colliders.push(box); });

  const benchWood = new THREE.MeshStandardMaterial({ color: '#5e5044', roughness: .7 });
  const benchIron = new THREE.MeshStandardMaterial({ color: '#23262a', roughness: .5, metalness: .6 });
  const seat = new THREE.BoxGeometry(1.9, .05, .46); seat.translate(0, .46, 0);
  const back = new THREE.BoxGeometry(1.9, .42, .05); back.translate(0, .72, -.24);
  const legs = mergeGeometries([[-.8], [.8]].map(([x]) => { const leg = new THREE.BoxGeometry(.07, .46, .46); leg.translate(x, .23, 0); return leg; }));
  const benchSpots = [];
  for (let i = 40; i < last - 40; i += 19) {
    const s = stations[i];
    if (s.Y < 1700 || s.Y > 2300) continue;
    const a = axis(s);
    benchSpots.push({ p: sectionPoint(s, .95), yaw: -Math.atan2(a[1], a[0]) + Math.PI / 2 });
    benchSpots.push({ p: sectionPoint(s, s.width - .95), yaw: -Math.atan2(a[1], a[0]) + Math.PI / 2 + Math.PI });
  }
  [[mergeGeometries([seat.toNonIndexed(), back.toNonIndexed()]), benchWood], [legs, benchIron]].forEach(([geometry, material]) => {
    const mesh = new THREE.InstancedMesh(geometry, material, benchSpots.length);
    benchSpots.forEach(({ p, yaw }, i) => mesh.setMatrixAt(i, matrix.makeRotationY(yaw).setPosition(p[0], p[1], p[2])));
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  });
  // People walk around lamps and benches, not through them.
  lampSpots.forEach(({ p }) => { const box = new THREE.BoxGeometry(.4, 3, .4); box.translate(p[0], p[1] + 1.5, p[2]); colliders.push(box); });
  benchSpots.forEach(({ p, yaw }) => { const box = new THREE.BoxGeometry(1.9, .55, .5); box.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw).setPosition(p[0], p[1] + .27, p[2])); colliders.push(box); });
  // Pools of light for the evening, cheap additive discs.
  const poolTexture = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    const h = g.createRadialGradient(128, 128, 4, 128, 128, 128); h.addColorStop(0, 'rgba(255,214,160,1)'); h.addColorStop(.45, 'rgba(255,196,130,.34)'); h.addColorStop(1, 'rgba(255,190,120,0)');
    g.fillStyle = h; g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  })();
  const pool = new THREE.MeshBasicMaterial({ map: poolTexture, transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4 });
  shared.pool = pool;
  const poolG = new THREE.PlaneGeometry(14, 14); poolG.rotateX(-Math.PI / 2);
  const pools = new THREE.InstancedMesh(poolG, pool, lampSpots.length);
  lampSpots.forEach(({ p, dir, sign }, i) => pools.setMatrixAt(i, matrix.makeTranslation(p[0] + dir[0] * sign * 1.5, p[1] + .05, p[2] + dir[1] * sign * 1.5)));
  group.add(pools);
  shared.lampSpots = lampSpots;

  // From here on the renderer only draws the map cells that are actually in view.
  chunkGroup(group, 200);
  shared.group = group;
  shared.groundMaterials = new Set([asphalt, pavers, redPavers, beige, tactile, curbStone, lawn, ground]);
  shared.plantMaterials = new Set([lawn, ground]);
  shared.leafMap = lawn.map; shared.leafNormal = lawn.normalMap;
  // Colliders into one invisible graph for the Octree.
  const collisionGroup = new THREE.Group();
  colliders.forEach((g) => { const mesh = new THREE.Mesh(g); collisionGroup.add(mesh); });
  shared.collision = collisionGroup;
  shared.wallList = wallList;
  shared.crestLine = crestLine;
  shared.coarseStations = coarseStations;
  return shared;
}

// Vegetation from Poly Haven models, instanced. Far copies use a rendered billboard.
export const NO_AMBIENT_OCCLUSION = 1;

export function plantVegetation(scene, shared, models, tier) {
  const random = seeded(31);
  const spots = [];
  shared.crestLine.west.forEach((p, i) => { if (i % 5 === 0) spots.push({ p, s: shared.coarseStations[i], side: -1 }); });
  shared.crestLine.east.forEach((p, i) => { if (i % 5 === 2) spots.push({ p, s: shared.coarseStations[i], side: 1 }); });
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  shared.group.updateMatrixWorld(true);
  const terrain = shared.group.children.filter((mesh) => shared.groundMaterials.has(mesh.material));
  const ray = new THREE.Raycaster(undefined, new THREE.Vector3(0, -1, 0), 0, 2);
  const plantBase = (x, y, z, landscapeOnly) => {
    ray.ray.origin.set(x, y + 1, z);
    const hit = ray.intersectObjects(terrain, false)[0];
    if (hit && (!landscapeOnly || shared.plantMaterials.has(hit.object.material))) return hit.point.y;
  };
  const placed = spots.flatMap(({ p, s, side }) => {
    const [ax, az] = axis(s), off = 5.5 + random() * 2.6;
    const x = p[0] + side * ax * off, z = p[2] + side * az * off;
    const scale = .85 + random() * .5, yaw = random() * 6.28;
    const y = plantBase(x, p[1], z, true);
    return y === undefined ? [] : [{ x, y, z, scale, yaw, Y: s.Y }];
  });
  // Wide median boulevard gets its own row of trees.
  stations.forEach((s, i) => {
    if (i % 7 === 0 && s.width - 2 * (SIDEWALK + LANE) > 5) { const c = sectionPoint(s, s.width / 2, .05); placed.push({ x: c[0], y: c[1], z: c[2], scale: .8 + random() * .4, yaw: random() * 6.28, Y: s.Y, median: true }); }
  });
  placed.forEach((t) => { const box = new THREE.BoxGeometry(.7, 3, .7); box.translate(t.x, t.y + 1.5, t.z); shared.collision.add(new THREE.Mesh(box)); });
  // All trees start as the baked billboard; the full models replace the nearest ones after loading.
  const w = 8.4, cross = mergeGeometries([new THREE.PlaneGeometry(w, w), new THREE.PlaneGeometry(w, w).rotateY(Math.PI / 2)]);
  cross.translate(0, w / 2, 0);
  // Lit from above so neither crossed plane reads as a dark sheet.
  const up = cross.attributes.normal; for (let i = 0; i < up.count; i++) up.setXYZ(i, .15, .95, .15);
  const cardMaterial = new THREE.MeshStandardMaterial({ map: models.billboard, color: '#c6d3af', alphaTest: .42, side: THREE.DoubleSide, roughness: .85, envMapIntensity: .65 });
  // Both faces of a card must light the same, otherwise half of each tree turns black.
  cardMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'));
  };
  const cards = new THREE.InstancedMesh(cross, cardMaterial, placed.length);
  placed.forEach((t, i) => { q.setFromAxisAngle(tmp.set(0, 1, 0), t.yaw); cards.setMatrixAt(i, matrix.compose(pos.set(t.x, t.y, t.z), q, scl.setScalar(t.scale))); });
  // The AO normals pass uses an opaque override material that fills the cutouts.
  cards.layers.set(NO_AMBIENT_OCCLUSION);
  cards.castShadow = true;
  scene.add(cards);
  shared.treeCards = cards;
  shared.treePlacements = placed;
  // Near trees become full models; each one is drawn only inside its radius, otherwise it stays a card.
  const treeUpdates = createTreeUpgrades(scene, placed, cards);
  const plants = new THREE.Group(); scene.add(plants);
  chunkGroup(plants, 70);
  shared.plants = plants;
  return treeUpdates;
}

export function createTreeUpgrades(scene, placed, cards) {
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), position = new THREE.Vector3(), scale = new THREE.Vector3();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const parts = [];
  let active = new Set();
  const placementMatrix = (tree) => matrix.compose(position.set(tree.x, tree.y, tree.z), rotation.setFromAxisAngle(tmp.set(0, 1, 0), tree.yaw), scale.setScalar(tree.scale));
  const upgradeTrees = (tree) => {
    tree.updateMatrixWorld(true);
    tree.traverse((child) => {
      if (!child.isMesh) return;
      const mesh = new THREE.InstancedMesh(child.geometry, child.material, placed.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.count = 0; mesh.frustumCulled = false;
      scene.add(mesh);
      parts.push({ mesh, transform: child.matrixWorld.clone() });
    });
  };
  const updateTrees = (eye) => {
    if (!parts.length) return;
    const nearest = placed.map((tree, index) => ({ tree, index })).filter(({ tree }) => Math.hypot(tree.x - eye.x, tree.z - eye.z) < 75);
    const next = new Set(nearest.map(({ index }) => index));
    if (next.size === active.size && [...next].every((index) => active.has(index))) return;
    active.forEach((index) => { if (!next.has(index)) cards.setMatrixAt(index, placementMatrix(placed[index])); });
    next.forEach((index) => { if (!active.has(index)) cards.setMatrixAt(index, hidden); });
    cards.instanceMatrix.needsUpdate = true;
    parts.forEach(({ mesh, transform }) => {
      mesh.count = nearest.length;
      nearest.forEach(({ tree }, index) => mesh.setMatrixAt(index, placementMatrix(tree).multiply(transform)));
      mesh.instanceMatrix.needsUpdate = true;
    });
    active = next;
  };
  return { upgradeTrees, updateTrees };
}

export { DESIGNS };
