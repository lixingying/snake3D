// Run with Node 18+: node tests/continuous-motion.cjs
// Uses the same pinned Three.js version as the browser; no build step required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { URLSearchParams } = require('node:url');
const root = path.join(__dirname, '..');

function createApp(THREE, map = 'torus') {
  const elements = new Map(), listeners = new Map();
  const seededMath = Object.create(Math);
  let seed = 0x51a7;
  seededMath.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const gradient = () => ({ addColorStop() {} });
  function element(id) {
    const events = new Map(), pointers = new Set();
    const context = new Proxy({ createRadialGradient: gradient, createLinearGradient: gradient }, {
      get: (object, key) => key in object ? object[key] : () => {},
    });
    return { id, width: 252, height: 252, clientWidth: 1000, clientHeight: 750,
      style: {}, textContent: '', events, appendChild() {}, getContext: () => context,
      addEventListener(type, callback) { events.set(type, callback); },
      setPointerCapture(id) { pointers.add(id); }, hasPointerCapture(id) { return pointers.has(id); },
      releasePointerCapture(id) { pointers.delete(id); },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 252, height: 252 }),
    };
  }
  const document = { documentElement: {}, hidden: false, createElement: element,
    getElementById(id) { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); },
    addEventListener(type, callback) { listeners.set('document:' + type, callback); },
  };
  const window = { devicePixelRatio: 1, matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener(type, callback) { listeners.set('window:' + type, callback); } };
  class Renderer {
    constructor() { this.domElement = element('renderer'); this.shadowMap = {}; }
    setSize() {} setPixelRatio() {} render() {}
  }
  const sandbox = vm.createContext({ THREE: { ...THREE, WebGLRenderer: Renderer }, document, window,
    navigator: { languages: ['en'] }, location: { search: '?map=' + map + '&debug=1' }, URLSearchParams,
    localStorage: { getItem() { return null; }, setItem() {} }, console, Math: seededMath,
    performance: { now: () => 0 }, requestAnimationFrame() {}, setTimeout: () => 0, clearTimeout() {},
  });
  for (const file of ['surface-models.js', 'surface-navigation.js', 'surface-atlas.js', 'chart-view.js', 'continuous-snake.js', 'clay-actors.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
  }
  const html = fs.readFileSync(path.join(root, 'snake3d.html'), 'utf8');
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm, '');
  vm.runInContext(script, sandbox, { filename: 'snake3d.html', timeout: 30000 });
  return { ...window.snakeDebug, elements, listeners, sandbox,
    invoke(code) { return vm.runInContext(code, sandbox); },
    event(type, extra = {}) {
      listeners.get(type)?.({ preventDefault() {}, stopPropagation() {}, repeat: false, ...extra });
    },
  };
}

function finiteState(app) {
  const state = app.game.state();
  assert.ok(state.snake.length > 1);
  for (const item of [...state.snake, ...state.foods]) {
    for (const n of [item.u, item.v, item.du, item.dv]) assert.ok(Number.isFinite(n), 'Finite pose');
    assert.ok(item.u >= -1e-7 && item.u <= 1 + 1e-7 && item.v >= -1e-7 && item.v <= 1 + 1e-7, 'Point stays on chart');
    const f = app.navigation.frame(item);
    assert.ok(f.normal.length() > 0.99 && f.forward.length() > 0.99, 'Valid tangent frame');
  }
}

function run(THREE) {
  const apps = {};
  for (const type of ['torus', 'sphere', 'mobius', 'projective', 'klein', 'genus2']) {
    const app = apps[type] = createApp(THREE, type);
    finiteState(app);
    const selectedStart = { ...app.navigation.seed(.998, .37, app.game.state().head.face), dv: .2 };
    app.game.reset(selectedStart);
    assert.ok(app.navigation.samePoint(app.game.state().head, selectedStart), 'Reset keeps the selected head position at curved seams');
    app.game.setTurn(0.35);
    for (let i = 0; i < 120; i++) app.game.update(1 / 60);
    finiteState(app);
    app.invoke('syncContinuousState(); clayActors.update(2000); drawMiniMap(); toggleTopologyHints(); updatePi1Panel();');
    let p = selectedStart;
    for (let i = 0; i < 120; i++) {
      const step = app.navigation.move(p, .01, .008 * Math.sin(i / 30));
      const length = step.segments.reduce((sum, segment) => sum + segment.length, 0);
      assert.ok(Math.abs(length - .01) < .00005, type + ': stable arc speed through a seam');
      p = step.point;
    }
  }

  const torus = apps.torus, nav = torus.navigation;
  const start = nav.seed(0.21, 0.37);
  const moved = nav.move(start, 0.031, 0.23).point;
  assert.notEqual(moved.u, start.u); assert.notEqual(moved.v, start.v);
  assert.ok(Math.abs(moved.u * 20 - Math.round(moved.u * 20)) > 1e-3, 'No cell snapping');

  // A closed generator and a contractible loop must remain distinguishable.
  const around = nav.trace(start, 1, 0).point;
  assert.equal(around.topo.wx - start.topo.wx, 1);
  assert.ok(Math.abs(around.u - start.u) < 1e-7);
  let little = start;
  for (const [u, v] of [[0.08, 0], [0, 0.08], [-0.08, 0], [0, -0.08]]) little = nav.trace(little, u, v).point;
  assert.equal(little.topo.wx, 0); assert.equal(little.topo.wy, 0);
  const back = nav.trace(around, -1, 0).point;
  assert.equal(back.topo.wx, 0);

  // The closing connector may itself cross a cut. Omitting it fabricates a win.
  const cut = torus.invoke('TORUS_CUT_X / CUT_GRID_SIZE');
  const body = nav.seed(cut - 0.001, 0.31);
  const head = nav.trace(body, 0.002, 0).point;
  assert.equal(head.topo.wx, 1);
  assert.equal(nav.closeAt(head, body).topo.wx, 0);

  // Swept contacts catch a fruit between endpoints, including across a seam.
  const a = nav.seed(0.20, 0.3), b = nav.seed(0.24, 0.3), food = nav.seed(0.22, 0.3);
  assert.ok(nav.contact(a, b, food, food, 0.03));
  const seamHead = nav.seed(0.998, 0.3), seamFood = nav.seed(0.002, 0.3);
  assert.ok(nav.contact(seamHead, seamHead, seamFood, seamFood, 0.05));
  const otherSide = { ...seamFood, side: -1 };
  assert.equal(nav.contact(seamHead, seamHead, otherSide, otherSide, 0.05), null);

  // Crossing obliquely between sphere charts must not reset the heading to
  // an edge normal or turn it merely because the coordinate chart changed.
  const sphere = apps.sphere;
  const slant = { ...sphere.navigation.seed(0.9999, 0.37, 'F'), du: 1, dv: 0.4 };
  const before = sphere.navigation.frame(slant).forward;
  const after = sphere.navigation.move(slant, 0.004).point;
  assert.notEqual(after.face, slant.face);
  assert.ok(before.dot(sphere.navigation.frame(after).forward) > 0.999, 'Heading continues across a sphere seam');

  // The two lifts of an RP² generator exchange local sides after one turn.
  const rp = apps.projective.navigation;
  const rpStart = rp.seed(0.21, 0.5);
  const rpOnce = rp.trace(rpStart, 1, 0).point;
  assert.equal(rpOnce.topo.word.join(''), 'a');
  assert.equal(rpOnce.side, -rpStart.side);
  assert.ok(rp.samePoint(rpOnce, rp.oppositeSide(rpStart)));
  assert.equal(rp.samePoint(rpOnce, rpStart), false);
  assert.equal(rp.trace(rpOnce, 1, 0).point.topo.word.length, 0);

  // Exercise actual self-contact, rather than only the group helper.
  const loopApp = createApp(THREE);
  const loopGame = loopApp.invoke("createContinuousSnake({ navigation, classifyLoop: topologyDifferenceInfo, randomPoint: () => navigation.seed(0.8, 0.8), initialLength: 3.10 })");
  const meridian = { ...loopApp.navigation.seed(0.21, 0.23), du: 0, dv: 1 };
  loopGame.reset(meridian);
  for (let i = 0; i < 30 && loopGame.state().running; i++) loopGame.update(1 / 60);
  assert.equal(loopGame.state().running, false, 'A meridian contact wins on the torus');
  assert.equal(loopGame.state().lastClosure.nontrivial, true);

  const littleGame = loopApp.invoke("createContinuousSnake({ navigation, classifyLoop: topologyDifferenceInfo, randomPoint: () => navigation.seed(0.8, 0.8), turnRate: 5 })");
  littleGame.reset(loopApp.navigation.seed(0.12, 0.23));
  littleGame.setTurn(1);
  for (let i = 0; i < 240 && !littleGame.state().lastClosure; i++) littleGame.update(1 / 60);
  assert.ok(littleGame.state().lastClosure, 'A tightly steered circle touches its trail');
  assert.equal(littleGame.state().lastClosure.nontrivial, false, 'A contractible circle does not win');
  assert.equal(littleGame.state().running, true);

  // Fixed-step integration has the same result at 30, 60 and 144 render FPS.
  const samples = [];
  for (const fps of [30, 60, 144]) {
    const app = createApp(THREE);
    app.game.setTurn(0.45);
    for (let i = 0; i < fps; i++) app.game.update(1 / fps);
    const p = app.game.state().head; samples.push([p.u, p.v, p.du, p.dv]);
  }
  for (const p of samples.slice(1)) for (let i = 0; i < p.length; i++) assert.ok(Math.abs(p[i] - samples[0][i]) < 1e-10);

  const controls = createApp(THREE);
  controls.event('document:keydown', { key: 'ArrowRight' });
  controls.game.update(0.1);
  const turning = controls.game.state().head;
  assert.ok(Math.abs(turning.dv) > 0.01, 'Holding right rotates continuously');
  controls.event('window:blur');
  const paused = JSON.stringify(controls.game.state().head);
  controls.game.update(0.1);
  assert.equal(JSON.stringify(controls.game.state().head), paused, 'Losing focus pauses and releases steering');
  controls.event('document:keydown', { key: ' ' });
  assert.equal(controls.game.state().paused, false);
  controls.event('document:keydown', { key: ' ', repeat: true });
  assert.equal(controls.game.state().paused, false, 'Key repeat does not toggle pause');

  const touch = controls.elements.get('mapCanvas');
  touch.events.get('pointerdown')({ pointerId: 7, clientX: 25, preventDefault() {}, stopPropagation() {} });
  assert.equal(controls.invoke('steeringPointers.get(7)'), -1);
  touch.events.get('pointermove')({ pointerId: 7, clientX: 230, preventDefault() {}, stopPropagation() {} });
  assert.equal(controls.invoke('steeringPointers.get(7)'), 1);
  touch.events.get('pointercancel')({ pointerId: 7 });
  assert.equal(controls.invoke('steeringPointers.size'), 0, 'Cancelled touch cannot leave steering held');

  return { maps: Object.keys(apps), continuousSteering: true, frameRates: [30, 60, 144],
    homotopyLoops: 5, liveClosures: 2, obliqueSeamHeading: true,
    contactConnector: true, sweptContacts: true, pauseAndRelease: true };
}

module.exports = { createApp, run };
if (require.main === module) (async () => {
  const response = await fetch('https://cdn.jsdelivr.net/npm/three@0.174.0/build/three.core.js');
  if (!response.ok) throw new Error('Could not load the game\'s pinned Three.js version');
  const THREE = await import('data:text/javascript;base64,' + Buffer.from(await response.text()).toString('base64'));
  console.log(run(THREE));
})().catch(error => { console.error(error); process.exitCode = 1; });
