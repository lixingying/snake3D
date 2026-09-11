// Run with: node tests/projective-regression.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'snake3d.html'), 'utf8');
const names = [
  'normalizeGridPosition', 'wrapGrid', 'sameSurfaceSide', 'sameSurfaceFace',
  'directionAngle', 'rotateGridVector', 'reflectAcrossDirectionAxis',
  'surfaceToChartVector', 'chartToSurfaceDirection', 'queueChartDirection',
  'boundaryCrossingEdge', 'projectiveStepWord', 'reduceProjectiveWord',
  'emptyTopologyState', 'cloneTopologyState', 'advanceTopologyState',
  'invertTopologyWord', 'reduceTopologyWord', 'topologyDifferenceInfo',
  'loopWordLabel', 'topologyWordFormula', 'wordFormula', 'drawMiniMap',
  'tr', 'selfClosureInfo', 'sameSnakeCell', 'isOccupied', 'gameTick',
  'pickFoodType', 'trySpawnFood', 'applyEffect', 'winByLoop', 'die',
  'setMsg', 'addMsg', 'clearMsgTimer', 'updateUI', 'victoryGoalText',
  'setPi1Text', 'updatePi1Panel', 'topologyStateFormula', 'topologyRelationFormula',
  'describeTopologyMove', 'describeProjectiveMove', 'setText', 'applyStaticText',
  'markContextFor', 'createMarkMaterial', 'ensureSurfaceGeometry',
  'buildInitialSnake', 'initializeSnakeTopology', 'inferStepDirection',
  'powerTerm', 'torusStateFormula', 'mobiusStateFormula',
  'projectivePointUV', 'projectiveSquareToDisk', 'resetSnake',
];

function functionSource(name) {
  const match = source.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}`, 'm'));
  assert.ok(match, `Missing game function: ${name}`);
  return match[0];
}

function createGame(mapType = 'projective') {
  const rectangles = [];
  const elements = {};
  const canvasContext = {
    fillRect(x, y, width, height) {
      rectangles.push({ x, y, width, height, color: this.fillStyle });
    },
  };
  for (const name of ['beginPath', 'closePath', 'moveTo', 'lineTo', 'stroke', 'strokeRect', 'arc', 'fill']) {
    canvasContext[name] = () => {};
  }
  const game = vm.createContext({
    MAP_TYPE: mapType, GRID_SIZE: mapType === 'mobius' ? 14 : 20,
    LANG: 'en', PROJECTIVE_RELATOR: ['a', 'a'],
    fieldScale: 1, INITIAL_SNAKE_LENGTH: 3,
    LOOP_WIN_MAPS: new Set(['sphere', 'projective', 'torus', 'mobius', 'klein', 'genus2']),
    PI1_PANEL_MAPS: new Set(['projective']), topologyHintsVisible: true, pi1LastStep: null,
    MAP_HALF: 4, MAP_CELLS: 9, MAP_PX: 28,
    mapCanvas: { width: 252, height: 252 }, MAP_CTX: canvasContext,
    FOOD_DEF: { grow: { color: 0xf39c12, weight: 1 } },
    MIN_FOODS: 0, MAX_FOODS: 9, FOOD_LIFETIME: 220, SPAWN_INTERVAL: 24,
    direction: { dx: 1, dy: 0 }, nextDir: { dx: 1, dy: 0 },
    chartDisplayDir: { dx: 1, dy: 0 }, chartMirror: 1,
    snake: [], foods: [],
    running: true, paused: false, spawnTimer: 999, speed: 150, score: 0, best: 0,
    performance: { now: () => 0 }, msgTimer: null,
    setTimeout: () => 0, clearTimeout() {}, localStorage: { setItem() {} },
    document: { getElementById(id) { return elements[id] ||= { style: {} }; } },
    THREE: {
      FrontSide: 0, BackSide: 1, DoubleSide: 2,
      Vector3: class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } },
      MeshBasicMaterial: class { constructor(options) { Object.assign(this, options); } },
      MeshStandardMaterial: class { constructor(options) { Object.assign(this, options); } },
      Mesh: class { constructor(geometry, material) {
        this.geometry = geometry; this.material = material; this.position = { set() {} };
      } },
    },
    torusMaterial: null, torusMesh: null,
    markMaterialFront: null, markMaterialBack: null, markMeshFront: null, markMeshBack: null,
    gridTex: {}, markTexFront: { name: 'front texture' }, markTexBack: { name: 'back texture' },
    markCtxFront: { name: 'front canvas' }, markCtxBack: { name: 'back canvas' },
    cutOverlayGroup: null, surfaceGroup: { children: [], add(mesh) { this.children.push(mesh); }, remove() {} },
    createProjectiveGeometry: () => ({ dispose() {} }), createCutOverlayGroup: () => null,
    getR: () => 1, getr: () => 1,
  });
  vm.runInContext(source.match(/^const TEXT = \{[\s\S]*?^};/m)[0], game);
  vm.runInContext(names.map(functionSource).join('\n'), game);
  game.rectangles = rectangles;
  game.elements = elements;
  return game;
}

const directions = [
  { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
  { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
];

function run() {
  const game = createGame();
  const size = game.GRID_SIZE;
  let transitions = 0;
  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      for (const side of [1, -1]) {
        for (const dir of directions) {
          const next = game.normalizeGridPosition(gx + dir.dx, gy + dir.dy, dir, side);
          const crosses = gx + dir.dx < 0 || gx + dir.dx >= size || gy + dir.dy < 0 || gy + dir.dy >= size;
          assert.equal(next.side, crosses ? -side : side, 'Swap side only at glued edges');
          const back = { dx: -next.dir.dx, dy: -next.dir.dy };
          const original = game.normalizeGridPosition(next.gx + back.dx, next.gy + back.dy, back, next.side);
          assert.equal(original.gx, gx);
          assert.equal(original.gy, gy);
          assert.equal(original.side, side, 'A step and its reverse restore the physical side');
          const state = game.advanceTopologyState({ word: [] }, { gx, gy }, dir);
          const restored = game.advanceTopologyState(state, next, back);
          assert.equal(restored.word.length, 0, 'A step and its reverse must cancel');
          transitions++;
        }
      }
    }
  }

  function checkLoop(start, moves, nontrivial, label) {
    let position = { gx: start[0], gy: start[1], side: 1 };
    let state = { word: [] };
    for (const dir of moves) {
      state = game.advanceTopologyState(state, position, dir);
      position = game.normalizeGridPosition(position.gx + dir.dx, position.gy + dir.dy, dir, position.side);
    }
    assert.equal(position.gx, start[0], label);
    assert.equal(position.gy, start[1], label);
    assert.equal(game.topologyDifferenceInfo({ word: [] }, state).nontrivial, nontrivial, label);
    assert.equal(position.side, nontrivial ? -1 : 1, `${label}: lifted endpoint`);
  }
  const right = { dx: 1, dy: 0 }, left = { dx: -1, dy: 0 };
  const up = { dx: 0, dy: -1 }, down = { dx: 0, dy: 1 };
  checkLoop([10, 10], [right, down, left, up], false, 'Interior square is trivial');
  checkLoop([0, 0], [left, down], false, 'Loop around an identified corner is trivial');
  const generator = [...Array(size).fill(right), down];
  checkLoop([10, 10], generator, true, 'A loop crossing the boundary once is nontrivial');
  checkLoop([10, 10], [...generator, ...generator], false, 'Traversing that loop twice is trivial');

  // Exhaust the movement graph together with the RP² homotopy state. This
  // checks all paths, not just the example loops: no same-side return can
  // represent the nontrivial class under the current gluing rules.
  let reachableStates = 0;
  for (const side of [1, -1]) {
    const start = { gx: 10, gy: 10, side, topo: { word: [] } };
    const key = p => `${p.gx},${p.gy},${p.side},${p.topo.word.join('')}`;
    const seen = new Set([key(start)]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const position = queue[i];
      if (game.sameSnakeCell(position, start.gx, start.gy, side, null)) {
        assert.equal(game.topologyDifferenceInfo(start.topo, position.topo).nontrivial, false,
          'Every reachable same-cell, same-side return is homotopically trivial in RP²');
      }
      for (const dir of directions) {
        const next = game.normalizeGridPosition(position.gx + dir.dx, position.gy + dir.dy, dir, position.side);
        next.topo = game.advanceTopologyState(position.topo, position, dir);
        if (seen.has(key(next))) continue;
        seen.add(key(next));
        queue.push(next);
      }
    }
    assert.equal(queue.length, 2 * size * size);
    reachableStates += queue.length;
  }

  // Check the actual 3D parametrization, rather than just the side flag:
  // the transported physical normal must remain continuous across the seam.
  function normalAt(u, v) {
    const h = 1e-7;
    const delta = (a, b) => [a.x - b.x, a.y - b.y, a.z - b.z];
    const du = delta(game.projectivePointUV(u + h, v), game.projectivePointUV(u - h, v));
    const dv = delta(game.projectivePointUV(u, v + h), game.projectivePointUV(u, v - h));
    const n = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]];
    const length = Math.hypot(...n);
    return n.map(x => x / length);
  }
  let seamNormals = 0;
  const epsilon = 1e-5;
  for (const t of [0.2, 0.35, 0.65, 0.8]) {
    for (const [from, to] of [
      [[1 - epsilon, t], [epsilon, 1 - t]],
      [[t, 1 - epsilon], [1 - t, epsilon]],
    ]) {
      const n1 = normalAt(...from), n2 = normalAt(...to);
      assert.ok(n1.reduce((sum, x, i) => sum - x * n2[i], 0) > 0.9999,
        'Flipping side must preserve the physical normal across a glued edge');
      seamNormals++;
    }
  }

  let neighborChecks = 0;
  for (const gx of [0, size - 1]) {
    for (const gy of [0, size - 1]) {
      for (const mirror of [1, -1]) {
        for (const facing of directions) {
          game.chartMirror = mirror;
          game.chartDisplayDir = facing;
          game.snake = [{ gx, gy, side: 1, face: null }];
          for (const screenDir of directions) {
            const dir = game.chartToSurfaceDirection(screenDir);
            const next = game.normalizeGridPosition(gx + dir.dx, gy + dir.dy, dir);
            game.foods = [{ ...next, type: 'grow' }];
            game.rectangles.length = 0;
            game.drawMiniMap();
            const found = game.rectangles.some(rect =>
              rect.color === '#f39c12' &&
              Math.floor(rect.x / game.MAP_PX) === 4 + screenDir.dx &&
              Math.floor(rect.y / game.MAP_PX) === 4 + screenDir.dy);
            assert.ok(found, `Missing adjacent food at (${gx},${gy}), direction (${screenDir.dx},${screenDir.dy}), mirror ${mirror}`);
            neighborChecks++;
          }
        }
      }
    }
  }

  game.direction = game.nextDir = game.chartDisplayDir = right;
  game.chartMirror = 1;
  game.foods = [];
  game.snake = [{ gx: 0, gy: 0, side: 1 }, { gx: 19, gy: 19, side: -1 }];
  game.rectangles.length = 0;
  game.drawMiniMap();
  for (const [x, y] of [[3, 4], [4, 3]]) {
    assert.ok(game.rectangles.some(rect => rect.color.startsWith('rgba(255,140,66,') &&
      Math.floor(rect.x / 28) === x && Math.floor(rect.y / 28) === y),
    'The same body segment must be visible through both corner adjacencies');
  }

  // The opposite local side must be invisible, including at a seam.
  for (const side of [1, -1]) {
    game.snake = [{ gx: 0, gy: 7, side }];
    const across = game.normalizeGridPosition(-1, 7, left, side);
    game.foods = [{ gx: across.gx, gy: across.gy, side, type: 'grow' }];
    game.rectangles.length = 0;
    game.drawMiniMap();
    assert.equal(game.rectangles.filter(rect => rect.color === '#f39c12').length, 0);
    game.foods[0].side = across.side;
    game.rectangles.length = 0;
    game.drawMiniMap();
    assert.equal(game.rectangles.filter(rect => rect.color === '#f39c12').length, 1);
  }

  function beforeLastStep(moves, start = [10, 10], side = 1) {
    const g = createGame();
    const body = [{ gx: start[0], gy: start[1], side, face: null, topo: { word: [] } }];
    for (const dir of moves.slice(0, -1)) {
      const previous = body[body.length - 1];
      const next = g.normalizeGridPosition(previous.gx + dir.dx, previous.gy + dir.dy, dir, previous.side);
      body.push({ ...next, face: null, topo: g.advanceTopologyState(previous.topo, previous, dir) });
    }
    g.snake = body.reverse();
    g.direction = g.nextDir = g.chartDisplayDir = moves[moves.length - 1];
    return g;
  }

  for (const side of [1, -1]) {
    const odd = beforeLastStep(generator, [10, 10], side);
    odd.updatePi1Panel();
    assert.equal(odd.elements.pi1Close.textContent, odd.tr('nextNotClosed'));
    odd.gameTick();
    assert.equal(odd.running, true, 'A projected nontrivial loop ends on the other side and must not win or cut');
    assert.equal(odd.snake.length, generator.length);
    assert.equal(odd.snake[0].side, -side);

    for (const moves of [[right, down, left, up], [...generator, ...generator]]) {
      const closed = beforeLastStep(moves, [10, 10], side);
      closed.updatePi1Panel();
      assert.ok(closed.elements.pi1Close.textContent.includes('(trivial)'));
      assert.equal(closed.elements.pi1Close.className, 'pi1-val pi1-warn', 'A trivial loop must be marked as failing');
      closed.gameTick();
      assert.equal(closed.running, true, 'A same-side closure must not win when it is homotopically trivial');
      assert.equal(closed.elements.msg.textContent, closed.tr('failTrivial'));
      assert.equal(closed.snake[0].side, side);
    }
  }

  // Eating and occupying one face must not affect the other face of that cell.
  for (const foodSide of [1, -1]) {
    const eating = createGame();
    eating.snake = [{ gx: 19, gy: 7, side: 1, topo: { word: [] } }];
    eating.foods = [{ gx: 0, gy: 12, side: foodSide, type: 'grow', age: 0 }];
    eating.gameTick();
    assert.equal(eating.snake[0].side, -1);
    assert.equal(eating.score, foodSide === -1 ? 1 : 0);
    if (foodSide === 1) assert.ok(eating.foods.some(f => f.gx === 0 && f.gy === 12 && f.side === 1));
  }
  const spawning = createGame();
  spawning.Math = Object.create(Math);
  spawning.Math.random = () => 0.25;
  spawning.trySpawnFood();
  assert.equal(spawning.foods[0].side, -1, 'Food can spawn on the back face');
  spawning.Math.random = () => 0.75;
  spawning.trySpawnFood();
  assert.equal(spawning.foods[1].side, 1, 'Food can spawn on the front face');
  assert.equal(spawning.isOccupied(5, 5, -1), true);
  assert.equal(spawning.isOccupied(5, 5, 1), false);

  // A body that crosses a seam keeps a separate side on each segment.
  const seeded = createGame();
  seeded.snake = seeded.buildInitialSnake({ gx: 0, gy: 7, side: 1, face: null }, 3);
  seeded.initializeSnakeTopology();
  assert.deepEqual(Array.from(seeded.snake, s => s.side), [1, -1, -1]);
  assert.equal(seeded.snake[0].topo.word.join(''), 'a');
  seeded.resetSnake();
  assert.ok(seeded.snake.every(s => s.side === -1), 'The initial snake is on the outward-facing side');

  const materials = createGame();
  materials.ensureSurfaceGeometry();
  assert.equal(materials.torusMaterial.side, materials.THREE.DoubleSide, 'The paper remains visible from both sides');
  assert.equal(materials.markMaterialFront.side, materials.THREE.FrontSide);
  assert.equal(materials.markMaterialBack.side, materials.THREE.BackSide);
  assert.equal(materials.markMeshFront.material.map, materials.markTexFront);
  assert.equal(materials.markMeshBack.material.map, materials.markTexBack);
  assert.equal(materials.markContextFor({ side: 1 }), materials.markCtxFront);
  assert.equal(materials.markContextFor({ side: -1 }), materials.markCtxBack);
  for (const lang of ['en', 'zh']) {
    materials.LANG = lang;
    materials.applyStaticText();
    assert.equal(materials.elements.pi1Title.textContent, materials.tr('pi1Title'));
    assert.equal(materials.topologyRelationFormula(), 'aa = 1');
    assert.equal(materials.victoryGoalText(), materials.tr('goalProjective'));
    assert.equal(materials.victoryGoalText(), lang === 'en'
      ? 'Ouroboros: nontrivial loop' : '形成衔尾蛇：非平凡环路');
  }

  for (const type of ['torus', 'mobius', 'klein']) {
    const other = createGame(type);
    other.snake = [{ gx: 0, gy: 0, side: 1 }];
    const food = other.normalizeGridPosition(-1, 0, left);
    other.foods = [{ ...food, type: 'grow' }];
    other.drawMiniMap();
    assert.equal(other.rectangles.filter(rect => rect.color === '#f39c12').length, 1,
      `${type}: retain one food image`);
  }
  for (const type of ['sphere', 'torus', 'mobius']) {
    const other = createGame(type);
    const identity = type === 'torus' ? { wx: 0, wy: 0 } : { w: 0, boundary: 0 };
    other.snake = [{ topo: identity }];
    assert.equal(other.selfClosureInfo(identity, 0).wins, type === 'sphere');
    if (type === 'torus') assert.equal(other.selfClosureInfo({ wx: 1, wy: 0 }, 0).wins, true);
    if (type === 'mobius') assert.equal(other.selfClosureInfo({ w: 2, boundary: 0 }, 0).wins, true);
  }
  return { transitions, reachableStates, seamNormals, projectedLoops: 4, liveClosureScenarios: 6, cornerNeighborDisplays: neighborChecks,
    bodyAliases: 2, sideVisibilityCases: 4, foodCollisionCases: 2, otherMaps: 4, separateFrontBackMaterials: true };
}

module.exports = { run };
if (require.main === module) console.log('Projective regression checks passed:', run());
