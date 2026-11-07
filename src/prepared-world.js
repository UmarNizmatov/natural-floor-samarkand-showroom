import * as THREE from 'three';
import { gunzipSync } from 'fflate';
import { walls, bays } from './site.js';
import { configureTextureStreaming, registerDeferredTexture, loadMaterialTextures, wallMaterial } from './materials.js';
import { createTreeUpgrades } from './world.js';

const typedArrays = { Float32Array, Uint32Array, Uint16Array, Uint8Array, Int32Array, Int16Array, Int8Array };
async function get(url, binary = false) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Не удалось загрузить ' + url);
  let buffer = await response.arrayBuffer();
  const signature = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
  if (signature[0] === 31 && signature[1] === 139) buffer = gunzipSync(new Uint8Array(buffer)).buffer;
  return binary ? buffer : JSON.parse(new TextDecoder().decode(buffer));
}
function readGeometries(buffer, layout) {
  const geometries = {};
  const attribute = (data) => new THREE.BufferAttribute(new typedArrays[data.type](buffer, data.offset, data.length), data.itemSize, data.normalized);
  Object.entries(layout).forEach(([id, data]) => {
    const geometry = new THREE.BufferGeometry();
    geometry.uuid = id;
    Object.entries(data.attributes).forEach(([name, data]) => geometry.setAttribute(name, attribute(data)));
    if (data.index) geometry.setIndex(attribute(data.index));
    data.groups.forEach((group) => geometry.addGroup(group.start, group.count, group.materialIndex));
    geometry.computeBoundingSphere();
    geometries[id] = geometry;
  });
  return geometries;
}
export async function loadPreparedWorld(scene, renderer, { collision = true } = {}) {
  const data = await get('prepared/manifest.json.gz');
  configureTextureStreaming(renderer, data.compressedTextures);
  const loader = new THREE.ObjectLoader();
  const images = Object.fromEntries(data.images.map((image) => [image.uuid, new THREE.TextureSource(null)]));
  const imageURLs = new Map(data.images.map((image) => [image.uuid, image.url]));
  const textures = loader.parseTextures(data.textures, images);
  data.textures.forEach((texture) => registerDeferredTexture(textures[texture.uuid], imageURLs.get(texture.image)));
  const materials = loader.parseMaterials(data.materials, textures);
  const shared = { washStrength: { value: 0 }, thumbnails: data.thumbnails };
  const grain = registerDeferredTexture(new THREE.Texture(), data.grainUrl);
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.channel = 1; grain.anisotropy = 16;
  const detail = { normal: textures[data.wallNormal], grain };
  data.walls.forEach((wall) => wall.segments.forEach((segment) => {
    const find = (object) => object.uuid === segment.mesh ? object : object.children?.map(find).find(Boolean);
    const object = find(data.object);
    const material = wallMaterial(detail, shared).copy(materials[object.material]);
    material.userData.preparedTextures = [grain];
    materials[object.material] = material;
  }));
  const placeholders = {};
  data.chunks.forEach((chunk) => Object.keys(chunk.layout).forEach((id) => { placeholders[id] = new THREE.BufferGeometry(); placeholders[id].uuid = id; }));
  const root = loader.parseObject(data.object, placeholders, materials, textures, {});
  const objects = new Map();
  root.traverse((object) => objects.set(object.uuid, object));
  shared.group = objects.get(data.group);
  shared.plants = objects.get(data.plants);
  shared.groundMaterials = new Set(data.groundMaterials.map((id) => materials[id]));
  shared.lampMaterial = materials[data.lampMaterial];
  shared.pool = materials[data.pool]; shared.skyline = materials[data.skyline]; shared.windows = materials[data.windows];
  shared.lampSpots = data.lampSpots;
  shared.viewpoints = data.viewpoints.map(({ eye, look, ...rest }) => ({
    ...rest, eye: new THREE.Vector3(eye.x, eye.y, eye.z), look: new THREE.Vector3(look.x, look.y, look.z),
  }));
  // Phones walk fixed viewpoints and never need the collision data.
  if (collision) {
    const collisionGeometry = readGeometries(await get(data.collision.url, true), data.collision.layout);
    const clearMaterials = (object) => { delete object.material; object.children?.forEach(clearMaterials); };
    clearMaterials(data.collision.object);
    shared.collision = loader.parseObject(data.collision.object, collisionGeometry, {}, {}, {});
  }
  shared.wallList = data.walls.map((saved) => {
    const wall = walls[saved.id] || bays[saved.id];
    wall.L = saved.L; wall.H = saved.H; wall.anamorph = saved.anamorph;
    wall.segments = saved.segments.map((segment) => {
      const mesh = objects.get(segment.mesh);
      return { ...segment, mesh, map: mesh.material.map, design: 'pomegranate', loadedDesign: null, request: 0 };
    });
    return wall;
  });
  const wallSegments = shared.wallList.flatMap((wall) => wall.segments);
  const wallByMesh = new Map(wallSegments.map((segment) => [segment.mesh.uuid, segment]));
  const frustum = new THREE.Frustum(), matrix = new THREE.Matrix4();
  const eye = new THREE.Vector3(0, 0, 92);
  let active = 0;
  const queue = [];
  const enqueue = (job) => new Promise((resolve, reject) => {
    queue.push({ job, resolve, reject });
    pump();
  });
  function pump() {
    while (active < 3 && queue.length) {
      const { job, resolve, reject } = queue.shift();
      active++;
      job().then(resolve, reject).finally(() => { active--; pump(); });
    }
  }
  const loadWall = (segment) => {
    if (segment.loadedDesign === segment.design) return Promise.resolve();
    if (segment.pendingDesign === segment.design) return segment.pending;
    const design = segment.design, request = ++segment.request;
    const texture = registerDeferredTexture(new THREE.Texture(), segment.designs[design]);
    texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 16;
    segment.pendingDesign = design;
    const material = { map: texture, userData: {} };
    segment.pending = loadMaterialTextures(material).then(() => {
      if (request !== segment.request) { texture.dispose(); return; }
      const old = segment.mesh.material.map;
      segment.mesh.material.map = texture;
      segment.map = texture;
      segment.loadedDesign = design;
      old?.dispose();
    }).catch((error) => {
      texture.dispose();
      throw error;
    }).finally(() => {
      if (request === segment.request) segment.pendingDesign = null;
    });
    return segment.pending;
  };
  const chunks = data.chunks.map((chunk) => {
    const state = {
      ...chunk, box: new THREE.Box3(new THREE.Vector3().fromArray(chunk.bounds[0]), new THREE.Vector3().fromArray(chunk.bounds[1])),
      meshes: chunk.objects.map((id) => objects.get(id)), loaded: false, pending: null, retryAt: 0,
    };
    state.meshes.forEach((mesh) => { mesh.visible = false; });
    return state;
  });
  const chunkByMesh = new Map(chunks.flatMap((chunk) => chunk.meshes.map((mesh) => [mesh.uuid, chunk])));
  wallSegments.forEach((segment) => {
    segment.selectDesign = (design) => {
      segment.design = design;
      const chunk = chunkByMesh.get(segment.mesh.uuid);
      if (chunk.loaded && chunk.box.distanceToPoint(eye) < 220) {
        enqueue(() => loadWall(segment)).catch((error) => { shared.streamError = error.message; });
      }
    };
  });
  const loadChunk = (chunk) => {
    if (chunk.loaded) {
      return Promise.all(chunk.meshes.map((mesh) => wallByMesh.get(mesh.uuid)).filter((segment) => segment && segment.loadedDesign !== segment.design).map((segment) => {
        return loadWall(segment).catch((error) => {
          chunk.retryAt = performance.now() + 3000;
          shared.streamError = error.message;
          throw error;
        });
      }));
    }
    if (chunk.pending) return chunk.pending;
    chunk.pending = enqueue(async () => {
      const buffer = await get(chunk.url, true);
      const geometries = readGeometries(buffer, chunk.layout);
      try {
        chunk.meshes.forEach((mesh) => {
          mesh.geometry = geometries[mesh.geometry.uuid];
          const instance = chunk.instances?.[mesh.uuid];
          if (instance) {
            const matrix = instance.matrix;
            mesh.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(buffer, matrix.offset, matrix.length), 16);
            if (instance.color) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(buffer, instance.color.offset, instance.color.length), instance.color.itemSize);
            mesh.computeBoundingSphere();
          }
        });
        await Promise.all(chunk.meshes.map(async (mesh) => {
          const segment = wallByMesh.get(mesh.uuid);
          if (segment) {
            do { await loadWall(segment); } while (segment.loadedDesign !== segment.design);
          }
          await loadMaterialTextures(mesh.material);
        }));
        chunk.meshes.forEach((mesh) => { mesh.visible = true; });
        chunk.loaded = true;
      } catch (error) {
        Object.values(geometries).forEach((geometry) => geometry.dispose());
        throw error;
      }
    }).catch((error) => {
      chunk.retryAt = performance.now() + 3000;
      shared.streamError = error.message;
      throw error;
    }).finally(() => { chunk.pending = null; });
    return chunk.pending;
  };
  shared.stream = async (camera, wait = false) => {
    eye.copy(camera.position);
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const selected = chunks.filter((chunk) => {
      const distance = chunk.box.distanceToPoint(eye);
      const wanted = chunk.key === 'global' || distance < 100 || (distance < 550 && frustum.intersectsBox(chunk.box));
      if (!wanted && chunk.loaded && distance > 280 && !frustum.intersectsBox(chunk.box)) {
        const geometries = new Set(chunk.meshes.map((mesh) => mesh.geometry));
        chunk.meshes.forEach((mesh) => { mesh.visible = false; });
        geometries.forEach((geometry) => geometry.dispose());
        chunk.meshes.forEach((mesh) => {
          const placeholder = new THREE.BufferGeometry();
          placeholder.uuid = mesh.geometry.uuid;
          mesh.geometry = placeholder;
          if (mesh.isInstancedMesh) {
            mesh.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(), 16);
            mesh.instanceColor = null;
          }
        });
        chunk.loaded = false;
        chunk.meshes.forEach((mesh) => {
          const segment = wallByMesh.get(mesh.uuid);
          if (segment) { segment.request++; segment.pendingDesign = null; segment.map?.dispose(); segment.loadedDesign = null; }
        });
      }
      return wanted && (wait || performance.now() >= chunk.retryAt);
    }).sort((a, b) => a.box.distanceToPoint(eye) - b.box.distanceToPoint(eye));
    // 'near' opens the scene as soon as the street around the camera is ready; the rest follows on the next ticks, nearest first.
    if (wait === 'near') { await Promise.all(selected.filter((chunk) => chunk.box.distanceToPoint(eye) < 90).map(loadChunk)); return; }
    const loads = selected.map(loadChunk);
    if (wait) await Promise.all(loads);
    else loads.forEach((load) => load.catch(() => {}));
  };
  shared.prepareLocation = async (position, look) => {
    const camera = new THREE.PerspectiveCamera(120, 1, .1, 550);
    camera.position.copy(position);
    if (look) camera.lookAt(look);
    await shared.stream(camera, true);
  };
  shared.chunkReady = (position) => chunks.every((chunk) => chunk.box.distanceToPoint(position) > 24 || chunk.loaded);
  shared.streamStats = () => ({ loaded: chunks.filter((chunk) => chunk.loaded).length, total: chunks.length, active, queued: queue.length });
  scene.add(root);
  const cards = objects.get(data.treeCards);
  cards.material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'));
  };
  shared.treeUpdates = createTreeUpgrades(scene, data.treePlacements, cards);
  return shared;
}
