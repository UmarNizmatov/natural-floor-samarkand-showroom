// Builds the finished street from the survey: road, sidewalks, walls, slopes, railing, buildings, lamps.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { stations, station, walls, bays, westCrest, eastCrest, crestAt, ROAD, across } from './site.js';
import { pbr, paverMaterial, tactileMaterial, slopeMaterial, girihPanelMaterial, stoneDetail, wallMaterial } from './materials.js';
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
  constructor() { this.walls = []; this.roofs = []; this.glass = []; this.frames = []; this.colliders = []; }

  box(list, x, y, z, w, h, d, yaw, color) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv, normal = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      const horizontal = Math.abs(normal.getY(i)) > .5;
      const across = Math.abs(normal.getX(i)) > .5 ? d : w;
      uv.setXY(i, uv.getX(i) * (horizontal ? w : across) / 3, uv.getY(i) * (horizontal ? d : h) / 3);
    }
    const c = new THREE.Color(color || '#ffffff');
    if (list === this.walls) c.multiplyScalar(1.5);
    const colors = new Float32Array(uv.count * 3);
    for (let i = 0; i < uv.count; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y + h / 2, z));
    list.push(g);
    return g;
  }

  // Hipped roof: two trapezoids and two triangles over the footprint.
  hip(list, x, y, z, w, d, rise, yaw, color) {
    const r = Math.min(w, d) * .42, hw = w / 2 + .35, hd = d / 2 + .35;
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

  house(x, y, z, w, d, floors, yaw, random) {
    const palette = ['#ffe9cc', '#ffdcb6', '#fff3e4', '#f4ecdf', '#ffdfb8', '#e9e2d4'];
    const roofColors = ['#7c3b2e', '#6d6f73', '#8a4a34', '#4d5a61', '#7a3a2c', '#56606a'];
    const color = palette[Math.floor(random() * palette.length)], roof = roofColors[Math.floor(random() * roofColors.length)];
    const h = floors * 3.3;
    this.box(this.walls, x, y - 3.5, z, w, h + 3.5, d, yaw, color);
    this.box(this.walls, x, y + h - .05, z, w + .5, .18, d + .5, yaw, '#faf6ec');
    this.hip(this.roofs, x, y + h + .1, z, w, d, Math.min(w, d) * .24, yaw, roof);
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    for (let side = 0; side < 2; side++) {
      const face = side ? -1 : 1;
      for (let floor = 0; floor < floors; floor++) {
        const columns = Math.max(2, Math.floor(w / 3.4));
        for (let c = 0; c < columns; c++) {
          const lx = (c + .5) / columns * w - w / 2, lz = (d / 2 + .02) * face, wy = y + floor * 3.3 + 1.05;
          const px = x + lx * cos + lz * sin, pz = z - lx * sin + lz * cos;
          this.box(this.frames, px, wy - .07, pz, 1.46, 1.74, .12, yaw, '#f1ece2');
          this.box(this.glass, x + lx * cos + (lz + .05 * face) * sin, wy, z - lx * sin + (lz + .05 * face) * cos, 1.3, 1.6, .03, yaw);
          this.box(this.frames, px, wy - .13, pz, 1.65, .11, .27, yaw, '#d7c2a7');
          const mullion = lz + .08 * face;
          this.box(this.frames, x + lx * cos + mullion * sin, wy, z - lx * sin + mullion * cos, .06, 1.6, .045, yaw, '#e4d8c9');
        }
      }
      const doorZ = (d / 2 + .055) * face;
      this.box(this.frames, x + doorZ * sin, y, z + doorZ * cos, 1.08, 2.18, .16, yaw, '#735643');
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

  const asphalt = pbr('clean_asphalt', { repeat: 1, color: '#9a9b9d', roughness: 1, normalScale: 1, anisotropy: 16 });
  asphalt.vertexColors = true;
  const pavers = paverMaterial([122, 122, 120], { anisotropy: aniso });
  const redPavers = paverMaterial([112, 44, 36], { tileMetres: 2.4, anisotropy: aniso });
  const beige = paverMaterial([168, 136, 92], { tileMetres: 2.4, anisotropy: aniso });
  const tactile = tactileMaterial();
  const curbStone = pbr('concrete_pavement', { color: '#c8c8c6', roughness: .9, anisotropy: aniso });
  const lawn = pbr('aerial_grass_rock', { color: '#7f9a58', anisotropy: aniso });
  const ground = pbr('brown_mud_dry', { color: '#d9c5a4', anisotropy: aniso });
  const coping = pbr('concrete_pavement', { color: '#d6d4cf', roughness: .85, anisotropy: aniso });
  coping.side = THREE.DoubleSide;

  const last = stations.length - 1;
  const d = (fn) => (s) => fn(s);

  // Asphalt with a darker wheel-track tone, both carriageways.
  const trackTone = (t) => { const w = Math.sin(t * Math.PI * 4); return .92 + .08 * w * w; };
  geometryToMesh(sweep(0, last, d((s) => roadPoint(s, SIDEWALK)), d((s) => roadPoint(s, SIDEWALK + LANE)), { uMetres: 4, vMetres: 4, lateral: 8, colorFn: trackTone }), asphalt, group);
  geometryToMesh(sweep(0, last, d((s) => roadPoint(s, s.width - SIDEWALK - LANE)), d((s) => roadPoint(s, s.width - SIDEWALK)), { uMetres: 4, vMetres: 4, lateral: 8, colorFn: trackTone }), asphalt, group);

  // Sidewalk bands on both sides, as measured from the photographs.
  const bandsWest = [[0, .35, beige], [.35, 3.6, pavers], [3.6, 4.2, tactile], [4.2, 5.6, redPavers], [5.6, 5.8, curbStone]];
  bandsWest.forEach(([a, b, material]) => {
    const uMetres = material === pavers || material === redPavers || material === beige ? 2.4 : material === tactile ? .6 : 1;
    geometryToMesh(sweep(0, last, (s) => sectionPoint(s, a), (s) => sectionPoint(s, b), { uMetres, vMetres: uMetres }), material, group);
    geometryToMesh(sweep(0, last, (s) => sectionPoint(s, s.width - b), (s) => sectionPoint(s, s.width - a), { uMetres, vMetres: uMetres }), material, group);
  });
  // Median: granite curbs, a red strip like the photo, planted where the survey leaves room.
  const medianA = (s) => SIDEWALK + LANE, medianB = (s) => s.width - SIDEWALK - LANE;
  geometryToMesh(sweep(0, last, (s) => sectionPoint(s, medianA(s)), (s) => sectionPoint(s, medianA(s) + .24), { uMetres: 1, vMetres: 1 }), curbStone, group);
  geometryToMesh(sweep(0, last, (s) => sectionPoint(s, medianB(s) - .24), (s) => sectionPoint(s, medianB(s)), { uMetres: 1, vMetres: 1 }), curbStone, group);
  geometryToMesh(sweep(0, last, (s) => sectionPoint(s, medianA(s) + .24), (s) => sectionPoint(s, medianB(s) - .24), { uMetres: 2.4, vMetres: 2.4 }), redPavers, group);
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
  const pieceRanges = { west: [[-1e9, 1e9]], east: [[-1e9, 1836], [1851, 1e9]] };
  [['west', -1], ['east', 1]].forEach(([name, side]) => {
    pieceRanges[name].forEach(([yFrom, yTo]) => {
      const keep = crestLine[name].map((p, i) => ({ p, s: coarseStations[i], i })).filter(({ s }) => s.Y >= yFrom && s.Y <= yTo);
      const line = keep.map((k) => k.p);
      const out = (offset, lift) => keep.map(({ p, s }) => { const [ax, az] = axis(s); return [p[0] + side * ax * offset, p[1] + lift, p[2] + side * az * offset]; });
      const prom = out(3.4, .05), far = out(22, .35), farther = out(420, 3);
      stripFrom(line.map((p) => [p[0], p[1], p[2]]), prom, pavers);
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
      const banks = keep.filter(({ s }) => (name === 'west' ? s.Y < 1842 || s.Y > 2090 : s.Y < 1836 || s.Y > 2070));
      const runs = [];
      banks.forEach((k) => { const r = runs[runs.length - 1]; if (r && k.i === r[r.length - 1].i + 1) r.push(k); else runs.push([k]); });
      runs.filter((r) => r.length > 1).forEach((r) => stripFrom(r.map(({ s }) => (name === 'west' ? s.W : s.E)), r.map(({ p }) => [p[0], p[1], p[2]]), lawn, 8));
    });
  });
  geometryToMesh(mergeGeometries(panels), panelMaterial, group, { cast: true });
  const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(.11, 1.2, .11), new THREE.MeshStandardMaterial({ color: '#26292b', roughness: .4, metalness: .7 }), posts.length);
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
  const wing = (wall, atEnd, slopeBottom, slopeTop) => {
    const c = wall.curve[atEnd ? wall.curve.length - 1 : 0];
    const pos = [c.x, c.base - 1, c.z, c.x, c.top, c.z, slopeTop[0], slopeTop[1], slopeTop[2], slopeBottom[0], slopeBottom[1] - 1, slopeBottom[2]];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 2, 1, 2, 1, 0], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    geometryToMesh(g, new THREE.MeshStandardMaterial({ map: coping.map, normalMap: coping.normalMap, color: '#bfbdb8', side: THREE.DoubleSide, roughness: .9 }), group, { cast: true });
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
        if (name === 'east' && s.Y > 1760 && s.Y < 1856) { i += 4; continue; }
        const nearSurvey = s.Y > 1780 && s.Y < 2160;
        const span = row === 0 ? 14 + random() * 14 : 10 + random() * 12;
        const offset = 8.5 + row * 16 + random() * 3 + span * 0;
        const base = line[i], depth = 8 + random() * 3;
        const yaw = Math.atan2(-az, ax) + (side > 0 ? 0 : 0);
        const x = base[0] + side * ax * (offset + depth / 2), z = base[2] + side * az * (offset + depth / 2);
        const span2 = Math.min(span, 26);
        // Long row-house fronts along the road: the long side faces the street.
        batch.house(x, base[1] + .3 + row * .4, z, span2, depth, random() > .72 ? 2 : 1, Math.PI / 2 - Math.atan2(ax, az) + Math.PI / 2, random);
        void yaw; void nearSurvey;
        i += Math.ceil((span2 + 3 + random() * 6) / 4);
      }
    }
  });
  // House on the mound above the stepped wall, like photo 121133.
  const hr = seeded(11);
  batch.house(walls.step.curve[0].x - 13, walls.step.curve[0].top + .05, walls.step.curve[0].z + 7, 12, 8, 2, .5, hr);
  // Low buildings along the far side of the side street.
  { const e = walls.step.curve[walls.step.curve.length - 1], f = walls.step.curve[0], l = Math.hypot(f.x - e.x, f.z - e.z), ax = (f.x - e.x) / l, az = (f.z - e.z) / l;
    for (let k = 0; k < 4; k++) batch.house(e.x + ax * (8 + k * 17) + az * 18, e.base + .5 + k * .2, e.z + az * (8 + k * 17) - ax * 18, 15, 8, k % 2 ? 2 : 1, Math.atan2(-az, ax), hr);
  }
  const buildingMaterials = {
    plaster: Object.assign(pbr('concrete_wall_008', { anisotropy: 4, normalScale: .5 }), { vertexColors: true }),
    roof: Object.assign(pbr('corrugated_iron', { anisotropy: 4 }), { vertexColors: true, metalness: .25, roughness: .7 }),
    frame: new THREE.MeshStandardMaterial({ color: '#efe9de', roughness: .6, vertexColors: true }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#27384a', roughness: .06, metalness: .95, clearcoat: 1, emissive: '#ffcf8c', emissiveIntensity: 0 }),
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

  // Green mound behind the stepped wall, keeps it attached to the land like the real earth bank.
  const mound = new THREE.Shape();
  const m = [[stepEnd.x, stepEnd.z], [stepStart.x, stepStart.z], [stepStart.x + ux * 22, stepStart.z + uz * 22], [stepStart.x + ux * 22 - vx * 30, stepStart.z + uz * 22 - vz * 30], [stepEnd.x - vx * 22 - ux * 6, stepEnd.z - vz * 22 - uz * 6]];
  m.forEach(([x, z], i) => (i ? mound.lineTo(x, -z) : mound.moveTo(x, -z)));
  const moundGeometry = new THREE.ShapeGeometry(mound, 1);
  moundGeometry.rotateX(-Math.PI / 2);
  moundGeometry.translate(0, stepStart.top + .05, 0);
  const uvM = moundGeometry.attributes.uv; for (let i = 0; i < uvM.count; i++) uvM.setXY(i, uvM.getX(i) / 8, uvM.getY(i) / 8);
  geometryToMesh(moundGeometry, lawn, group);
  colliders.push(moundGeometry);
  geometryToMesh(rail(walls.step.curve.map((p) => [p.x, p.top, p.z]), .5, .18), coping, group, { cast: true });

  // Far ground and low city fill so the world never ends at an edge.
  const farGround = new THREE.Mesh(new THREE.CircleGeometry(2400, 48), new THREE.MeshStandardMaterial({ color: '#a79b82', roughness: 1 }));
  farGround.rotation.x = -Math.PI / 2; farGround.position.y = -6; farGround.receiveShadow = false;
  farGround.userData.keepWhole = true;
  group.add(farGround);
  const fill = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#d9cfbd', roughness: .95 }), 1100);
  const q = new THREE.Quaternion(), pos = new THREE.Vector3(), scale = new THREE.Vector3();
  const r2 = seeded(77);
  for (let i = 0; i < fill.count; i++) {
    const s = stations[Math.floor(r2() * stations.length)], side = r2() > .5 ? 1 : -1, off = 75 + r2() * r2() * 500;
    pos.set((s.W[0] + s.E[0]) / 2 + side * off, s.W[1] + r2() * 2, s.W[2] + (r2() - .5) * 60);
    scale.set(8 + r2() * 14, 3 + r2() * 5, 7 + r2() * 12);
    q.setFromAxisAngle(tmp.set(0, 1, 0), r2() * .4);
    fill.setMatrixAt(i, matrix.compose(pos, q, scale));
  }
  fill.userData.keepWhole = true;
  group.add(fill);
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
  const steel = new THREE.MeshStandardMaterial({ color: '#8c9194', roughness: .35, metalness: .85 });
  const poleG = new THREE.CylinderGeometry(.055, .1, 9, 10); poleG.translate(0, 4.5, 0);
  const armG = new THREE.BoxGeometry(1.7, .06, .08); armG.translate(.85, 8.9, 0);
  const lampHead = new THREE.BoxGeometry(.62, .09, .24); lampHead.translate(1.55, 8.84, 0);
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
  instance(poleG, steel); instance(armG, steel); instance(baseG, steel); instance(lampHead, lampMaterial);
  // Benches sit next to the walls, leaving a clear walking lane.
  const benchWood = new THREE.MeshStandardMaterial({ color: '#7a5a3c', roughness: .6 });
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
  [[seat, benchWood], [back, benchWood], [legs, benchIron]].forEach(([geometry, material]) => {
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
  // Near trees become full models; each one is drawn only inside its radius, otherwise it stays a card.
  const heroes = [];
  const upgradeTrees = (tree) => {
    const near = [...placed.filter((t) => t.median && t.Y > 1830 && t.Y < 1925).slice(0, 8), ...placed.filter((t) => !t.median && t.Y > 1830 && t.Y < 2110).filter((_, i) => i % 3 === 0).slice(0, 12)];
    tree.updateMatrixWorld(true);
    near.forEach((t) => {
      const copy = new THREE.Group();
      tree.traverse((child) => {
        if (!child.isMesh) return;
        const part = new THREE.Mesh(child.geometry, child.material);
        part.applyMatrix4(child.matrixWorld);
        part.castShadow = true; part.receiveShadow = true;
        copy.add(part);
      });
      copy.position.set(t.x, t.y, t.z); copy.rotation.y = t.yaw; copy.scale.setScalar(t.scale);
      copy.visible = false;
      scene.add(copy);
      heroes.push({ copy, t, index: placed.indexOf(t), model: false });
    });
  };
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const updateTrees = (eye) => {
    let changed = false;
    heroes.forEach((hero) => {
      const close = Math.hypot(hero.t.x - eye.x, hero.t.z - eye.z) < 75;
      if (close === hero.model) return;
      hero.model = close; hero.copy.visible = close; changed = true;
      if (close) cards.setMatrixAt(hero.index, hidden);
      else { q.setFromAxisAngle(tmp.set(0, 1, 0), hero.t.yaw); cards.setMatrixAt(hero.index, matrix.compose(pos.set(hero.t.x, hero.t.y, hero.t.z), q, scl.setScalar(hero.t.scale))); }
    });
    if (changed) cards.instanceMatrix.needsUpdate = true;
  };
  // Trimmed boxwood balls in rows, the way such boulevards are actually planted.
  const shrubs = [];
  shared.crestLine.west.forEach((p, i) => { const s = shared.coarseStations[i]; if (i % 2 === 0 && s.Y > 1700 && s.Y < 2300) { const [ax, az] = axis(s); shrubs.push([p[0] - ax * 3.9, p[1] + .35, p[2] - az * 3.9]); } });
  shared.crestLine.east.forEach((p, i) => { const s = shared.coarseStations[i]; if (i % 2 === 1 && s.Y > 1700 && s.Y < 2300) { const [ax, az] = axis(s); shrubs.push([p[0] + ax * 3.9, p[1] + .35, p[2] + az * 3.9]); } });
  const crestShrubCount = shrubs.length;
  stations.forEach((s, i) => {
    const room = s.width - 2 * (SIDEWALK + LANE);
    if (i % 2 === 0 && room > 3.5 && s.Y > 1650 && s.Y < 2380) { const a = sectionPoint(s, SIDEWALK + LANE + 1.1, .4), b = sectionPoint(s, s.width - SIDEWALK - LANE - 1.1, .4); shrubs.push(a, b); }
  });
  const rawBall = new THREE.IcosahedronGeometry(.62, tier === 'high' ? 4 : 2); rawBall.deleteAttribute('normal');
  const ball = mergeVertices(rawBall);
  const position = ball.attributes.position;
  for (let i = 0; i < position.count; i++) { const k = 1 + Math.sin(position.getX(i) * 13) * Math.sin(position.getY(i) * 11) * Math.sin(position.getZ(i) * 12) * .09; position.setXYZ(i, position.getX(i) * k, position.getY(i) * k, position.getZ(i) * k); }
  ball.computeVertexNormals();
  const rooted = shrubs.flatMap(([x, y, z], i) => {
    const base = plantBase(x, y - .35, z, i < crestShrubCount);
    return base === undefined ? [] : [[x, base, z]];
  });
  const box = new THREE.InstancedMesh(ball, new THREE.MeshStandardMaterial({ map: shared.leafMap, normalMap: shared.leafNormal, color: '#5d7c3c', roughness: .95 }), rooted.length);
  rooted.forEach(([x, y, z], i) => {
    const scale = .85 + random() * .4;
    box.setMatrixAt(i, matrix.compose(pos.set(x, y + .46 * scale, z), q.identity(), scl.setScalar(scale)));
  });
  box.castShadow = tier === 'high'; box.receiveShadow = true;
  const plants = new THREE.Group(); plants.add(box); scene.add(plants);
  chunkGroup(plants, 70);
  shared.plants = plants;
  return { upgradeTrees, updateTrees };
}

export { DESIGNS };
