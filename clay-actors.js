/* Snake on Surfaces · Copyright 2026 Xingying Li · Apache-2.0 */
'use strict';

// Presentation only. The game supplies immutable views of its cells and poses;
// this renderer never advances, normalizes, or writes to the game state.
function createClayActors({ THREE, parent, getState, frameAt, frameBetween }) {
  const group = new THREE.Group();
  group.name = 'clay-actors';
  parent.add(group);
  const sphere = new THREE.SphereGeometry(1, 24, 16);
  const capsule = new THREE.CapsuleGeometry(1, 1, 6, 20);
  capsule.rotateX(Math.PI / 2);
  const material = (color, roughness = 0.42) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
  const skin = material(0xe98555);
  const cream = material(0xffdfac, 0.6);
  const white = material(0xfffdf1, 0.32);
  const dark = material(0x283e3b, 0.22);
  const rose = material(0xe46751);
  const leafMaterial = material(0x4e9b6b, 0.65);
  const stemMaterial = material(0x88704b, 0.8);
  const bodyMaterial = material(0xffffff);
  const foodMaterials = {
    grow: material(0xefb74f), slow: material(0x70b7df),
    shrink: material(0xd96b72), speedUp: material(0x86bb60),
  };
  const tailColor = new THREE.Color(0xf2b574);
  const bodyColor = new THREE.Color(0xe98555);
  const color = new THREE.Color();
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function ball(owner, mat, dimensions, at = [0, 0, 0]) {
    const mesh = new THREE.Mesh(sphere, mat);
    mesh.scale.set(...dimensions);
    mesh.position.set(...at);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    owner.add(mesh);
    return mesh;
  }

  const head = new THREE.Group();
  head.name = 'snake-head';
  group.add(head);
  const headSkin = ball(head, skin, [1.1, 0.94, 1.2]);
  const muzzle = ball(head, cream, [0.83, 0.49, 0.64], [0, -0.14, 0.7]);
  const eyes = [];
  for (const sign of [-1, 1]) {
    const eye = new THREE.Group();
    head.add(eye);
    ball(eye, white, [0.43, 0.46, 0.43]);
    ball(eye, dark, [0.185, 0.15, 0.16], [0.015, 0.30, 0.31]);
    ball(eye, white, [0.055, 0.055, 0.045], [0.07, 0.38, 0.40]);
    eyes.push({ eye, sign });
  }
  const cheeks = [-1, 1].map(sign => ({ sign, mesh: ball(head, rose, [0.13, 0.11, 0.17]) }));
  const smileGeometry = new THREE.TorusGeometry(0.30, 0.035, 8, 20, Math.PI);
  const smile = new THREE.Mesh(smileGeometry, dark);
  smile.rotation.z = Math.PI;
  head.add(smile);

  let capacity = 0, bodyMesh, bellyMesh, neckMesh;
  function ensureCapacity(count) {
    if (count <= capacity) return;
    capacity = Math.max(16, 2 ** Math.ceil(Math.log2(count)));
    for (const mesh of [bodyMesh, bellyMesh, neckMesh]) {
      if (!mesh) continue;
      group.remove(mesh);
      mesh.dispose();
    }
    bodyMesh = new THREE.InstancedMesh(capsule, bodyMaterial, capacity);
    bellyMesh = new THREE.InstancedMesh(sphere, cream, capacity);
    neckMesh = new THREE.InstancedMesh(sphere, skin, capacity * 3);
    bodyMesh.name = 'snake-body';
    bellyMesh.name = 'snake-belly';
    neckMesh.name = 'snake-joints';
    for (const mesh of [bodyMesh, bellyMesh, neckMesh]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      group.add(mesh);
    }
  }
  ensureCapacity(16);

  const foodPool = [];
  const stemGeometry = new THREE.CylinderGeometry(0.075, 0.1, 0.38, 8);
  function makeFruit() {
    const root = new THREE.Group();
    root.name = 'fruit';
    const fruit = ball(root, foodMaterials.grow, [0.68, 0.63, 0.65], [0, 0.08, 0]);
    const stem = new THREE.Mesh(stemGeometry, stemMaterial);
    stem.position.set(0, 0.78, 0);
    stem.rotation.z = -0.18;
    root.add(stem);
    const leaf = ball(root, leafMaterial, [0.34, 0.065, 0.18], [0.24, 0.82, 0]);
    leaf.rotation.z = 0.4;
    const secondLeaf = ball(root, leafMaterial, [0.25, 0.055, 0.15], [-0.2, 0.79, 0.04]);
    secondLeaf.rotation.z = -0.45;
    group.add(root);
    return { root, fruit, secondLeaf, food: null, frame: null };
  }

  function pose(frame) {
    const up = frame.normal.clone().normalize();
    const forward = frame.forward.clone().addScaledVector(up, -frame.forward.dot(up)).normalize();
    const right = new THREE.Vector3().crossVectors(up, forward).normalize();
    forward.crossVectors(right, up).normalize();
    return {
      position: frame.position.clone().addScaledVector(up, frame.radius * 0.92),
      rotation: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, forward)),
      radius: frame.radius, length: frame.length, reach: frame.reach,
    };
  }

  let previous = [], targets = [], lastHead = null, lastScale = null;
  let cells = [], previousCells = [];
  let links = [], previousLinks = [];
  let lastTime = null, clock = 0, startedAt = 0, duration = 0;
  let lastScore = null, biteAt = -1000;
  const previousCenter = new THREE.Vector3();
  const jointCenter = new THREE.Vector3();
  const jointDirection = new THREE.Vector3();
  const jointRotation = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const lastSample = new THREE.Vector3();
  const nextSample = new THREE.Vector3();

  function update(time) {
    const state = getState();
    const dt = lastTime === null ? 0 : Math.min(time - lastTime, 50);
    lastTime = time;
    if (!state.paused && state.running) clock += dt;
    if (lastScore !== null && state.score > lastScore) biteAt = clock;
    lastScore = state.score;
    if (lastHead !== state.snake[0] || lastScale !== state.scale || targets.length !== state.snake.length) {
      previous = targets;
      previousCells = cells;
      cells = state.snake.slice();
      targets = state.snake.map((cell, i) => pose(frameAt(cell, i === 0 ? state.direction : null, state.snake[i - 1])));
      previousLinks = links;
      links = cells.map((cell, i) => i === 0 ? [] : [1 / 3, 2 / 3].map(u => {
        const frame = frameBetween?.(cell, cells[i - 1], u);
        return frame ? pose(frame).position : null;
      }));
      lastHead = state.snake[0];
      lastScale = state.scale;
      startedAt = clock;
      duration = Math.min(110, state.speed * 0.7);
      ensureCapacity(state.snake.length);
    }
    const progress = reducedMotion || !state.running ? 1 : Math.min(1, (clock - startedAt) / Math.max(duration, 1));
    const t = progress * progress * (3 - 2 * progress);
    head.visible = targets.length > 0;
    bodyMesh.count = bellyMesh.count = Math.max(0, targets.length - 1);
    neckMesh.count = bodyMesh.count * 3;
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const from = previous[i];
      const local = from && from.position.distanceTo(target.position) < Math.max(from.reach, target.reach);
      position.copy(target.position);
      rotation.copy(target.rotation);
      if (local && t < 1) {
        const stepFrame = frameBetween?.(previousCells[i], cells[i], t);
        if (stepFrame) position.copy(pose(stepFrame).position);
        else position.lerpVectors(from.position, target.position, t);
        rotation.slerpQuaternions(from.rotation, target.rotation, t);
      }
      const taper = i > 0 && i === targets.length - 1 ? 0.76 : 1;
      const radius = target.radius * taper;
      normal.set(0, 1, 0).applyQuaternion(rotation);
      if (i > 0) {
        lastSample.copy(position);
        for (let part = 1; part <= 3; part++) {
          const u = part / 3;
          const targetPoint = part < 3 && links[i]?.[part - 1];
          if (targetPoint) {
            nextSample.copy(targetPoint);
            const oldPoint = local && t < 1 && previousLinks[i]?.[part - 1];
            if (oldPoint) nextSample.lerpVectors(oldPoint, nextSample, t);
          } else {
            nextSample.lerpVectors(position, previousCenter, u);
          }
          jointDirection.subVectors(nextSample, lastSample);
          const distance = jointDirection.length();
          if (distance > 0.0001 && distance < Math.max(target.reach, targets[i - 1].reach)) {
            jointCenter.addVectors(nextSample, lastSample).multiplyScalar(0.5);
            jointRotation.setFromUnitVectors(zAxis, jointDirection.normalize());
            scale.set(radius * 0.75, radius * 0.75, distance * 0.64 + radius * 0.25);
            matrix.compose(jointCenter, jointRotation, scale);
          } else {
            matrix.makeScale(0, 0, 0);
          }
          neckMesh.setMatrixAt((i - 1) * 3 + part - 1, matrix);
          lastSample.copy(nextSample);
        }
      }
      previousCenter.copy(position);
      if (i === 0) {
        const bite = reducedMotion ? 1 : 1 + 0.16 * Math.max(0, 1 - (clock - biteAt) / 220);
        head.position.copy(position);
        head.quaternion.copy(rotation);
        head.scale.setScalar(radius * 1.12 * bite);
        const stretch = Math.min(1.7, Math.max(1.1, target.length / target.radius));
        headSkin.scale.z = stretch;
        muzzle.scale.z = stretch * 0.53;
        muzzle.position.z = stretch * 0.61;
        for (const { eye, sign } of eyes) eye.position.set(sign * 0.47, 0.70, stretch * 0.3);
        for (const { mesh, sign } of cheeks) mesh.position.set(sign * 0.93, 0.14, stretch * 0.48);
        smile.position.set(0, -0.04, stretch * 1.12);
      } else {
        scale.set(radius, radius * 0.96, target.length * taper / 1.5);
        matrix.compose(position, rotation, scale);
        bodyMesh.setMatrixAt(i - 1, matrix);
        bodyMesh.setColorAt(i - 1, color.copy(bodyColor).lerp(tailColor, i / targets.length));
        position.addScaledVector(normal, -radius * 0.30);
        scale.set(radius * 0.95, radius * 0.55, target.length * taper * 0.97);
        matrix.compose(position, rotation, scale);
        bellyMesh.setMatrixAt(i - 1, matrix);
      }
    }
    bodyMesh.instanceMatrix.needsUpdate = bellyMesh.instanceMatrix.needsUpdate = neckMesh.instanceMatrix.needsUpdate = true;
    if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;

    while (foodPool.length < state.foods.length) foodPool.push(makeFruit());
    for (let i = 0; i < foodPool.length; i++) {
      const entry = foodPool[i], food = state.foods[i];
      entry.root.visible = !!food;
      if (!food) continue;
      if (entry.food !== food || entry.scale !== state.scale) {
        entry.food = food;
        entry.scale = state.scale;
        const frame = frameAt(food);
        entry.frame = { ...pose(frame), normal: frame.normal };
        entry.fruit.material = foodMaterials[food.type];
        entry.fruit.scale.set(0.68, food.type === 'slow' ? 0.78 : 0.63, 0.65);
        entry.secondLeaf.visible = food.type === 'speedUp';
      }
      const frame = entry.frame;
      const phase = clock * 0.003 + food.gx * 2.5 + food.gy * 3.1;
      const bob = reducedMotion ? 0 : 0.08 * Math.sin(phase);
      entry.root.position.copy(frame.position).addScaledVector(frame.normal, frame.radius * (0.20 + bob));
      entry.root.quaternion.copy(frame.rotation);
      entry.root.rotateY(reducedMotion ? 0.3 : Math.sin(phase * 0.6) * 0.2);
      const age = 1 - Math.min(1, food.age / state.foodLifetime);
      entry.root.scale.setScalar(frame.radius * 1.35 * (0.85 + 0.15 * age));
    }
  }
  return { update, group };
}
