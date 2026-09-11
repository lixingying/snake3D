// Run: node tests/projective-companion.cjs
// Paired RP² snakes, including live contacts and an independent S² lift check.
const assert = require('node:assert/strict');
const { createApp } = require('./continuous-motion.cjs');

function classification(app, from, to) {
  app.sandbox.loopFrom = from; app.sandbox.loopTo = to;
  return app.invoke('topologyDifferenceInfo(loopFrom.topo, loopTo.topo, {from: loopFrom, to: loopTo})');
}

function lift(app, p) {
  app.sandbox.liftPoint = p;
  return app.invoke('atlasSpherePoint(liftPoint).multiplyScalar(liftPoint.side)');
}

function paired(nav, state) {
  assert.ok(state.snake.length > 1);
  assert.equal(state.companionSnake.length, state.snake.length);
  state.snake.forEach((p, i) => {
    const q = state.companionSnake[i];
    assert.equal(p.u, q.u); assert.equal(p.v, q.v); assert.equal(p.s, q.s);
    assert.equal(p.side, -q.side);
    const a = nav.frame(p), b = nav.frame(q);
    assert.ok(a.position.distanceTo(b.position) < 1e-12, 'Same abstract trail');
    assert.ok(a.normal.dot(b.normal) < -0.999999, 'Opposite local sides');
    assert.ok(a.forward.dot(b.forward) > 0.999999, 'Identical motion');
  });
}

// Prepare a valid travelled path and let the real next movement step detect
// its contact. The fixture does not call or substitute the collision solver.
function trailFixture(nav, start, deltas) {
  let p = start, s = 0;
  const nodes = [{ ...nav.copy(p), s, position: nav.pointAt(p) }];
  for (const [du, dv] of deltas) {
    const count = Math.ceil(Math.hypot(du, dv) / 0.004);
    p = { ...p, du, dv };
    for (let i = 0; i < count; i++) {
      const result = nav.trace(p, du / count, dv / count);
      for (const segment of result.segments) {
        s += segment.length;
        nodes.push({ ...nav.copy(segment.to), s, position: nav.pointAt(segment.to) });
      }
      p = result.point;
    }
  }
  return nodes;
}

function gameWithTrail(app, nodes, pairedSides = true) {
  const events = [];
  app.sandbox.companionOptions = { initialLength: nodes.at(-1).s, pairedSides, onEvent: event => events.push(event) };
  const game = app.invoke(`createContinuousSnake({ navigation, classifyLoop: topologyDifferenceInfo,
    randomPoint: () => navigation.seed(.85, .8), ...companionOptions })`);
  game.reset(nodes[0]);
  const state = game.state();
  Object.assign(state.head, nodes.at(-1));
  state.trail.splice(0, state.trail.length, ...nodes.slice(0, -1), state.head);
  events.length = 0;
  return { game, events };
}

function run(THREE) {
  const app = createApp(THREE, 'projective'), nav = app.navigation;
  paired(nav, app.game.state());

  for (const edge of ['L', 'R', 'U', 'D']) for (const side of [1, -1]) {
    const p = nav.seed(edge === 'L' ? 0 : edge === 'R' ? 1 : .37,
      edge === 'U' ? 0 : edge === 'D' ? 1 : .37, null, side);
    const q = nav.glue(p, edge);
    assert.ok(nav.frame(p).normal.dot(nav.frame(q).normal) > .9999, 'Each snake stays on its physical side at a seam');
    assert.ok(lift(app, p).dot(lift(app, q)) > .999999, 'The spherical lift is continuous through gluing');
    const chart = app.atlas.createChart(p);
    assert.ok(chart.project(q), 'The chart includes the same side across a seam');
    assert.equal(chart.project(nav.oppositeSide(q)), null, 'The back of the chart is a different local side');
  }

  for (const side of [1, -1]) {
    const start = nav.seed(.3, .5, null, side);
    const once = nav.trace(start, 1, 0).point, twice = nav.trace(once, 1, 0).point;
    assert.ok(lift(app, start).dot(lift(app, once)) < -.999999);
    assert.ok(lift(app, start).dot(lift(app, twice)) > .999999);
    assert.equal(classification(app, start, once).nontrivial, true);
    assert.equal(classification(app, start, twice).nontrivial, false, 'Two turns still satisfy a² = 1');

    const nodes = trailFixture(nav, start, [[.992, 0]]);
    const { game, events } = gameWithTrail(app, nodes);
    game.update(1 / 120);
    assert.equal(game.state().running, false, 'Either choice of primary snake can win');
    assert.equal(game.state().lastClosure.nontrivial, true);
    assert.equal(game.state().lastClosure.companion, true, 'The nontrivial loop joins the companion');
    assert.equal(game.state().lastClosure.reducedLabel, 'a');
    assert.equal(events.filter(e => e.type === 'win').length, 1, 'One shared win event');
    paired(nav, game.state());
    app.chartView.reset(); app.chartView.update(game.state());
    const view = app.chartView.snapshot;
    assert.ok(view.companionBody.at(-1), 'The approaching companion tail appears in the local chart');
    assert.equal(view.body.at(-1), null, 'The primary tail is on the opposite local side');

    const single = gameWithTrail(app, nodes, false).game;
    single.update(1 / 120);
    assert.equal(single.state().lastClosure, null, 'A single snake cannot close this one-sided loop');
  }

  const small = trailFixture(nav, nav.seed(.27, .45), [[.03, 0], [.10, 0], [0, .10], [-.10, 0], [0, -.095]]);
  const { game: cutGame, events: cutEvents } = gameWithTrail(app, small);
  cutGame.update(1 / 120);
  assert.equal(cutGame.state().lastClosure.nontrivial, false, 'A local circle stays contractible');
  assert.equal(cutGame.state().running, true);
  assert.ok(cutGame.state().length < small.at(-1).s - .03, 'The old tail is cut off');
  assert.equal(cutEvents.filter(e => e.type === 'cut').length, 1, 'One shared cut event');
  paired(nav, cutGame.state());

  // Equatorial half-turns are closed generators of RP². Check the lift of
  // EVERY path segment, including the square corners, without using cut words.
  for (const offset of [.17, .81, 1.31]) {
    const boundary = angle => {
      app.sandbox.boundarySphere = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
      return { ...nav.seed(0, 0), ...app.invoke('atlasPointFromSphere(boundarySphere)') };
    };
    const start = boundary(offset);
    let p = start, previous = lift(app, start);
    for (let i = 1; i <= 240; i++) {
      const next = boundary(offset + Math.PI * i / 240);
      const image = nav.images(next, p).sort((a, b) =>
        Math.hypot(a.u - p.u, a.v - p.v) - Math.hypot(b.u - p.u, b.v - p.v))[0];
      const step = nav.trace(p, image.u - p.u, image.v - p.v);
      for (const segment of step.segments) {
        const current = lift(app, segment.to);
        assert.ok(previous.dot(current) > .999, 'Continuous short steps in the spherical cover');
        assert.ok(Math.abs(current.z) < .0001, 'The entire path stays on the equator');
        previous = current;
      }
      p = step.point;
    }
    const end = nav.closeAt(p, nav.oppositeSide(start));
    assert.ok(end && nav.samePoint(end, nav.oppositeSide(start)), 'The boundary loop reaches the companion');
    assert.ok(lift(app, start).dot(lift(app, end)) < -.999999, 'An antipodal endpoint independently proves nontriviality');
    assert.equal(classification(app, start, end).nontrivial, true, 'Closing at different boundary representatives counts the final identification');
  }

  const seamStart = nav.seed(.999, .37), seamEnd = nav.trace(seamStart, .002, 0).point;
  const returned = nav.closeAt(seamEnd, seamStart);
  assert.ok(returned && nav.samePoint(returned, seamStart, .001));
  assert.equal(classification(app, seamStart, returned).nontrivial, false, 'A short crossing and return cannot fabricate a win');

  app.game.reset(nav.seed(.7, .6));
  for (const type of ['grow', 'shrink']) {
    const before = app.game.state();
    const food = { ...nav.oppositeSide(before.head), position: nav.pointAt(before.head), type, age: 0 };
    assert.equal(nav.contact(before.head, before.head, food, food, .08), null, 'Only the companion can eat this fruit');
    before.foods.splice(0, 1, food);
    app.game.update(1 / 120);
    const after = app.game.state();
    assert.equal(after.foods.includes(food), false);
    assert.equal(after.score, before.score + (type === 'grow' ? 1 : 0), 'Food is counted once');
    assert.ok(Math.abs(after.length - before.length - (type === 'grow' ? .38 : -.45)) < 1e-9);
    paired(nav, after);
  }
  app.game.setTurn(.4);
  for (let i = 0; i < 60; i++) app.game.update(1 / 60);
  paired(nav, app.game.state());
  app.clayActors.update(2000); app.companionActors.update(2000);
  const front = app.clayActors.group.getObjectByName('snake-head');
  const back = app.companionActors.group.getObjectByName('snake-head');
  const centre = nav.pointAt(app.game.state().head);
  assert.ok(front.position.clone().add(back.position).multiplyScalar(.5).distanceTo(centre) < 1e-9, 'Both 3D heads straddle the same surface point');
  assert.ok(front.position.distanceTo(back.position) > .09, 'The heads are visibly separated by the surface');
  const normal = nav.frame(app.game.state().head).normal;
  const faceParts = [], mirroredParts = [];
  front.updateWorldMatrix(true, true); back.updateWorldMatrix(true, true);
  front.traverse(object => faceParts.push(object));
  back.traverse(object => mirroredParts.push(object));
  faceParts.forEach((object, i) => {
    const p = object.getWorldPosition(new THREE.Vector3());
    const reflected = p.clone().addScaledVector(normal, -2 * p.clone().sub(centre).dot(normal));
    const q = mirroredParts[i].getWorldPosition(new THREE.Vector3());
    assert.ok(reflected.distanceTo(q) < 1e-9, 'Eyes and asymmetric highlights reflect across the local tangent plane');
  });
  for (const actors of [app.clayActors, app.companionActors]) actors.group.traverse(object => {
    assert.ok([...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray()].every(Number.isFinite));
    if (object.instanceMatrix) assert.ok([...object.instanceMatrix.array].every(Number.isFinite));
  });
  app.game.setPaused(true);
  const stopped = JSON.stringify(app.game.state());
  app.game.update(.1);
  assert.equal(JSON.stringify(app.game.state()), stopped, 'Pausing stops both snakes');
  app.game.reset(nav.seed(.7, .6));
  paired(nav, app.game.state());
  assert.equal(app.game.state().lastClosure, null);

  const torus = createApp(THREE, 'torus');
  assert.equal(torus.game.state().companionSnake.length, 0, 'Other maps keep one snake');
  assert.equal(torus.companionActors, null);
  return { pairedClosures: 2, sharedCut: true, boundaryGenerators: 3, sphericalLift: true,
    sharedFood: true, oppositeRenderPoses: true, chartSides: true, pauseAndReset: true };
}

module.exports = { run };
if (require.main === module) (async () => {
  const response = await fetch('https://cdn.jsdelivr.net/npm/three@0.174.0/build/three.core.js');
  if (!response.ok) throw new Error('Could not load the pinned Three.js version');
  const THREE = await import('data:text/javascript;base64,' + Buffer.from(await response.text()).toString('base64'));
  console.log(run(THREE));
})().catch(error => { console.error(error); process.exitCode = 1; });
