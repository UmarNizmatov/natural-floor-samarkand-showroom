// Runs only during asset preparation, never in the customer's browser.
import * as THREE from 'three';
import { buildWorld, paintAllWalls, plantVegetation } from './world.js';
import { loadMaterialTextures } from './materials.js';
import { DESIGNS, loadStones, paintDesign } from './designs.js';
import { chunkGroup } from './culling.js';
import { Octree } from 'three/examples/jsm/math/Octree.js';

const base64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let value = '';
  for (let i = 0; i < bytes.length; i += 32768) value += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(value);
};
const save = (name, buffer) => window.savePrepared(name, base64(buffer));

async function prepare() {
  await loadStones();
  const scene = new THREE.Scene();
  const shared = buildWorld(scene, 'high');
  chunkGroup(shared.group, 150);
  await Promise.all(shared.group.children.map((mesh) => loadMaterialTextures(mesh.material)));
  const billboard = await new THREE.TextureLoader().loadAsync('assets/tree.webp');
  billboard.colorSpace = THREE.SRGBColorSpace;
  plantVegetation(scene, shared, { billboard }, 'high');
  const root = new THREE.Group();
  root.add(shared.group, shared.plants, shared.treeCards);
  root.updateMatrixWorld(true);
  const thumbnails = {};
  for (const design of DESIGNS) {
    const canvas = document.createElement('canvas');
    canvas.width = 280; canvas.height = 88;
    paintDesign(canvas.getContext('2d'), design, { L: 28, H: 8.8, pxPerMetre: 10, seed: 3 });
    thumbnails[design.id] = await window.savePreparedImage(canvas.toDataURL('image/png'));
  }
  chunkGroup(shared.plants, 150);
  const wallMetadata = shared.wallList.map((wall) => ({
    id: wall.id, L: wall.L, H: wall.H, anamorph: wall.anamorph,
    segments: wall.segments.map((segment) => ({
      mesh: segment.mesh.uuid, s0: segment.s0, s1: segment.s1, designs: {},
      bounds: (() => { segment.mesh.geometry.computeBoundingBox(); const b = segment.mesh.geometry.boundingBox; return [b.min.toArray(), b.max.toArray()]; })(),
    })),
  }));
  for (const design of DESIGNS) {
    paintAllWalls(shared.wallList, design, 'high', true);
    for (const [wi, wall] of shared.wallList.entries()) {
      for (const [si, segment] of wall.segments.entries()) {
        wallMetadata[wi].segments[si].designs[design.id] = await window.savePreparedImage(segment.canvas.toDataURL('image/png'));
      }
    }
  }
  paintAllWalls(shared.wallList, DESIGNS[0], 'high', true);
  // Bake local contact occlusion once, reusing the collision acceleration structure.
  shared.collision.updateMatrixWorld(true);
  const occluders = new Octree().fromGraphNode(shared.collision);
  const origin = new THREE.Vector3(), normal = new THREE.Vector3(), direction = new THREE.Vector3();
  const tangent = new THREE.Vector3(), bitangent = new THREE.Vector3(), axis = new THREE.Vector3(0, 1, 0);
  const normalMatrix = new THREE.Matrix3(), ray = new THREE.Ray();
  const occlusionCache = new Map();
  const shaded = new Set();
  root.traverse((mesh) => {
    if (!mesh.isMesh || mesh.isInstancedMesh || mesh.material.transparent || mesh.material.alphaTest || !mesh.material.isMeshStandardMaterial || shaded.has(mesh.geometry)) return;
    shaded.add(mesh.geometry);
    const geometry = mesh.geometry, positions = geometry.attributes.position, normals = geometry.attributes.normal;
    if (!normals) return;
    normalMatrix.getNormalMatrix(mesh.matrixWorld);
    const existing = geometry.attributes.color;
    const colors = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
      origin.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
      normal.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize();
      const key = [origin.x, origin.y, origin.z, normal.x, normal.y, normal.z].map((value) => Math.round(value * 100)).join(',');
      let shade = occlusionCache.get(key);
      if (shade === undefined) {
        tangent.crossVectors(normal, Math.abs(normal.y) > .9 ? new THREE.Vector3(1, 0, 0) : axis).normalize();
        bitangent.crossVectors(normal, tangent).normalize();
        ray.origin.copy(origin).addScaledVector(normal, .035);
        let occlusion = 0;
        for (let sample = 0; sample < 5; sample++) {
          const angle = sample * Math.PI * 2 / 5;
          direction.copy(normal).multiplyScalar(.75).addScaledVector(tangent, Math.cos(angle) * .66).addScaledVector(bitangent, Math.sin(angle) * .66).normalize();
          ray.direction.copy(direction);
          const hit = occluders.rayIntersect(ray);
          if (hit && hit.distance < 2) occlusion += 1 - hit.distance / 2;
        }
        shade = 1 - .32 * occlusion / 5;
        occlusionCache.set(key, shade);
      }
      colors[i * 3] = (existing ? existing.getX(i) : 1) * shade;
      colors[i * 3 + 1] = (existing ? existing.getY(i) : 1) * shade;
      colors[i * 3 + 2] = (existing ? existing.getZ(i) : 1) * shade;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    mesh.material.vertexColors = true;
  });
  const json = root.toJSON();
  const objects = new Map();
  root.traverse((object) => objects.set(object.uuid, object));
  const wallImages = new Map();
  shared.wallList.forEach((wall, wi) => wall.segments.forEach((segment, si) => {
    wallImages.set(segment.map.source.uuid, wallMetadata[wi].segments[si].designs[DESIGNS[0].id]);
  }));
  const sources = new Map();
  root.traverse((object) => {
    const materials = object.material ? Array.isArray(object.material) ? object.material : [object.material] : [];
    materials.forEach((material) => Object.values(material).forEach((value) => {
      if (value?.isTexture) sources.set(value.source.uuid, value);
    }));
  });
  for (const image of json.images) {
    const texture = sources.get(image.uuid);
    if (wallImages.has(image.uuid)) image.url = wallImages.get(image.uuid);
    else if (texture.userData.url) image.url = texture.userData.url;
    else {
      const canvas = document.createElement('canvas');
      canvas.width = texture.image.width; canvas.height = texture.image.height;
      canvas.getContext('2d').drawImage(texture.image, 0, 0);
      image.url = await window.savePreparedImage(canvas.toDataURL('image/png'));
    }
  }
  const geometryTable = new Map();
  const chunks = new Map();
  const box = new THREE.Box3(), size = new THREE.Vector3(), centre = new THREE.Vector3();
  const ground = shared.groundMaterials;
  root.traverse((object) => {
    if (!object.isMesh) return;
    box.setFromObject(object);
    box.getSize(size); box.getCenter(centre);
    const global = ground.has(object.material) || Math.max(size.x, size.z) > 140;
    const key = global ? 'global' : Math.floor(centre.z / 75).toString();
    if (!chunks.has(key)) chunks.set(key, { objects: [], geometries: new Set(), bounds: new THREE.Box3() });
    const chunk = chunks.get(key);
    chunk.objects.push(object.uuid);
    chunk.bounds.union(box);
    chunk.geometries.add(object.geometry);
    geometryTable.set(object.geometry.uuid, object.geometry);
    object.userData.preparedBounds = [box.min.toArray(), box.max.toArray()];
  });
  // Record bounds in the object manifest after computing them.
  json.object = root.toJSON().object;
  const writeGeometry = async (name, geometries, meshes = []) => {
    const arrays = [], layout = {};
    let bytes = 0;
    const add = (attribute) => {
      bytes = Math.ceil(bytes / 4) * 4;
      const array = attribute.array;
      const descriptor = { offset: bytes, length: array.length, type: array.constructor.name, itemSize: attribute.itemSize, normalized: attribute.normalized };
      arrays.push({ offset: bytes, array });
      bytes += array.byteLength;
      return descriptor;
    };
    for (const geometry of geometries) {
      if (layout[geometry.uuid]) continue;
      const attributes = {};
      Object.entries(geometry.attributes).forEach(([key, attribute]) => { attributes[key] = add(attribute); });
      layout[geometry.uuid] = { attributes, index: geometry.index ? add(geometry.index) : null, groups: geometry.groups };
    }
    const instances = {};
    meshes.filter((mesh) => mesh.isInstancedMesh).forEach((mesh) => {
      instances[mesh.uuid] = { matrix: add(mesh.instanceMatrix), color: mesh.instanceColor ? add(mesh.instanceColor) : null };
    });
    const output = new Uint8Array(Math.ceil(bytes / 4) * 4);
    arrays.forEach(({ offset, array }) => output.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), offset));
    const url = await save(name, output.buffer);
    return { url, layout, instances };
  };
  const preparedChunks = [];
  for (const [key, chunk] of chunks) {
    preparedChunks.push({
      key, objects: chunk.objects, bounds: [chunk.bounds.min.toArray(), chunk.bounds.max.toArray()],
      ...await writeGeometry('geometry', chunk.geometries, chunk.objects.map((id) => objects.get(id))),
    });
  }
  const collisionPositions = [];
  shared.collision.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    collisionPositions.push(geometry.attributes.position.array);
  });
  const collisionArray = new Float32Array(collisionPositions.reduce((length, array) => length + array.length, 0));
  let collisionOffset = 0;
  collisionPositions.forEach((array) => { collisionArray.set(array, collisionOffset); collisionOffset += array.length; });
  const collisionGeometry = new THREE.BufferGeometry();
  collisionGeometry.setAttribute('position', new THREE.BufferAttribute(collisionArray, 3));
  const collisionObject = new THREE.Mesh(collisionGeometry).toJSON().object;
  const compactObjects = (object) => {
    if (object.instanceMatrix) object.instanceMatrix.array = [];
    if (object.instanceColor) object.instanceColor.array = [];
    object.children?.forEach(compactObjects);
  };
  compactObjects(json.object);
  const metadata = {
    chunks: preparedChunks, collision: { object: collisionObject, ...await writeGeometry('collision', [collisionGeometry]) },
    object: json.object, textures: json.textures, materials: json.materials, images: json.images,
    walls: wallMetadata, thumbnails,
    viewpoints: shared.viewpoints,
    treePlacements: shared.treePlacements, treeCards: shared.treeCards.uuid,
    group: shared.group.uuid, plants: shared.plants.uuid,
    groundMaterials: [...shared.groundMaterials].map((m) => m.uuid),
    leafMap: shared.leafMap.uuid, leafNormal: shared.leafNormal.uuid,
    lampMaterial: shared.lampMaterial.uuid, pool: shared.pool.uuid,
    skyline: shared.skyline.uuid, windows: shared.windows.uuid, lampSpots: shared.lampSpots,
    wallNormal: shared.wallList[0].segments[0].mesh.material.normalMap.uuid,
  };
  // The shader-only grain texture is not included by Material.toJSON.
  const detail = shared.wallDetail;
  if (detail) {
    const canvas = detail.grain.image;
    metadata.grainUrl = await window.savePreparedImage(canvas.toDataURL('image/png'));
  }
  await window.savePreparedManifest(metadata);
  window.preparationDone = true;
}
prepare().catch((error) => { console.error(error); window.preparationError = error.stack; });
