// Splits long meshes into map cells so the renderer can skip everything outside the view or too far away.
import * as THREE from 'three';

const cellKey = (x, z, size) => `${Math.floor(x / size)}:${Math.floor(z / size)}`;

function splitMesh(mesh, size) {
  const g = mesh.geometry, position = g.attributes.position;
  const index = g.index ? g.index.array : Array.from({ length: position.count }, (_, i) => i);
  const cells = new Map();
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i], b = index[i + 1], c = index[i + 2];
    const key = cellKey((position.getX(a) + position.getX(b) + position.getX(c)) / 3, (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3, size);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(a, b, c);
  }
  if (cells.size < 2) return [mesh];
  const parts = [];
  cells.forEach((triangles) => {
    const remap = new Map(), newIndex = [];
    triangles.forEach((v) => { if (!remap.has(v)) remap.set(v, remap.size); newIndex.push(remap.get(v)); });
    const part = new THREE.BufferGeometry();
    Object.entries(g.attributes).forEach(([name, attribute]) => {
      const n = attribute.itemSize, data = new attribute.array.constructor(remap.size * n);
      remap.forEach((to, from) => { for (let k = 0; k < n; k++) data[to * n + k] = attribute.array[from * n + k]; });
      part.setAttribute(name, new THREE.BufferAttribute(data, n, attribute.normalized));
    });
    part.setIndex(newIndex);
    part.computeBoundingSphere();
    const piece = new THREE.Mesh(part, mesh.material);
    piece.castShadow = mesh.castShadow; piece.receiveShadow = mesh.receiveShadow;
    parts.push(piece);
  });
  g.dispose();
  return parts;
}

function splitInstances(mesh, size) {
  const cells = new Map(), matrix = new THREE.Matrix4(), p = new THREE.Vector3();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix); p.setFromMatrixPosition(matrix);
    const key = cellKey(p.x, p.z, size);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(matrix.clone());
  }
  if (cells.size < 2) return [mesh];
  const parts = [];
  cells.forEach((list) => {
    const piece = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
    list.forEach((m, i) => piece.setMatrixAt(i, m));
    piece.castShadow = mesh.castShadow; piece.receiveShadow = mesh.receiveShadow;
    piece.computeBoundingSphere();
    parts.push(piece);
  });
  return parts;
}

export function chunkGroup(group, size = 90) {
  [...group.children].forEach((child) => {
    if (child.userData.keepWhole) return;
    let parts = null;
    if (child.isInstancedMesh) parts = splitInstances(child, size * 2);
    else if (child.isMesh && child.geometry.attributes.position.count > 400) parts = splitMesh(child, size);
    if (!parts || parts[0] === child) return;
    group.remove(child);
    parts.forEach((part) => { part.userData = { ...child.userData }; group.add(part); });
  });
}

// Hides whole cells beyond the visibility distance, checked a few times a second.
export function distanceCuller(objects, limit) {
  const items = objects.map((object) => {
    if (object.isInstancedMesh && !object.boundingSphere) object.computeBoundingSphere();
    if (!object.isInstancedMesh && !object.geometry.boundingSphere) object.geometry.computeBoundingSphere();
    const sphere = object.isInstancedMesh ? object.boundingSphere : object.geometry.boundingSphere;
    return { object, x: sphere.center.x, z: sphere.center.z, r: sphere.radius };
  });
  return (eye) => {
    items.forEach((item) => {
      const reach = limit + item.r, dx = item.x - eye.x, dz = item.z - eye.z;
      item.object.visible = dx * dx + dz * dz < reach * reach;
    });
  };
}
