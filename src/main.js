// Runtime: renderer, light, player physics, traffic and interface.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { stations, station, walls, bays, across, ROAD } from './site.js';
import { paintAllWalls, sectionPoint, NO_AMBIENT_OCCLUSION } from './world.js';
import { loadPreparedWorld } from './prepared-world.js';
import { DESIGNS } from './designs.js';
import { isPhone } from './materials.js';
import { createBirds } from './birds.js';

const params = new URLSearchParams(location.search);
const touch = isPhone;
const lite = params.has('lite');
const tier = params.get('q') === 'low' ? 'low' : 'high';
const $ = (id) => document.getElementById(id);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: tier !== 'high', powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
} catch (error) {
  $('load-text').textContent = 'Браузер не смог запустить 3D. Закройте лишние вкладки и обновите страницу.';
  throw error;
}
renderer.domElement.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  $('loader').classList.remove('done');
  $('load-text').textContent = 'Восстанавливаем 3D. Можно открыть маршрут без 3D.';
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  if (window.__street?.ready) $('loader').classList.add('done');
});
renderer.setPixelRatio(Math.min(devicePixelRatio, lite ? 1 : tier === 'high' ? 1.6 : 1.25));
renderer.setSize(innerWidth, innerHeight);
renderer.info.autoReset = false;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1;
$('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, .08, 5200);
camera.rotation.order = 'YXZ';
camera.layers.enable(NO_AMBIENT_OCCLUSION);

const sun = new THREE.DirectionalLight('#fff4e0', 3.2);
sun.castShadow = !lite;
sun.shadow.camera.layers.enable(NO_AMBIENT_OCCLUSION);
sun.shadow.autoUpdate = false;
const shadowSize = tier === 'high' ? 4096 : 1024, shadowRange = tier === 'high' ? 85 : 45;
sun.shadow.mapSize.set(shadowSize, shadowSize);
Object.assign(sun.shadow.camera, { left: -shadowRange, right: shadowRange, top: shadowRange, bottom: -shadowRange, near: 10, far: 500 });
sun.shadow.bias = -.00025; sun.shadow.normalBias = .035;
scene.add(sun, sun.target);
scene.fog = new THREE.FogExp2('#c7d0d8', .0021);

let photoGrade = null, composer = null, gtao = null, bloom = null;
function setupComposer() {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  gtao.updateGtaoMaterial({ radius: 1.1, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
  gtao.blendIntensity = .85;
  const renderAO = gtao.render.bind(gtao);
  gtao.render = (...args) => {
    camera.layers.disable(NO_AMBIENT_OCCLUSION);
    try { renderAO(...args); }
    finally { camera.layers.enable(NO_AMBIENT_OCCLUSION); }
  };
  composer.addPass(gtao);
  // One broken pixel must not spread through the bloom blur over the whole picture.
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: 'uniform sampler2D tDiffuse;varying vec2 vUv;void main(){vec4 c=texture2D(tDiffuse,vUv);if(!(c.r==c.r&&c.g==c.g&&c.b==c.b))c=vec4(0.,0.,0.,1.);gl_FragColor=vec4(clamp(c.rgb,0.,48.),1.);}',
  }));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), .1, .55, 1.15);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  // Camera look: gentle contrast, slightly muted colour, soft vignette and sensor grain, like the site photos.
  photoGrade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, tick: { value: 0 }, texel: { value: new THREE.Vector2(1 / innerWidth, 1 / innerHeight) } },
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `uniform sampler2D tDiffuse;uniform float tick;uniform vec2 texel;varying vec2 vUv;
      float noise(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233))+tick)*43758.5453);}
      void main(){vec3 c=texture2D(tDiffuse,vUv).rgb;
        vec3 ring=texture2D(tDiffuse,vUv+vec2(texel.x,0.)).rgb+texture2D(tDiffuse,vUv-vec2(texel.x,0.)).rgb+texture2D(tDiffuse,vUv+vec2(0.,texel.y)).rgb+texture2D(tDiffuse,vUv-vec2(0.,texel.y)).rgb;
        c=clamp(c+(c-ring*.25)*.55,0.,1.);
        c=mix(c,c*c*(3.-2.*c),.42);
        float l=dot(c,vec3(.299,.587,.114));c=mix(vec3(l),c,.94)*vec3(1.025,1.,.955);
        vec2 d=vUv-.5;c*=1.-dot(d,d)*.34;
        c+=(noise(vUv*vec2(1920.,1080.))-.5)*.016;
        gl_FragColor=vec4(c,1.);}`,
  });
  composer.addPass(photoGrade);
  composer.addPass(new SMAAPass());
}
if (tier === 'high') setupComposer();

// Time of day: the sun in the photo-sky drives the shadow direction.
const hdr = new HDRLoader();
const pmrem = new THREE.PMREMGenerator(renderer);
const skies = {};
// Light comes from a small HDR map, the visible sky from a compressed picture stored with this brightness factor.
const SKY_SCALE = {"belfast_sunset_puresky": 0.0696, "kloofendal_overcast_puresky": 0.2807, "kloppenheim_02_puresky": 0.7191, "kloofendal_48d_partly_cloudy_puresky": 0.3299};
async function loadSky(name) {
  if (skies[name]) return skies[name];
  const [texture, backdrop] = await Promise.all([hdr.loadAsync(`assets/sky/${name}.hdr`), new THREE.TextureLoader().loadAsync(`assets/sky/${name}.webp`)]);
  backdrop.mapping = THREE.EquirectangularReflectionMapping;
  backdrop.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  const { width: w, height: h, data } = texture.image;
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y < h / 2; y += 2) for (let x = 0; x < w; x += 2) {
    const i = (y * w + x) * 4, v = THREE.DataUtils.fromHalfFloat(data[i]) + THREE.DataUtils.fromHalfFloat(data[i + 1]);
    if (v > best) { best = v; bx = x; by = y; }
  }
  const azimuth = (bx / w) * Math.PI * 2, elevation = (.5 - by / h) * Math.PI;
  const environment = pmrem.fromEquirectangular(texture).texture;
  texture.dispose();
  return (skies[name] = { backdrop, environment, azimuth, elevation, intensity: 1 / SKY_SCALE[name] });
}
const TIMES = {
  overcast: { sky: 'kloofendal_overcast_puresky', sun: .5, sunColor: '#f0e8dc', env: 1.05, bg: .6, exposure: .92, fog: '#c8cbcd', density: .0016, wash: 0, lamp: 0, pool: 0, win: 0, bloom: .04, elev: .9, azim: 2.5, skyline: '#e4e6e6' },
  day: { sky: 'kloofendal_48d_partly_cloudy_puresky', sun: 2.5, sunColor: '#fff1dc', env: .9, bg: .95, exposure: .88, fog: '#cfd8df', density: .0019, wash: 0, lamp: 0, pool: 0, win: 0, bloom: .06, elev: .95, azim: 2.5, skyline: '#ffffff' },
  sunset: { sky: 'belfast_sunset_puresky', sun: 2.9, sunColor: '#ffb36b', env: .9, bg: .5, exposure: .78, fog: '#b98f79', density: .0006, wash: .12, lamp: 1.2, pool: .25, win: .35, bloom: .06, elev: .17, azim: 2.1, skyline: '#e6b394' },
  night: { sky: 'kloppenheim_02_puresky', sun: .16, sunColor: '#a9c0ff', env: .2, bg: .1, exposure: 1.5, fog: '#141a26', density: .0026, wash: .9, lamp: 7, pool: .55, win: 1.3, bloom: .22, elev: .8, azim: 2.8, skyline: '#27303f' },
};
const lampLights = Array.from({ length: lite ? 0 : tier === 'high' ? 8 : 3 }, () => { const l = new THREE.PointLight('#ffd7a6', 0, 34, 1.7); l.visible = false; scene.add(l); return l; });
let lampPower = 0, lampTick = 0;
function updateLampLights(dt) {
  if (!lampPower || (lampTick -= dt) > 0) return;
  lampTick = .35;
  const eye = camera.position;
  const nearest = shared.lampSpots.map((l) => ({ l, d: (l.p[0] - eye.x) ** 2 + (l.p[2] - eye.z) ** 2 })).sort((a, b) => a.d - b.d);
  lampLights.forEach((light, i) => {
    const { l } = nearest[i];
    light.position.set(l.p[0] + l.dir[0] * l.sign * 1.5, l.p[1] + 8.7, l.p[2] + l.dir[1] * l.sign * 1.5);
    light.intensity = lampPower;
  });
}
let currentTime = 'day', sunDirection = new THREE.Vector3(1, 1, 0);
let shared, carLights = [], birds = null;
async function setTime(name) {
  currentTime = name;
  document.querySelectorAll('[data-time]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.time === name)));
  const t = TIMES[name], sky = await loadSky(t.sky);
  if (currentTime !== name) return;
  scene.background = sky.backdrop;
  scene.environment = sky.environment;
  // Rotate the sky so its sun falls where the walls show their relief best.
  const rotation = sky.azimuth - t.azim;
  scene.backgroundRotation.y = scene.environmentRotation.y = rotation;
  scene.backgroundIntensity = t.bg * sky.intensity; scene.environmentIntensity = t.env;
  shadowDirty = true; settleUntil = performance.now() + 6000;
  sunDirection.setFromSphericalCoords(1, Math.PI / 2 - Math.max(sky.elevation, t.elev), t.azim + Math.PI / 2);
  sun.intensity = t.sun; sun.color.set(t.sunColor);
  renderer.toneMappingExposure = t.exposure;
  scene.fog.color.set(t.fog); scene.fog.density = t.density * (tier === 'high' ? 1 : 1.6);
  shared.washStrength.value = t.wash;
  shared.lampMaterial.emissiveIntensity = t.lamp;
  lampPower = name === 'night' ? 110 : name === 'sunset' ? 34 : 0; lampTick = 0;
  lampLights.forEach((l) => { l.visible = lampPower > 0; });
  shared.pool.opacity = t.pool;
  shared.windows.emissiveIntensity = t.win;
  shared.skyline.color.set(t.skyline);
  if (bloom) bloom.strength = t.bloom;
  if (birds) birds.mesh.visible = name !== 'night';
  carLights.forEach((m) => { m.emissiveIntensity = t.lamp ? m.userData.glow : m.userData.idle; });
}

// Player physics --------------------------------------------------------------------------------
let worldOctree = null;
const GRAVITY = 16, EYE = 1.62, RADIUS = .32, JUMP = 5.4, WALK = 3.1, RUN = 6.4;
const player = new Capsule(new THREE.Vector3(), new THREE.Vector3(0, EYE - RADIUS, 0), RADIUS);
const velocity = new THREE.Vector3();
let onFloor = false, yaw = 0, pitch = 0, fovTarget = 68;
const keys = {};
let autopilot = null;

// Phone: fixed viewpoints along the street, like Street View. Arrows glide between them, nothing else moves the camera.
const railMode = touch;
let railNodes = [], railIndex = 0, railFrom = 0, railAt = 1;
const railEye = new THREE.Vector3();
function buildRail() {
  const c = walls.step.curve, e = c[c.length - 1], f = c[0], l = Math.hypot(f.x - e.x, f.z - e.z), ux = (f.x - e.x) / l, uz = (f.z - e.z) / l, vx = uz, vz = -ux;
  const nodes = [[e.x + ux * 7 + vx * 6, e.base + .12, e.z + uz * 7 + vz * 6], [e.x - ux * 3 + vx * 6.5, e.base + .1, e.z - uz * 3 + vz * 6.5]];
  for (let Y = 1856; Y <= 2112; Y += 10) { const s = station(Y); nodes.push(sectionPoint(s, s.width - ROAD.SIDEWALK - ROAD.LANE * .5)); }
  railNodes = nodes.map(([x, y, z]) => new THREE.Vector3(x, y + EYE, z));
}
const railDirection = (i) => railNodes[Math.min(railNodes.length - 1, i + 1)].clone().sub(railNodes[Math.max(0, i - 1)]).setY(0).normalize();
function updateWalkButtons() {
  const ahead = -Math.sin(yaw) * railDirection(railIndex).x - Math.cos(yaw) * railDirection(railIndex).z >= 0 ? 1 : -1;
  document.querySelector('[data-walk=forward]')?.toggleAttribute('disabled', !railNodes[railIndex + ahead]);
  document.querySelector('[data-walk=back]')?.toggleAttribute('disabled', !railNodes[railIndex - ahead]);
}
// Forward means the way the camera looks, as in Street View.
function stepAlongRail(kind) {
  const direction = railDirection(railIndex);
  const ahead = -Math.sin(yaw) * direction.x - Math.cos(yaw) * direction.z >= 0 ? 1 : -1;
  const next = railIndex + (kind === 'forward' ? ahead : -ahead);
  if (!railNodes[next]) return;
  railEye.copy(camera.position);
  railIndex = next; railAt = 0;
}
function moveAlongRail(dt) {
  forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  railAt = Math.min(1, railAt + dt / .7);
  const t = railAt * railAt * (3 - 2 * railAt);
  camera.position.lerpVectors(railEye, railNodes[railIndex], t);
  player.end.copy(camera.position); player.start.copy(camera.position).setY(camera.position.y - EYE + RADIUS);
  onFloor = true;
  camera.rotation.set(pitch, yaw, 0);
  if (Math.abs(camera.fov - fovTarget) > .05) { camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 7); camera.updateProjectionMatrix(); }
  updateWalkButtons();
}

function placePlayer(x, y, z, lookX, lookY, lookZ) {
  if (railMode) {
    railNodes.forEach((n, i) => { if (Math.hypot(n.x - x, n.z - z) < Math.hypot(railNodes[railIndex].x - x, railNodes[railIndex].z - z)) railIndex = i; });
    railEye.copy(railNodes[railIndex]); railAt = 1; camera.position.copy(railEye);
    if (lookX !== undefined) { const dx = lookX - railEye.x, dy = lookY - railEye.y, dz = lookZ - railEye.z; yaw = Math.atan2(-dx, -dz); pitch = Math.atan2(dy, Math.hypot(dx, dz)); }
    moveAlongRail(0);
    return;
  }
  player.start.set(x, y + RADIUS + .02, z); player.end.set(x, y + EYE - RADIUS + .22, z);
  player.radius = RADIUS;
  velocity.set(0, 0, 0); autopilot = null;
  if (lookX !== undefined) {
    const dx = lookX - x, dy = lookY - (y + EYE), dz = lookZ - z;
    yaw = Math.atan2(-dx, -dz); pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }
}
const forward = new THREE.Vector3(), right = new THREE.Vector3();
function collide() {
  const hit = worldOctree.capsuleIntersect(player);
  onFloor = false;
  if (hit) {
    onFloor = hit.normal.y > .35;
    if (!onFloor) velocity.addScaledVector(hit.normal, -hit.normal.dot(velocity));
    else if (velocity.y < 0) velocity.y = 0;
    if (hit.depth >= 1e-10) player.translate(hit.normal.multiplyScalar(hit.depth));
  }
}
function movePlayer(dt) {
  forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  right.set(-forward.z, 0, forward.x);
  let mx = 0, mz = 0;
  if (keys.KeyW || keys.ArrowUp) mz += 1;
  if (keys.KeyS || keys.ArrowDown) mz -= 1;
  if (keys.KeyD) mx += 1;
  if (keys.KeyA) mx -= 1;
  if (keys.ArrowLeft) yaw += dt * 1.8;
  if (keys.ArrowRight) yaw -= dt * 1.8;
  const speed = keys.ShiftLeft || keys.ShiftRight ? RUN : WALK;
  const desired = new THREE.Vector3().addScaledVector(forward, mz).addScaledVector(right, mx);
  let top = speed;
  if (autopilot) {
    desired.set(autopilot.x - player.end.x, 0, autopilot.z - player.end.z);
    const left = desired.length();
    top = Math.min(autopilot.speed, 1 + left * 1.4);
    if (left < .35 || (autopilot.since += dt) > autopilot.limit) { autopilot = null; desired.set(0, 0, 0); }
    if (autopilot) { const heading = Math.atan2(-desired.x, -desired.z); if (autopilot.turn) yaw += Math.atan2(Math.sin(heading - yaw), Math.cos(heading - yaw)) * Math.min(1, dt * 2.4); }
  }
  if (desired.lengthSq() > 0) desired.normalize().multiplyScalar(top);
  const grip = onFloor ? 11 : 1.6;
  velocity.x += (desired.x - velocity.x) * Math.min(1, grip * dt);
  velocity.z += (desired.z - velocity.z) * Math.min(1, grip * dt);
  if ((keys.Space || keys.jump) && onFloor) { velocity.y = JUMP; onFloor = false; }
  keys.jump = false;
  if (!onFloor) velocity.y -= GRAVITY * dt;
  const step = velocity.clone().multiplyScalar(dt);
  if (shared.chunkReady && !shared.chunkReady(player.end.clone().add(step))) { step.x = 0; step.z = 0; }
  player.translate(step);
  collide();
  keepInWorld(dt);
  camera.position.copy(player.end);
  camera.position.y += RADIUS * .2;
  camera.rotation.set(pitch, yaw, 0);
  if (Math.abs(camera.fov - fovTarget) > .05) { camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 7); camera.updateProjectionMatrix(); }
}
const stationAtZ = (z) => station(1960 - z);
// World limits: the gates close the road ends, the city closes the sides. A fall returns to the last firm spot.
const WALK_Y = [1650, 2392], WALK_SIDE = 78;
const safeSpot = new THREE.Vector3();
let safeTimer = 0;
function keepInWorld(dt) {
  const Y = 1960 - player.end.z;
  if (Y < WALK_Y[0] || Y > WALK_Y[1]) { const back = (Y < WALK_Y[0] ? Y - WALK_Y[0] : Y - WALK_Y[1]); player.translate(new THREE.Vector3(0, 0, back)); velocity.z = 0; autopilot = null; }
  const s = stationAtZ(player.end.z), c = across(s, .5), side = player.end.x - c[0], limit = WALK_SIDE + s.width / 2;
  if (Math.abs(side) > limit) { player.translate(new THREE.Vector3(side > 0 ? limit - side : -limit - side, 0, 0)); velocity.x = 0; autopilot = null; }
  if (onFloor && (safeTimer -= dt) <= 0) { safeTimer = .4; safeSpot.copy(player.start); safeSpot.y -= RADIUS; }
  const groundLevel = Math.min(s.W[1], s.E[1]);
  if (player.end.y < groundLevel - 9) {
    placeAtSafe();
    window.__falls = (window.__falls || 0) + 1;
  }
}
function placeAtSafe() {
  const yawNow = yaw, pitchNow = pitch;
  placePlayer(safeSpot.x, safeSpot.y + .05, safeSpot.z);
  yaw = yawNow; pitch = pitchNow;
}
function spawn() {
  const s = station(1868), p = sectionPoint(s, s.width - 2.2), t = station(1925), look = across(t, .94);
  placePlayer(p[0], p[1], p[2], look[0], look[1] + 2.4, look[2]);
}

// Traffic ---------------------------------------------------------------------------------------
const cars = [];
const PAINT = ['#f3f3f0', '#f3f3f0', '#d8dadc', '#1c1f24', '#7d858c', '#6a1a1c', '#0f2e4f', '#f3f3f0', '#2f4438', '#b8a98c'];
const CAR_MATERIAL = {
  white: () => new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: .32, metalness: .35, clearcoat: 1, clearcoatRoughness: .06, envMapIntensity: 1.3 }),
  glass: () => new THREE.MeshPhysicalMaterial({ color: '#0d1317', roughness: .04, metalness: .9, clearcoat: 1, envMapIntensity: 1.5 }),
  chrome: () => new THREE.MeshStandardMaterial({ color: '#d6dade', roughness: .14, metalness: 1 }),
  lamp: () => Object.assign(new THREE.MeshStandardMaterial({ color: '#f4f6ff', emissive: '#fff1d6', emissiveIntensity: .3, roughness: .15 }), { userData: { glow: 5, idle: .3 } }),
  tail: () => Object.assign(new THREE.MeshStandardMaterial({ color: '#7d0d08', emissive: '#ff1d0d', emissiveIntensity: .2, roughness: .15 }), { userData: { glow: 3, idle: .2 } }),
};
let carMeshes = [], carMatrices = null;
// All traffic shares one instanced mesh per material: a handful of draw calls instead of hundreds.
function spawnTraffic(sedan) {
  const box = new THREE.Box3().setFromObject(sedan), size = box.getSize(new THREE.Vector3());
  const root = new THREE.Group(); root.add(sedan);
  sedan.scale.setScalar(4.55 / Math.max(size.x, size.z));
  if (size.x > size.z) sedan.rotation.y = -Math.PI / 2;
  sedan.updateMatrixWorld(true);
  // The end carrying the white lamps is the front, it must point along +Z.
  const lampBox = new THREE.Box3();
  sedan.traverse((m) => { if (m.isMesh && m.material.name === 'lamp') lampBox.expandByObject(m); });
  if (!lampBox.isEmpty() && lampBox.getCenter(new THREE.Vector3()).z < new THREE.Box3().setFromObject(sedan).getCenter(new THREE.Vector3()).z) sedan.rotation.y += Math.PI;
  sedan.updateMatrixWorld(true);
  const after = new THREE.Box3().setFromObject(sedan);
  sedan.position.set(-(after.min.x + after.max.x) / 2, -after.min.y, -(after.min.z + after.max.z) / 2);
  root.updateMatrixWorld(true);
  const groups = {};
  sedan.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const name = mesh.material.name === 'blue' ? 'white' : mesh.material.name;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', mesh.geometry.attributes.position);
    g.setAttribute('normal', mesh.geometry.attributes.normal);
    if (mesh.geometry.index) g.setIndex(mesh.geometry.index);
    const flat = (g.index ? g.toNonIndexed() : g).applyMatrix4(mesh.matrixWorld);
    (groups[name] = groups[name] || { list: [], source: mesh.material }).list.push(flat);
  });
  const count = tier === 'high' ? 12 : 6;
  const first = stations.indexOf(station(1640)), last = stations.indexOf(station(2400));
  carMatrices = new THREE.InstancedBufferAttribute(new Float32Array(count * 16), 16);
  carMatrices.setUsage(THREE.DynamicDrawUsage);
  Object.entries(groups).forEach(([name, { list, source }]) => {
    const material = CAR_MATERIAL[name] ? CAR_MATERIAL[name]() : source;
    const mesh = new THREE.InstancedMesh(mergeGeometries(list), material, count);
    mesh.instanceMatrix = carMatrices;
    mesh.frustumCulled = false;
    mesh.castShadow = name !== 'lamp' && name !== 'tail';
    if (name === 'white') for (let i = 0; i < count; i++) mesh.setColorAt(i, new THREE.Color(PAINT[i % PAINT.length]));
    if (material.userData.glow) { carLights.push(material); material.emissiveIntensity = TIMES[currentTime].lamp ? material.userData.glow : material.userData.idle; }
    scene.add(mesh);
    carMeshes.push(mesh);
  });
  for (let i = 0; i < count; i++) {
    const north = i % 2 === 0, slow = i % 4 < 2;
    cars.push({ north, slow, at: first + (i + .65) / count * (last - first), speed: (north ? 1 : -1) * (slow ? 10 : 13.5) / 2, v: 1 });
  }
}
const carMatrix = new THREE.Matrix4();
function moveTraffic(dt) {
  if (!carMatrices) return;
  const first = stations.indexOf(station(1640)), last = stations.indexOf(station(2400)), eye = camera.position;
  cars.forEach((c, index) => {
    c.at += c.speed * c.v * dt;
    if (c.at > last) c.at = first; else if (c.at < first) c.at = last;
    const i = Math.floor(c.at), t = c.at - i, a = stations[i], b = stations[i + 1];
    const lane = (s) => (c.north ? s.width - ROAD.SIDEWALK - ROAD.LANE * (c.slow ? .26 : .74) : ROAD.SIDEWALK + ROAD.LANE * (c.slow ? .26 : .74));
    const p = sectionPoint(a, lane(a)), q = sectionPoint(b, lane(b));
    const x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t, z = p[2] + (q[2] - p[2]) * t;
    const sign = c.north ? 1 : -1;
    carMatrix.makeRotationY(Math.atan2((q[0] - p[0]) * sign, (q[2] - p[2]) * sign)).setPosition(x, y, z);
    carMatrix.toArray(carMatrices.array, index * 16);
    // Cars brake for someone standing on the road.
    const fx = (q[0] - p[0]) * sign, fz = (q[2] - p[2]) * sign, fl = Math.hypot(fx, fz) || 1;
    const dx = eye.x - x, dz = eye.z - z, ahead = (dx * fx + dz * fz) / fl, side = Math.abs(dx * fz - dz * fx) / fl;
    const blocked = ahead > 0 && ahead < 17 && side < 1.7 && eye.y - y < 3;
    // A car is solid: step the walker out sideways if it overlaps the body.
    if (Math.abs(ahead) < 2.5 && side < 1.25 && eye.y - y < 2.6) {
      const lateral = (dx * fz - dz * fx) / fl >= 0 ? 1 : -1, push = 1.25 - side;
      player.translate(new THREE.Vector3(fz / fl * lateral * push, 0, -fx / fl * lateral * push));
    }
    c.v += ((blocked ? 0 : 1) - c.v) * Math.min(1, dt * (blocked ? 3.6 : 1));
  });
  carMatrices.needsUpdate = true;
}

// Touch navigation: arrows on the ground like Street View, but the walk is continuous.
const arrows = [];
const arrowGroundRay = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
const arrowGroundNormal = new THREE.Vector3();
function chevronGeometry() {
  const shape = new THREE.Shape();
  [[-.62, -.26], [0, .34], [.62, -.26], [.62, -.72], [0, -.12], [-.62, -.72]].forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2);
  return g;
}
function setupArrows() {
  const g = chevronGeometry();
  ['forward', 'back', 'cross'].forEach((kind) => {
    const material = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .92, depthWrite: false, fog: false });
    const mesh = new THREE.Mesh(g, material);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(1.25, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    mesh.add(pad);
    mesh.renderOrder = 10; mesh.userData.kind = kind; pad.userData.kind = kind;
    scene.add(mesh); arrows.push(mesh);
  });
}
function roadFrame() {
  const s = stationAtZ(player.end.z), i = stations.indexOf(s);
  const a = stations[Math.max(0, i - 3)], b = stations[Math.min(stations.length - 1, i + 3)];
  const ca = across(a, .5), cb = across(b, .5), l = Math.hypot(cb[0] - ca[0], cb[2] - ca[2]) || 1;
  return { s, tx: (cb[0] - ca[0]) / l, tz: (cb[2] - ca[2]) / l };
}
function updateArrows() {
  arrows.forEach((a) => { a.visible = false; });
  if (true) return;
  const { s, tx, tz } = roadFrame();
  const feet = player.start.y - RADIUS + .06;
  const dirs = { forward: [tx, tz], back: [-tx, -tz] };
  const crossSign = (player.end.x - across(s, .5)[0]) * tz - (player.end.z - across(s, .5)[2]) * tx > 0 ? -1 : 1;
  dirs.cross = [tz * crossSign, -tx * crossSign];
  arrows.forEach((arrow) => {
    const [dx, dz] = dirs[arrow.userData.kind];
    arrowGroundRay.origin.set(player.end.x + dx * 6.8, feet + 1, player.end.z + dz * 6.8);
    const ground = worldOctree.rayIntersect(arrowGroundRay);
    arrow.visible = !autopilot && !!ground && ground.distance < 2 && ground.triangle.getNormal(arrowGroundNormal).y > .35;
    if (!arrow.visible) return;
    arrow.position.copy(ground.position);
    arrow.position.y += .09;
    arrow.rotation.y = Math.atan2(dx, dz) - Math.PI;
    arrow.updateMatrixWorld(true);
    const facing = -Math.sin(yaw) * dx - Math.cos(yaw) * dz;
    arrow.material.opacity = facing > 0 ? .95 : .25;
  });
}
function walkTo(x, z, turn = true) {
  const distance = Math.hypot(x - player.end.x, z - player.end.z);
  autopilot = { x, z, speed: 4.2, since: 0, limit: distance / 1.2 + 3, turn };
}
function arrowGo(kind) {
  const { s, tx, tz } = roadFrame();
  if (kind === 'cross') {
    const u = (player.end.x - s.W[0]) * (s.E[0] - s.W[0]) + (player.end.z - s.W[2]) * (s.E[2] - s.W[2]);
    const d = u / s.width;
    const target = sectionPoint(s, s.width - Math.max(1.5, Math.min(s.width - 1.5, d)));
    walkTo(target[0], target[2]);
    return;
  }
  const sign = kind === 'forward' ? 1 : -1;
  walkTo(player.end.x + tx * sign * 14, player.end.z + tz * sign * 14);
}

// Input -----------------------------------------------------------------------------------------
const canvas = renderer.domElement;
addEventListener('keydown', (e) => { keys[e.code] = true; if (e.code === 'Space') e.preventDefault(); if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) { autopilot = null; hideHint(); } });
addEventListener('keyup', (e) => { keys[e.code] = false; });
const hideHint = () => $('hint').classList.add('gone');
const look = (dx, dy, k) => { yaw -= dx * k; pitch = Math.max(-1.35, Math.min(1.35, pitch - dy * k)); };
// Mouse: hold and drag to turn. The cursor always stays free to use the panel.
let dragging = false;
if (!touch) {
  canvas.addEventListener('mousedown', () => { dragging = true; canvas.classList.add('dragging'); hideHint(); });
  const release = () => { dragging = false; canvas.classList.remove('dragging'); };
  addEventListener('mouseup', release);
  addEventListener('blur', () => { release(); Object.keys(keys).forEach((k) => { keys[k] = false; }); });
  document.addEventListener('mousemove', (e) => { if (dragging) look(-e.movementX, -e.movementY, .0036); });
  canvas.addEventListener('wheel', (e) => { fovTarget = Math.max(28, Math.min(78, fovTarget + e.deltaY * .03)); e.preventDefault(); }, { passive: false });
}
// Everything also works from the keyboard, with no mouse at all.
addEventListener('keydown', (e) => {
  if (e.target.closest?.('dialog')) return;
  if (e.code === 'KeyE' || e.code === 'BracketRight') applyDesign(DESIGNS[(DESIGNS.indexOf(activeDesign) + 1) % DESIGNS.length]);
  if (e.code === 'KeyQ' || e.code === 'BracketLeft') applyDesign(DESIGNS[(DESIGNS.indexOf(activeDesign) - 1 + DESIGNS.length) % DESIGNS.length]);
  if (e.code === 'KeyT') { const order = Object.keys(TIMES); setTime(order[(order.indexOf(currentTime) + 1) % order.length]); }
  if (e.code === 'KeyH') document.body.classList.toggle('collapsed');
  if (/^Digit[1-9]$/.test(e.code)) { const d = DESIGNS[Number(e.code[5]) - 1]; if (d) applyDesign(d); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) Object.keys(keys).forEach((k) => { keys[k] = false; }); });

const pointers = new Map();
let pinch = 0, tapStart = null;
if (touch || params.has('arrows')) {
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    tapStart = pointers.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() } : null;
    hideHint();
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    const previous = pointers.get(e.pointerId);
    if (!previous) return;
    if (pointers.size === 2) {
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      const [a, b] = [...pointers.values()], gap = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) fovTarget = Math.max(28, Math.min(78, fovTarget * (pinch / gap)));
      pinch = gap;
      return;
    }
    look(e.clientX - previous[0], e.clientY - previous[1], -.0042 * (camera.fov / 68));
    if (tapStart && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) >= 10) tapStart = null;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
  });
  const up = (e) => {
    pointers.delete(e.pointerId); pinch = 0;
    if (tapStart?.id === e.pointerId && performance.now() - tapStart.t < 320 && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) < 10) tap(e.clientX, e.clientY);
    tapStart = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); pinch = 0; tapStart = null; });
}
const ray = new THREE.Raycaster();
function tap() {}

// Interface -------------------------------------------------------------------------------------
const wallDesigns = new Map();
let activeDesign = DESIGNS[0], target = 'all';
const targetWalls = () => {
  const list = shared.wallList;
  if (target === 'all') return list;
  if (target === 'bays') return list.filter((w) => w.id.startsWith('zone'));
  return list.filter((w) => w.id === target);
};
function designForWall(wall) {
  return wallDesigns.get(wall) || DESIGNS[0];
}
function syncDesignPanel() {
  const list = targetWalls(), design = designForWall(list[0]);
  const mixed = list.some((wall) => designForWall(wall) !== design);
  $('design-title').textContent = mixed ? 'Разные дизайны' : design.title;
  $('design-hint').textContent = mixed ? 'Выберите стену, чтобы увидеть её дизайн' : design.hint;
  document.querySelectorAll('.card').forEach((card) => {
    const selected = !mixed && card.dataset.id === design.id;
    card.setAttribute('aria-current', String(selected));
    if (selected) card.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  });
  const spots = list.flatMap((wall) => designForWall(wall).id === 'assembly' ? wall.anamorph?.assembly || [] : []);
  $('assembly').hidden = !spots.length;
  $('assembly').onclick = () => {
    const spot = spots[assemblyIndex++ % spots.length];
    moveToLocation([spot.eye.x, spot.eye.y - EYE, spot.eye.z], [spot.eye.x + spot.look.x * 20, spot.eye.y + spot.look.y * 20, spot.eye.z + spot.look.z * 20]);
  };
}
function applyDesign(design) {
  activeDesign = design;
  const list = targetWalls();
  list.forEach((wall) => wallDesigns.set(wall, design));
  paintAllWalls(list, design, tier, !shared.started);
  syncDesignPanel();
  const spots = shared.wallList.flatMap((wall) => designForWall(wall).id === 'assembly' ? wall.anamorph?.assembly || [] : []);
  shared.viewMarkers.forEach((marker, index) => { marker.visible = spots.includes(shared.viewpoints[index]); });
}
function buildCards() {
  const list = $('cards');
  DESIGNS.forEach((design) => {
    const card = document.createElement('button'); card.className = 'card'; card.dataset.id = design.id; card.type = 'button';
    const thumb = document.createElement('img'); thumb.width = 280; thumb.height = 88; thumb.alt = ''; thumb.loading = 'lazy'; thumb.src = shared.thumbnails[design.id];
    const label = document.createElement('span'); label.textContent = design.title;
    card.append(thumb, label);
    card.onclick = () => { applyDesign(design); renderSoon(); };
    list.append(card);
  });

}
const renderSoon = () => {};
function oppositeView(point, west, offset = 0) {
  const s = stationAtZ(point[2] + offset);
  return [sectionPoint(s, west ? s.width - 1.8 : 1.8), point];
}
function bayView(id) {
  const bay = bays[id];
  const geometry = bay.segments[0].mesh.geometry;
  const saved = bay.segments[0].bounds;
  const box = saved ? new THREE.Box3(new THREE.Vector3().fromArray(saved[0]), new THREE.Vector3().fromArray(saved[1])) : geometry.boundingBox;
  return oppositeView(box.getCenter(new THREE.Vector3()).toArray(), bay.side === 'west', id === 'zone52' ? 8 : 0);
}
const SPOTS = {
  low: () => { const s = station(1878), p = sectionPoint(s, s.width - 2.2), t = station(1915), l = across(t, .9); return [p, [l[0], l[1] + 2, l[2]]]; },
  high: () => { const c = walls.high.curve[Math.floor(walls.high.curve.length / 2)]; return oppositeView([c.x, (c.base + c.top) / 2, c.z], true); },
  step: () => { const c = walls.step.curve[2]; return [[c.x + 8, c.base + 0.1, c.z - 6.5], [c.x, c.base + 2.2, c.z]]; },
  zone68: () => bayView('zone68'),
  zone52: () => bayView('zone52'),
  road: () => { const s = station(1860), p = sectionPoint(s, s.width / 2), t = station(1960), l = across(t, .5); return [p, [l[0], l[1] + 2, l[2]]]; },
};
let locationRequest = 0;
async function moveToLocation(p, look) {
  const request = ++locationRequest;
  $('stream-status').hidden = false;
  try {
    await shared.prepareLocation(new THREE.Vector3(p[0], p[1] + EYE, p[2]), new THREE.Vector3().fromArray(look));
    if (request !== locationRequest) return;
    placePlayer(p[0], p[1] + .05, p[2], look[0], look[1], look[2]);
    $('stream-status').hidden = true;
  } catch (error) {
    $('stream-status').textContent = 'Не удалось загрузить участок. Попробуйте ещё раз.';
    return;
  }
}
function goto(name) {
  const [p, look] = SPOTS[name]();
  return moveToLocation(p, look);
}
function setupUI() {
  buildCards();
  document.querySelectorAll('[data-time]').forEach((b) => { b.onclick = () => setTime(b.dataset.time); });
  document.querySelectorAll('[data-target]').forEach((b) => {
    b.onclick = () => {
      target = b.dataset.target;
      activeDesign = designForWall(targetWalls()[0]);
      syncDesignPanel();
      document.querySelectorAll('[data-target]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    };
  });
  $('toggle').onclick = () => document.body.classList.toggle('collapsed');
  document.querySelectorAll('[data-walk]').forEach((button) => {
    button.onclick = () => { hideHint(); stepAlongRail(button.dataset.walk); };
  });
  if (touch) document.body.classList.add('touch');
  $('hint-text').textContent = touch ? 'Свайп: осмотреться. Стрелки: вперёд и назад.' : 'Тяни мышью или стрелками: поворот. WASD: идти, Shift: бег, пробел: прыжок. Q и E: дизайн, T: время.';
}
let assemblyIndex = 0;

// Markers on the sidewalk at the viewing spots.
function addViewMarkers() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff'; g.lineWidth = 22; g.beginPath(); g.arc(256, 256, 226, 0, 7); g.stroke();
  g.fillStyle = '#fff'; g.font = '700 58px Golos, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ВСТАНЬ', 256, 216); g.fillText('ЗДЕСЬ', 256, 290);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({ map: t, transparent: true, polygonOffset: true, polygonOffsetFactor: -3, roughness: .7 });
  shared.viewMarkers = shared.viewpoints.map((spot) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2), material);
    m.position.set(spot.eye.x, spot.eye.y - EYE + .04, spot.eye.z);
    m.rotation.y = Math.atan2(-spot.look.x, -spot.look.z);
    scene.add(m);
    return m;
  });
}

// Main ------------------------------------------------------------------------------------------
let lastSize = [innerWidth, innerHeight];
function resize() {
  // Lying sideways the phone has little height: keep the panel folded so the street stays in view.
  if (touch) document.body.classList.toggle('collapsed', innerWidth > innerHeight);
  if (innerWidth === lastSize[0] && innerHeight === lastSize[1]) return;
  lastSize = [innerWidth, innerHeight];
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer?.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
// Turning the phone: browsers report the new size late, so resize again once it settles.
addEventListener('orientationchange', () => { resize(); setTimeout(resize, 250); setTimeout(resize, 700); });
visualViewport?.addEventListener('resize', resize);

const clock = new THREE.Clock();
const fps = { value: 60 };
const snap = new THREE.Vector3();
// The street stands still, so its shadows are redrawn only when the shadowed area shifts or new parts appear.
let shadowFrame = 0, shadowDirty = true;
const shadowFocus = new THREE.Vector3(Infinity, 0, 0), shadowCheck = new THREE.Vector3();
function followSun() {
  shadowCheck.copy(camera.position).addScaledVector(forward, shadowRange * .35);
  const movingCars = carMatrices && ++shadowFrame % 2 === 0;
  if (!shadowDirty && !movingCars && shadowCheck.distanceToSquared(shadowFocus) < 16) return;
  shadowFocus.copy(shadowCheck); shadowDirty = false;
  const texel = (shadowRange * 2) / shadowSize;
  snap.set(Math.round(shadowCheck.x / texel) * texel, Math.round(shadowCheck.y / texel) * texel, Math.round(shadowCheck.z / texel) * texel);
  sun.target.position.copy(snap);
  sun.position.copy(snap).addScaledVector(sunDirection, 240);
  sun.shadow.needsUpdate = true;
}
// Keeps the frame rate up on weak devices by stepping quality down only when it is really needed.
let cullTick = 0, updateTrees = () => {};
let measureFrom = 0, measured = 0;
function measure(now) {
  if (document.hidden) { measureFrom = 0; return; }
  if (!measureFrom) { measureFrom = now; measured = 0; return; }
  measured++;
  if (now - measureFrom < 2000) return;
  fps.value = measured * 1000 / (now - measureFrom);
  measureFrom = now; measured = 0;

  if (params.has('fps')) $('fps').textContent = `${fps.value.toFixed(0)} fps, ${renderer.info.render.calls} вызовов, ${renderer.info.render.triangles} треуг.`;
}
let restFlip = false, settleUntil = 0;
function frame(now) {
  // A resting phone camera only has birds to animate: half the frames, less heat and battery.
  const resting = railMode && railAt >= 1 && !pointers.size && Math.abs(camera.fov - fovTarget) < .05 && now > settleUntil - 4000;
  if (resting && (restFlip = !restFlip)) { requestAnimationFrame(frame); return; }
  const dt = Math.min(.05, clock.getDelta());
  if (railMode) moveAlongRail(dt); else { movePlayer(dt / 2); movePlayer(dt / 2); }
  moveTraffic(dt);
  birds?.update(dt, camera.position);
  updateLampLights(dt);
  if ((cullTick -= dt) <= 0) { cullTick = .25; updateTrees(camera.position); }
  updateArrows();
  followSun();
  if (photoGrade) photoGrade.uniforms.tick.value = now % 97;
  renderer.info.reset();
  streamVisibleScene();
  if (composer) composer.render(); else renderer.render(scene, camera);
  measure(now);
  requestAnimationFrame(frame);
}

// Development helper: renders the tree model once for the billboard texture.
function bakeTree(tree) {
  const size = 1024, r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setSize(size, size); r.setClearColor(0, 0); r.toneMapping = THREE.AgXToneMapping; r.toneMappingExposure = 1.35;
  const s = new THREE.Scene(); s.environment = scene.environment; s.environmentIntensity = 1.1;
  const light = new THREE.DirectionalLight('#fff4e0', 2.6); light.position.set(3, 6, 4); s.add(light);
  s.add(tree);
  const c = new THREE.OrthographicCamera(-4.2, 4.2, 8.4, 0, .1, 60); c.position.set(0, 0, 20);
  r.render(s, c);
  return r.domElement.toDataURL('image/png');
}

let streamTick = 0, loadedChunks = 0;
function streamVisibleScene() {
  if (performance.now() < streamTick) return;
  streamTick = performance.now() + 250;
  shared.stream(camera).catch((error) => console.warn(error));
  const loadedNow = shared.streamStats().loaded;
  if (loadedNow !== loadedChunks) { loadedChunks = loadedNow; shadowDirty = true; }
}

async function start() {
  const started = performance.now(), mark = (label) => { if (params.has('fps')) console.info(label, Math.round(performance.now() - started), 'ms'); };
  const progress = (text) => { $('load-text').textContent = text; };
  const breathe = () => new Promise((r) => setTimeout(r, 0));
  progress('Собираем улицу по геодезии');
  await breathe();
  const load = async (name) => {
    const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/libs/meshopt_decoder.module.js')]);
    return (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`assets/models/${name}.glb`)).scene;
  };
  shared = await loadPreparedWorld(scene, renderer, { collision: !railMode });
  mark('мир');
  addViewMarkers();
  setupUI();
  if (touch) document.body.classList.toggle('collapsed', innerWidth > innerHeight);
  progress('Выкладываем камень');
  await breathe();
  applyDesign(DESIGNS[0]);
  shared.started = true;
  mark('стены');
  await setTime('overcast');
  mark('небо');
  progress('Настраиваем физику');
  await breathe();
  updateTrees = shared.treeUpdates.updateTrees;

  birds = createBirds(scene, tier === 'high' ? 36 : 18);
  shared.collision?.updateMatrixWorld(true);
  if (railMode) buildRail(); else { const { Octree } = await import('three/examples/jsm/math/Octree.js'); worldOctree = new Octree(); worldOctree.fromGraphNode(shared.collision); }
  mark('физика');
  setupArrows();
  spawn();
  camera.position.copy(player.end);
  camera.rotation.set(pitch, yaw, 0);
  await shared.stream(camera, 'near');
  progress('Готовим свет');
  await breathe();
  if (!railMode) movePlayer(.001); else moveAlongRail(.001);
  shadowDirty = true; followSun();

  await renderer.compileAsync(scene, camera).catch(() => {});
  mark('шейдеры');
  window.__street = { THREE, simulate: (seconds) => { for (let i = 0, n = seconds * 60; i < n; i++) movePlayer(1 / 60); }, setYaw: (v) => { yaw = v; }, get yaw() { return yaw; }, get pitch() { return pitch; }, sectionPoint, get autopilot() { return !!autopilot; }, composer, gtao, goto, setTime, applyDesign, DESIGNS, placePlayer, player, velocity, keys, scene, camera, stations, walls, bays, shared, setTarget: (t) => { target = t; }, get fps() { return fps.value; }, tap, arrowGo, get onFloor() { return onFloor; }, ready: true };
  clock.getDelta();
  requestAnimationFrame(frame);
  window.streetReady();
  $('loader').classList.add('done');
  mark('первый кадр');
  // Traffic is off for now, ?cars turns it back on.
  if (params.has('cars')) load('sedan').then((sedan) => {
    spawnTraffic(sedan);
    moveTraffic(0);
  }).catch((error) => console.warn('Не удалось загрузить машины', error));

  // Full tree models replace the nearest billboards a moment later, without holding up the start.
  if (tier === 'high') load('island_tree_01').then((tree) => {
    shared.treeUpdates.upgradeTrees(tree); shadowDirty = true; mark('деревья');
    if (params.has('bake')) window.__bake = () => bakeTree(tree);
  }).catch(() => {});
}
start().catch((error) => { $('load-text').textContent = 'Не удалось загрузить сцену. Обновите страницу.'; console.error(error); });
