// A flock of birds: two triangles per bird, wings flap in the vertex shader, so it costs almost nothing.
import * as THREE from 'three';

export function createBirds(scene, count) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, .28, 0, 0, -.22, -.62, 0, -.04, 0, 0, .28, .62, 0, -.04, 0, 0, -.22], 3));
  g.computeVertexNormals();
  const time = { value: 0 };
  const material = new THREE.MeshBasicMaterial({ color: '#23262b', side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.flapTime = time;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float flapTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float seed=instanceMatrix[3][0]*.13+instanceMatrix[3][2]*.17;
        transformed.y+=abs(position.x)*sin(flapTime*(7.+fract(seed)*3.)+seed*6.)*.75;`);
  };
  const mesh = new THREE.InstancedMesh(g, material, count);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const birds = Array.from({ length: count }, (_, i) => ({ phase: i * .37, lane: (i % 7) * 2.4 - 7, height: 24 + (i * 7) % 16, speed: .05 + (i % 5) * .004 }));
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const centre = new THREE.Vector3();
  return {
    mesh,
    update(dt, eye) {
      time.value += dt;
      centre.x += (eye.x - centre.x) * Math.min(1, dt * .08);
      centre.z += (eye.z - centre.z) * Math.min(1, dt * .08);
      const t = time.value;
      birds.forEach((b, i) => {
        const a = t * b.speed + b.phase * .06, r = 70 + b.lane * 2.2 + Math.sin(a * 2.3) * 16;
        p.set(centre.x + Math.cos(a) * r + Math.sin(b.phase) * 5, eye.y + b.height + Math.sin(t * .5 + b.phase) * 1.4, centre.z + Math.sin(a) * r * .8 + Math.cos(b.phase) * 5);
        q.setFromAxisAngle(up, -a);
        s.setScalar(1 + (i % 3) * .12);
        mesh.setMatrixAt(i, matrix.compose(p, q, s));
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
