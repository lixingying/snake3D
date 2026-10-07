// Run: node tests/projective-portals.cjs
// RP² passages, live closures and independent checks in the spherical cover.
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

// Prepare a valid travelled path and let the real next movement step detect
// its contact. The fixture does not call or substitute the collision solver.
function trailFixture(nav, start, deltas) {
  let p = start, s = 0;
  const nodes = [{ ...nav.copy(p), s, position: nav.pointAt(p) }];
  for (const delta of deltas) {
    if (delta === 'portal') {
      p = nav.oppositeSide(p);
      nodes.push({ ...nav.copy(p), s, position: nav.pointAt(p) });
      continue;
    }
    const [du, dv] = delta;
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

function makeGame(app, options = {}) {
  const events = [];
  app.sandbox.portalOptions = { portalSettings: { initialCount: 0, chance: 0 },
    onEvent: event => events.push(event), ...options };
  const game = app.invoke(`createContinuousSnake({ navigation, classifyLoop: topologyDifferenceInfo,
    randomPoint: randomSurfacePoint, ...portalOptions })`);
  return { game, events };
}

function gameWithTrail(app, nodes) {
  const { game, events } = makeGame(app, { initialLength: nodes.at(-1).s });
  game.reset(nodes[0]);
  const state = game.state();
  Object.assign(state.head, nodes.at(-1));
  state.trail.splice(0, state.trail.length, ...nodes.slice(0, -1), state.head);
  events.length = 0;
  return { game, events };
}

function putPortal(game, nav, point, properties = {}) {
  const { radius, lifetime } = game.state().portalConfig;
  const portal = { ...nav.copy(point), id: 99, radius, age: 0, lifetime, heldActive: false, ...properties };
  game.state().portals.push(portal);
  return portal;
}

function run(THREE) {
  const app = createApp(THREE, 'projective'), nav = app.navigation;
  assert.equal(app.game.state().portals.length, 1, 'One portal is available immediately');
  assert.equal(app.game.state().companionSnake, undefined, 'Only one snake exists');
  assert.equal(app.companionActors, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(app.game.state().portalConfig)), {
    interval: 5, chance: .4, lifetime: 60, maxCount: 2, radius: .08, initialCount: 1,
  });

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
    const single = gameWithTrail(app, nodes).game;
    single.update(1 / 120);
    assert.equal(single.state().lastClosure, null, 'Without a portal this loop cannot close on the same local side');
    const { game, events } = gameWithTrail(app, nodes);
    putPortal(game, nav, game.state().head);
    game.update(1 / 120);
    assert.equal(game.state().running, false, 'A generator and one passage close on the same side');
    assert.equal(game.state().lastClosure.nontrivial, true);
    assert.equal(game.state().lastClosure.reducedLabel, 'a');
    assert.equal(events.filter(e => e.type === 'portal').length, 1);
    assert.equal(events.filter(e => e.type === 'win').length, 1);
    app.chartView.reset(); app.chartView.update(game.state());
    const view = app.chartView.snapshot;
    assert.ok(view.body.at(-1), 'The original tail is now on the head’s local side');
    assert.equal(view.portals.length, 1, 'A passage is visible from either side');
  }

  const small = trailFixture(nav, nav.seed(.27, .45), [[.03, 0], [.10, 0], [0, .10], [-.10, 0], [0, -.095]]);
  const { game: cutGame, events: cutEvents } = gameWithTrail(app, small);
  cutGame.update(1 / 120);
  assert.equal(cutGame.state().lastClosure.nontrivial, false, 'A local circle stays contractible');
  assert.equal(cutGame.state().running, true);
  assert.ok(cutGame.state().length < small.at(-1).s - .03, 'The old tail is cut off');
  assert.equal(cutEvents.filter(e => e.type === 'cut').length, 1);
  const twiceFlipped = trailFixture(nav, nav.seed(.27, .45), [[.13, 0], 'portal', [0, .10], [-.10, 0], 'portal', [0, -.095]]);
  const trivial = gameWithTrail(app, twiceFlipped).game;
  trivial.update(1 / 120);
  assert.equal(trivial.state().lastClosure.nontrivial, false, 'Two passages in a local circle cannot manufacture nontriviality');

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
    assert.ok(end && nav.samePoint(end, nav.oppositeSide(start)), 'The boundary loop reaches the opposite local side');
    assert.ok(lift(app, start).dot(lift(app, end)) < -.999999, 'An antipodal endpoint independently proves nontriviality');
    assert.equal(classification(app, start, end).nontrivial, true, 'Closing at different boundary representatives counts the final identification');
  }

  const seamStart = nav.seed(.999, .37), seamEnd = nav.trace(seamStart, .002, 0).point;
  const returned = nav.closeAt(seamEnd, seamStart);
  assert.ok(returned && nav.samePoint(returned, seamStart, .001));
  assert.equal(classification(app, seamStart, returned).nontrivial, false, 'A short crossing and return cannot fabricate a win');

  const seamGame = makeGame(app, { initialLength: .2 }).game;
  seamGame.reset(seamStart);
  putPortal(seamGame, nav, seamStart);
  const expected = nav.oppositeSide(nav.move(seamStart, .9 / 120).point);
  seamGame.update(1 / 120);
  assert.ok(nav.samePoint(seamGame.state().head, expected, 1e-6), 'A passage and a glued edge in one step compose correctly');
  assert.deepEqual(seamGame.state().head.topo, expected.topo);

  const reentry = makeGame(app, { initialLength: .1 });
  reentry.game.reset(nav.seed(.5, .5));
  putPortal(reentry.game, nav, nav.move(reentry.game.state().head, .23).point);
  for (let i = 0; i < 62; i++) reentry.game.update(1 / 120);
  assert.equal(reentry.events.filter(e => e.type === 'portal').length, 1);
  reentry.game.state().head.du *= -1;
  for (let i = 0; i < 30; i++) reentry.game.update(1 / 120);
  assert.equal(reentry.events.filter(e => e.type === 'portal').length, 2, 'Leaving and reentering the same portal switches back');
  assert.equal(reentry.game.state().head.side, 1);

  // Teleport within the inner circle on either local side; grazing the rim
  // or passing beyond the ring should leave the snake on its current side.
  for (const side of [1, -1]) for (const [offset, expectedCount] of [[.03, 1], [.062, 0], [.105, 0]]) {
    const grazing = makeGame(app, { initialLength: .1 });
    grazing.game.reset(nav.seed(.5, .5, null, side));
    const ahead = nav.move(grazing.game.state().head, .23).point;
    const target = app.atlas.createChart(ahead).unproject(offset, 0);
    putPortal(grazing.game, nav, target);
    for (let i = 0; i < 60; i++) grazing.game.update(1 / 120);
    assert.equal(grazing.events.filter(e => e.type === 'portal').length, expectedCount,
      'Only inner-circle contact activates, without double toggles');
    assert.equal(grazing.game.state().head.side, expectedCount ? -side : side);
  }

  // A live passage changes only the head/future path, then the body follows.
  app.game.reset(nav.seed(.5, .5));
  app.game.state().portals.splice(0);
  const start = nav.copy(app.game.state().head);
  const portal = putPortal(app.game, nav, nav.move(start, .23).point);
  for (let i = 0; i < 30; i++) app.game.update(1 / 120);
  let state = app.game.state();
  assert.equal(state.head.side, -start.side);
  assert.equal(state.snake.at(-1).side, start.side, 'The tail has not teleported');
  assert.equal(state.passages.length, 1, 'Remaining in the portal never toggles repeatedly');
  const passage = state.passages[0];
  assert.equal(passage.from.u, passage.to.u); assert.equal(passage.from.v, passage.to.v);
  assert.deepEqual(passage.from.topo, passage.to.topo, 'Passing through contributes the identity');
  assert.ok(app.surfaceFrame(passage.from).forward.dot(app.surfaceFrame(passage.to).forward) > .99999);
  assert.ok(lift(app, passage.from).dot(lift(app, passage.to)) < -.999999);
  const untouchedFood = { ...nav.oppositeSide(state.head), type: 'grow', age: 0 };
  state.foods.splice(0, 1, untouchedFood);
  app.game.update(1 / 120);
  assert.ok(app.game.state().foods.includes(untouchedFood), 'Food on the opposite side cannot be eaten');
  assert.equal(app.game.state().lastClosure, null, 'Passing through alone never wins');
  portal.age = portal.lifetime;
  app.game.update(1 / 120);
  assert.ok(app.game.state().portals.includes(portal) && portal.heldActive, 'Expiry waits for the body to clear');
  app.clayActors.update(2000); app.portalActors.update(); app.chartView.update(app.game.state());
  assert.equal(app.portalActors.group.children.length, 1);
  assert.equal(app.invoke('torusMaterial.onBeforeCompile'), THREE.Material.prototype.onBeforeCompile,
    'Portal markers leave the surface shader intact');
  assert.equal(app.chartView.snapshot.portals.length, 1);
  for (const actors of [app.clayActors, app.portalActors]) actors.group.traverse(object => {
    assert.ok([...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray()].every(Number.isFinite));
    if (object.instanceMatrix) assert.ok([...object.instanceMatrix.array].every(Number.isFinite));
  });
  app.game.setPaused(true);
  const stopped = JSON.stringify(app.game.state());
  app.game.update(.1);
  assert.equal(JSON.stringify(app.game.state()), stopped, 'Pausing freezes portals and motion');
  app.game.setPaused(false);
  for (let i = 0; i < 210; i++) app.game.update(1 / 120);
  assert.equal(app.game.state().passages.length, 0, 'The tail has cleared the passage');
  assert.equal(app.game.state().portals.includes(portal), false, 'The expired portal can now disappear');
  app.portalActors.update();
  assert.equal(app.portalActors.group.children.length, 0);

  // Fixed probability checks, cap and expiry use game time, not render frames.
  let draw = .9, candidate = nav.seed(.9, .8);
  const timer = makeGame(app, { initialLength: .45, initialSpeed: 0,
    random: () => draw, randomPoint: () => candidate,
    portalSettings: { interval: .1, chance: .4, lifetime: 10, initialCount: 0 } }).game;
  timer.reset(nav.seed(.3, .5));
  timer.state().foods.splice(0, timer.state().foods.length,
    ...Array.from({ length: 4 }, () => ({ ...nav.copy(candidate), age: 0, type: 'grow' })));
  candidate = nav.seed(.65, .7);
  timer.update(.1);
  assert.equal(timer.state().portals.length, 0, 'A failed probability roll creates nothing');
  draw = .2;
  timer.update(.05);
  assert.equal(timer.state().portals.length, 0, 'There is no roll before the interval');
  timer.update(.05);
  assert.equal(timer.state().portals.length, 1);
  candidate = nav.seed(.7, .3);
  timer.update(.1);
  assert.equal(timer.state().portals.length, 2);
  candidate = nav.seed(.4, .8);
  timer.update(.1);
  assert.equal(timer.state().portals.length, 2, 'At most two portals coexist');
  draw = .9;
  timer.state().portals.forEach(portal => { portal.age = portal.lifetime; });
  timer.update(1 / 120);
  assert.equal(timer.state().portals.length, 0, 'Unoccupied expired portals disappear');
  draw = .2; candidate = timer.state().head;
  timer.update(.1);
  assert.equal(timer.state().portals.length, 0, 'Portals never spawn under the snake');
  candidate = nav.oppositeSide(timer.state().head);
  timer.update(.1);
  assert.equal(timer.state().portals.length, 0, 'Opposite-side body positions are protected too');

  app.game.reset(nav.seed(.7, .6)); app.portalActors.update();
  assert.equal(app.game.state().portals.length, 1);
  assert.equal(app.game.state().passages.length, 0);
  assert.equal(app.portalActors.group.children.length, 1, 'Restart replaces rather than duplicates portal markers');
  assert.equal(app.game.state().lastClosure, null);

  const torus = createApp(THREE, 'torus');
  assert.equal(torus.game.state().portals.length, 0, 'Other maps have no passages');
  assert.equal(torus.portalActors, null);
  return { passageClosures: 2, trivialCuts: 2, boundaryGenerators: 3, portalContacts: 6, sphericalLift: true,
    singleSnake: true, bodyFollows: true, probabilityAndCap: true, expiryAfterTail: true, pauseAndReset: true };
}

module.exports = { run };
if (require.main === module) (async () => {
  const response = await fetch('https://cdn.jsdelivr.net/npm/three@0.174.0/build/three.core.js');
  if (!response.ok) throw new Error('Could not load the pinned Three.js version');
  const THREE = await import('data:text/javascript;base64,' + Buffer.from(await response.text()).toString('base64'));
  console.log(run(THREE));
})().catch(error => { console.error(error); process.exitCode = 1; });
