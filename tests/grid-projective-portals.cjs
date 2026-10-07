// Node 18+: node tests/grid-projective-portals.cjs [/path/to/three.core.mjs]
// Runs the actual page script with real Three.js geometry and recorded canvas calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { URLSearchParams, pathToFileURL } = require('node:url');

function createApp(THREE, map = 'projective') {
  const elements = new Map();
  const seededMath = Object.create(Math);
  let seed = 0x51a7, now = 0;
  seededMath.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  function element(id) {
    const calls = [];
    const context = new Proxy({ calls }, {
      get(object, key) {
        if (key in object) return object[key];
        return (...args) => calls.push({ op: key, args, fillStyle: object.fillStyle, strokeStyle: object.strokeStyle });
      },
    });
    return { id, width: 252, height: 252, clientWidth: 1000, clientHeight: 750,
      style: {}, textContent: '', appendChild() {}, addEventListener() {},
      getContext: () => context, setPointerCapture() {}, hasPointerCapture: () => false,
      releasePointerCapture() {},
    };
  }
  const document = { documentElement: {}, createElement: element, addEventListener() {},
    getElementById(id) { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); },
  };
  class Renderer {
    constructor() { this.domElement = element('renderer'); this.shadowMap = {}; }
    setSize() {} setPixelRatio() {} render() {}
  }
  const sandbox = vm.createContext({ THREE: { ...THREE, WebGLRenderer: Renderer }, document,
    window: { devicePixelRatio: 1, matchMedia: () => ({ matches: false }), addEventListener() {} },
    navigator: { languages: ['en'] }, location: { search: '?map=' + map }, URLSearchParams,
    localStorage: { getItem() { return null; }, setItem() {} }, console, Math: seededMath,
    performance: { now: () => now }, requestAnimationFrame() {},
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
  });
  const html = fs.readFileSync(path.join(__dirname, '..', 'snake3d.html'), 'utf8');
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm, '');
  vm.runInContext(script, sandbox, { filename: 'snake3d.html', timeout: 30000 });
  const invoke = code => vm.runInContext(code, sandbox);
  return { sandbox, elements, invoke, setTime: value => { now = value; },
    read: code => JSON.parse(JSON.stringify(invoke(code))),
    normalize: invoke('normalizeGridPosition'),
    advance: invoke('advanceTopologyState'),
    contexts: invoke('({front:markCtxFront,back:markCtxBack,chart:MAP_CTX})'),
  };
}

const directions = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];
function step(app, p, dir) {
  const q = app.normalize(p.gx + dir.dx, p.gy + dir.dy, dir, p.side, p.face);
  return { gx: q.gx, gy: q.gy, side: q.side, face: q.face ?? null,
    topo: app.advance(p.topo, p, dir), dir: q.dir };
}
function pathFrom(app, p, moves) {
  const points = [{ ...p, face: p.face ?? null, topo: app.invoke('emptyTopologyState()') }];
  for (const dir of moves) points.push(step(app, points[points.length - 1], dir));
  return points;
}
function setGame(app, points, dir, foods = [], portals = []) {
  app.invoke(`snake=${JSON.stringify(points.slice().reverse())};
    direction=${JSON.stringify(dir)}; nextDir={...direction}; chartDisplayDir={...direction}; chartMirror=1;
    foods=${JSON.stringify(foods)}; score=0; best=0; speed=150; running=true; paused=false;
    spawnTimer=100; topologyHintsVisible=true; setMsg('');
    portals=${JSON.stringify(portals)}; portalSpawnElapsed=0; portalLastUpdate=performance.now(); nextPortalId=100;`);
}
function predictAndTick(app, nontrivial) {
  app.invoke('updatePi1Panel()');
  const prediction = app.elements.get('pi1Close').textContent;
  assert.ok(prediction.endsWith(nontrivial ? '(nontrivial)' : '(trivial)'), prediction);
  app.invoke('gameTick()');
  assert.equal(app.invoke('running'), !nontrivial, 'Actual closure agrees with the topology hint');
  assert.match(app.elements.get('msg').textContent, nontrivial ? /^Win!/ : /^Trivial loop/);
}
function rotate(p, turns, n) {
  let { gx, gy } = p;
  for (let i = 0; i < turns; i++) [gx, gy] = [n - 1 - gy, gx];
  return { ...p, gx, gy };
}
function rotateDir(dir, turns) {
  let { dx, dy } = dir;
  for (let i = 0; i < turns; i++) [dx, dy] = [-dy, dx];
  return { dx, dy };
}

function run(THREE) {
  const app = createApp(THREE), n = app.invoke('GRID_SIZE');
  let reversibleSteps = 0;
  // Exhaust every grid edge in both lifts, including ambiguous corner neighbours.
  for (const side of [1, -1]) for (let gx = 0; gx < n; gx++) for (let gy = 0; gy < n; gy++) {
    for (const dir of directions) {
      const p = { gx, gy, side }, q = step(app, p, dir);
      const crossed = gx + dir.dx < 0 || gx + dir.dx >= n || gy + dir.dy < 0 || gy + dir.dy >= n;
      assert.equal(q.side, crossed ? -side : side, 'Only reflected seams exchange local-side labels');
      const back = step(app, q, { dx: -q.dir.dx, dy: -q.dir.dy });
      assert.deepEqual([back.gx, back.gy, back.side], [gx, gy, side], 'Inverse step restores the same lift');
      reversibleSteps++;
    }
  }
  for (const side of [1, -1]) for (const [gx, gy, expected] of [
    [-1, 6, [n - 1, n - 7, 2, -3]], [n, 6, [0, n - 7, 2, -3]],
    [6, -1, [n - 7, n - 1, -2, 3]], [6, n, [n - 7, 0, -2, 3]],
  ]) {
    const q = app.normalize(gx, gy, { dx: 2, dy: 3 }, side);
    assert.deepEqual([q.gx, q.gy, q.dir.dx, q.dir.dy], expected, 'Transition reflects the tangential coordinate and direction');
    assert.equal(q.mirror, -1); assert.equal(q.side, -side);
  }
  assert.equal(app.invoke('sameSurfaceSide(1,-1)'), false, 'Physical local sides remain distinct');
  assert.equal(app.invoke('sameSnakeCell({gx:4,gy:7,side:1},4,7,-1,null)'), false);
  assert.equal(app.invoke('sameSnakeCell({gx:4,gy:7,side:1},4,8,-1,null)'), false);
  assert.deepEqual(app.read("reduceProjectiveWord(['a','a'])"), []);
  assert.deepEqual(app.read("reduceProjectiveWord(['A','a','A'])"), ['a']);

  // A texture label changes at a reflected seam, but the physical back does not.
  // Check the actual cross-cap differential away from its pinch singularities.
  const surfacePoint = app.invoke('projectivePointUV'), epsilon = 1e-6, h = 1e-7;
  function normal(u, v) {
    const du = surfacePoint(u + h, v).sub(surfacePoint(u - h, v));
    const dv = surfacePoint(u, v + h).sub(surfacePoint(u, v - h));
    return du.cross(dv).normalize();
  }
  let continuousNormals = 0;
  for (const t of [.12, .29, .67, .86]) for (const [a, b] of [
    [[epsilon, t], [1 - epsilon, 1 - t]], [[t, epsilon], [1 - t, 1 - epsilon]],
  ]) {
    const before = normal(...a), after = normal(...b).negate();
    assert.ok(before.dot(after) > .999, 'The transported back normal is continuous across the gluing');
    continuousNormals++;
  }

  // Independent lift oracle: choose the nearest antipodal representative on S².
  // It never reads a seam flag, transition side, or the cut-word implementation.
  function sphere(p) {
    const a = 2 * (p.gx + .5) / n - 1, b = 2 * (p.gy + .5) / n - 1;
    const x = a * Math.sqrt(1 - b * b / 2), y = b * Math.sqrt(1 - a * a / 2);
    const r = Math.hypot(x, y), scale = r ? Math.sin(r * Math.PI / 2) / r : Math.PI / 2;
    return new THREE.Vector3(x * scale, y * scale, Math.cos(r * Math.PI / 2));
  }
  let p = { gx: 0, gy: 9, side: 1, topo: { word: [] } }, lift = sphere(p), walkSeed = 197;
  for (let i = 0; i < 4096; i++) {
    walkSeed = (Math.imul(walkSeed, 1664525) + 1013904223) >>> 0;
    const q = step(app, p, directions[walkSeed >>> 30]);
    const canonical = sphere(q), sign = lift.dot(canonical) >= 0 ? 1 : -1;
    lift = canonical.multiplyScalar(sign);
    assert.equal(q.side, sign, 'Transport agrees with the continuous spherical lift');
    assert.equal(q.topo.word.length, sign === 1 ? 0 : 1, 'RP² parity agrees with the independent lift');
    p = q;
  }

  const portalAt = p => ({ id: 1, gx: p.gx, gy: p.gy, age: 0, heldActive: false });
  const fillers = [3, 6, 9].map(gx => ({ gx, gy: 17, side: 1, type: 'grow', age: 0 }));
  const R = directions[0], L = directions[1], D = directions[2], U = directions[3];
  const baseMoves = [U, ...Array.from({ length: n - 1 }, () => R)];
  let generatorClosures = 0;
  for (const side of [1, -1]) for (let rotation = 0; rotation < 4; rotation++) {
    const start = rotate({ gx: 0, gy: n / 2, side }, rotation, n);
    const moves = baseMoves.map(dir => rotateDir(dir, rotation)), closing = rotateDir(R, rotation);
    const points = pathFrom(app, start, moves), end = step(app, points.at(-1), closing);
    assert.deepEqual([end.gx, end.gy, end.side], [start.gx, start.gy, -side]);
    assert.equal(end.topo.word.join(''), 'a');

    // Without a portal, one generator returns to the other local side: no contact.
    setGame(app, points, closing, fillers);
    app.invoke('updatePi1Panel()');
    assert.equal(app.elements.get('pi1Close').textContent, 'next step not closed');
    app.invoke('gameTick()');
    assert.equal(app.invoke('running'), true);
    assert.equal(app.invoke('snake.length'), points.length);

    // A portal at the destination makes the same nontrivial projected loop close.
    setGame(app, points, closing, fillers, [portalAt(start)]);
    predictAndTick(app, true);
    assert.equal(app.invoke('snake[0].side'), side);
    assert.equal(app.invoke('snake.length'), points.length);
    assert.equal(app.invoke('chartMirror'), 1, 'Seam and portal reflections cancel');
    generatorClosures++;

    // Play a complete route with the portal earlier in the body, not at closure.
    const entrance = step(app, start, moves[0]);
    setGame(app, pathFrom(app, start, []), moves[0], fillers, [portalAt(entrance)]);
    for (const move of moves) {
      app.invoke(`direction=${JSON.stringify(move)}; nextDir={...direction};
        { const next=nextSnakeStep(snake[0],nextDir);
          foods=[{gx:next.gx,gy:next.gy,side:next.side,face:null,type:'grow',age:0},...${JSON.stringify(fillers)}]; }
        gameTick();`);
      assert.equal(app.invoke('running'), true);
    }
    assert.equal(app.invoke('snake.length'), moves.length + 1, 'Each live move grows the route');
    app.invoke(`direction=${JSON.stringify(closing)}; nextDir={...direction};`);
    predictAndTick(app, true);
    assert.deepEqual(app.read('snake[0].topo.word'), ['a']);
    generatorClosures++;
  }

  const intoBody = pathFrom(app, { gx: 2, gy: n / 2, side: 1 }, [L, L, ...baseMoves]);
  setGame(app, intoBody, R, fillers, [portalAt(intoBody[2])]);
  predictAndTick(app, true);
  assert.equal(app.invoke('snake.length'), intoBody.length - 2, 'Nontrivial body contact removes the old tail');

  const square = pathFrom(app, { gx: 5, gy: 7, side: 1 }, [R, R, R, D, L]);
  setGame(app, square, U, fillers, [portalAt(square[2])]);
  predictAndTick(app, false);
  assert.equal(app.invoke('snake.length'), 4);
  assert.equal(app.invoke('snake[0].portalId'), undefined, 'Entry-side body contact precedes teleporting');
  const twice = pathFrom(app, { gx: 1, gy: 5, side: -1 }, [L, L, D, D, R, R, D]);
  setGame(app, twice, D, fillers);
  predictAndTick(app, false);

  // Two side switches on an ordinary square cannot manufacture a generator.
  setGame(app, pathFrom(app, { gx: 5, gy: 5, side: 1 }, []), R, fillers,
    [portalAt({ gx: 6, gy: 5 }), { ...portalAt({ gx: 6, gy: 6 }), id: 2 }]);
  for (const move of [R, D, L]) {
    app.invoke(`nextDir=${JSON.stringify(move)};
      { const next=nextSnakeStep(snake[0],nextDir);
        foods=[{...next,type:'grow',age:0},...${JSON.stringify(fillers)}]; } gameTick();`);
  }
  app.invoke('nextDir={dx:0,dy:-1}');
  predictAndTick(app, false);

  let foodCases = 0;
  for (const side of [1, -1]) for (const seam of [false, true]) for (const usePortal of [false, true]) {
    const points = pathFrom(app, { gx: seam ? n - 3 : 6, gy: 9, side }, [R, R]);
    const next = step(app, points.at(-1), R), destinationSide = usePortal ? -next.side : next.side;
    const portal = usePortal ? [portalAt(next)] : [];
    for (const foodSide of [destinationSide, -destinationSide]) {
      setGame(app, points, R, [{ gx: next.gx, gy: next.gy, side: foodSide, type: 'grow', age: 0 }, ...fillers], portal);
      app.invoke('gameTick()');
      const eaten = foodSide === destinationSide;
      assert.equal(app.invoke('score'), eaten ? 1 : 0, 'Only food on the exit side can be consumed');
      assert.equal(app.invoke('snake.length'), points.length + (eaten ? 1 : 0));
      assert.equal(app.invoke('snake[0].side'), destinationSide);
      assert.deepEqual(app.read('snake[0].topo.word'), JSON.parse(JSON.stringify(next.topo.word)));
      foodCases++;
    }
  }

  // The head switches first; retained body segments keep their own local sides.
  const straight = pathFrom(app, { gx: 5, gy: 9, side: 1 }, [R, R]);
  setGame(app, straight, R, fillers, [portalAt({ gx: 8, gy: 9 })]);
  app.invoke('gameTick()');
  assert.deepEqual(app.read('snake.map(s=>s.side)'), [-1, 1, 1]);
  assert.equal(app.invoke('chartMirror'), -1);
  for (const dir of directions) {
    const restored = app.read(`chartToSurfaceDirection(surfaceToChartVector(${JSON.stringify(dir)}))`);
    assert.equal(restored.dx, dir.dx); assert.equal(restored.dy, dir.dy);
  }
  app.invoke('queueChartDirection({dx:0,dy:-1}); gameTick()');
  assert.deepEqual(app.read('snake.slice(0,2).map(s=>s.side)'), [-1, -1]);
  assert.deepEqual(app.read('surfaceToChartVector(direction)'), { dx: 0, dy: -1 }, 'Chart input still points up after teleporting');
  app.invoke('gameTick()');
  assert.deepEqual(app.read('snake.map(s=>s.side)'), [-1, -1, -1]);

  // Drawing uses separate local-side textures; only the portal has two entrances.
  setGame(app, pathFrom(app, { gx: n - 3, gy: 9, side: 1 }, [R, R, R]), R,
    [{ gx: 1, gy: 10, side: -1, type: 'grow', age: 0 },
      { gx: 1, gy: 10, side: 1, type: 'slow', age: 0 }],
    [portalAt({ gx: 2, gy: 10 })]);
  assert.deepEqual(app.read('[markMaterialFront.side,markMaterialBack.side]'), [THREE.FrontSide, THREE.BackSide]);
  for (const ctx of Object.values(app.contexts)) ctx.calls.length = 0;
  app.invoke('topologyHintsVisible=false; redrawTexture(); drawMiniMap()');
  const rectangles = ctx => ctx.calls.filter(c => c.op === 'fillRect');
  const eyes = ctx => ctx.calls.filter((c, i, all) => c.op === 'arc' && c.fillStyle === '#061018' && all[i + 1]?.op === 'fill');
  const rings = ctx => ctx.calls.filter(c => c.op === 'arc' && c.strokeStyle === '#67eeff');
  assert.equal(rectangles(app.contexts.front).length, 4, 'Three body segments and one front-side food');
  assert.equal(rectangles(app.contexts.back).length, 2, 'One head and one back-side food');
  assert.equal(eyes(app.contexts.front).length, 0);
  assert.equal(eyes(app.contexts.back).length, 2);
  assert.equal(rectangles(app.contexts.chart).filter(c => c.fillStyle === '#f39c12').length, 1);
  assert.equal(rectangles(app.contexts.chart).filter(c => c.fillStyle === '#3498db').length, 0);
  assert.equal(rectangles(app.contexts.chart).filter(c => String(c.fillStyle).startsWith('rgba(255,140,66,')).length, 3,
    'Chart transports all adjacent body segments across the seam');
  for (const ctx of Object.values(app.contexts)) assert.equal(rings(ctx).length, 1);

  const timer = createApp(THREE);
  assert.equal(timer.invoke('portals.length'), 1);
  assert.equal(timer.invoke('PROJECTIVE_PORTALS.lifetime'), 60);
  const random = timer.sandbox.Math.random;
  timer.sandbox.Math.random = () => .9; // No probabilistic spawns during lifetime checks.
  timer.setTime(20000); timer.invoke('updateProjectivePortals(); togglePause()');
  assert.equal(timer.invoke('portals[0].age'), 20);
  timer.setTime(120000); timer.invoke('updateProjectivePortals(); togglePause()');
  assert.equal(timer.invoke('portals[0].age'), 20, 'Paused seconds are not charged');
  timer.setTime(159999); timer.invoke('speed=40; updateProjectivePortals()');
  assert.equal(timer.invoke('portals.length'), 1);
  timer.setTime(160000); timer.invoke('updateProjectivePortals()');
  assert.equal(timer.invoke('portals.length'), 0, 'Expires after exactly 60 active seconds');

  // Expiry waits for the tagged entrance segment to leave the actual tail.
  setGame(timer, pathFrom(timer, { gx: 5, gy: 9, side: 1 }, [R, R]), R, fillers,
    [{ ...portalAt({ gx: 8, gy: 9 }), age: 59.9 }]);
  timer.invoke('gameTick()');
  timer.setTime(160200); timer.invoke('updateProjectivePortals()');
  assert.equal(timer.invoke('portals[0].heldActive'), true);
  timer.invoke('gameTick(); gameTick()');
  assert.equal(timer.invoke('portals.length'), 1);
  timer.invoke('gameTick()');
  assert.equal(timer.invoke('portals.length'), 0, 'Disappears when the tail clears the expired portal');
  timer.invoke('init()');
  assert.equal(timer.invoke('portals.length'), 1);
  assert.equal(timer.invoke('portals[0].age'), 0);

  // Deterministic probability threshold, interval, cap, and unobstructed placement.
  timer.invoke('portals=[]; portalSpawnElapsed=0; portalLastUpdate=performance.now()');
  timer.sandbox.Math.random = () => .4;
  timer.setTime(165200); timer.invoke('updateProjectivePortals()');
  assert.equal(timer.invoke('portals.length'), 0, 'The upper 60 percent do not spawn');
  let rolls = [.399, .05, .05];
  timer.sandbox.Math.random = () => rolls.length ? rolls.shift() : .9;
  timer.setTime(170199); timer.invoke('updateProjectivePortals()');
  assert.equal(timer.invoke('portals.length'), 0, 'Cannot spawn before the next five-second interval');
  timer.setTime(170200); timer.invoke('updateProjectivePortals()');
  assert.equal(timer.invoke('portals.length'), 1, 'A roll below 40 percent spawns');
  rolls = [.399, .1, .1];
  timer.setTime(175200); timer.invoke('updateProjectivePortals()');
  assert.equal(timer.invoke('portals.length'), 2);
  rolls = [.399, .2, .2];
  timer.setTime(180200); timer.invoke('updateProjectivePortals(); trySpawnPortal()');
  assert.equal(timer.invoke('portals.length'), 2, 'At most two portals, including held ones');
  assert.equal(rolls.length, 3, 'Does not roll for a spawn when already full');
  timer.sandbox.Math.random = () => 0;
  timer.invoke('portals=[]; snake=[{gx:0,gy:0,side:-1}]; foods=[]; trySpawnPortal()');
  assert.equal(timer.invoke('portals.length'), 0, 'Cannot spawn under either side of the snake');
  timer.invoke("snake=[]; foods=[{gx:0,gy:0,side:-1,type:'grow',age:0}]; trySpawnPortal()");
  assert.equal(timer.invoke('portals.length'), 0, 'Cannot spawn under either side of food');
  timer.invoke("foods=[]; portals=[{id:1,gx:0,gy:0,age:0}]; trySpawnFood()");
  assert.equal(timer.invoke('foods.length'), 0, 'Food cannot hide a portal');
  timer.sandbox.Math.random = random;
  timer.invoke('init(); running=false');
  timer.setTime(300200); timer.invoke('updateProjectivePortals()');
  assert.equal(timer.invoke('portals[0].age'), 0, 'The clock also stops after winning or losing');

  const smokeMaps = ['torus', 'sphere', 'mobius', 'klein', 'genus2'];
  for (const map of smokeMaps) {
    const other = createApp(THREE, map);
    assert.equal(other.invoke('sameSnakeCell({gx:4,gy:7,side:1},4,7,-1,null)'), false, map + ': side policy unchanged');
    other.setTime(5000);
    other.invoke('gameTick(); redrawTexture(); drawMiniMap(); updateProjectivePortals()');
    assert.equal(other.invoke('running'), true, map + ': initial movement works');
    assert.equal(other.invoke('portals.length'), 0, map + ': no experimental portals');
    assert.equal(other.elements.get('portalLegend').style.display, 'none');
  }
  return { reversibleSteps, continuousNormals, independentLiftSteps: 4096, generatorClosures,
    trivialClosures: 3, foodCases, localSideRendering: true, portalClock: '60 active seconds', smokeMaps };
}

module.exports = { createApp, run };
if (require.main === module) (async () => {
  let THREE;
  if (process.argv[2]) THREE = await import(pathToFileURL(path.resolve(process.argv[2])).href);
  else {
    const response = await fetch('https://cdn.jsdelivr.net/npm/three@0.174.0/build/three.core.js');
    if (!response.ok) throw new Error('Could not load the game\'s pinned Three.js version');
    THREE = await import('data:text/javascript;base64,' + Buffer.from(await response.text()).toString('base64'));
  }
  console.log(run(THREE));
})().catch(error => { console.error(error); process.exitCode = 1; });
