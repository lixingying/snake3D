// Run: node tests/surface-atlas.cjs
// Checks the chart as a map of surface points, including its inverse and seams.
const assert = require('node:assert/strict');
const { createApp } = require('./continuous-motion.cjs');

function run(THREE) {
  const maps = ['torus', 'sphere', 'mobius', 'projective', 'klein', 'genus2'];
  let roundTrips = 0, seamPairs = 0;
  for (const type of maps) {
    const app = createApp(THREE, type), nav = app.navigation;
    const positions = [app.game.state().head];
    for (const [u, v] of [[0.001, 0.38], [0.999, 0.64], [0.32, 0.001], [0.62, 0.999]]) positions.push(nav.seed(u, v, app.game.state().head.face));
    if (type === 'sphere' || type === 'projective') {
      for (const [u, v] of [[0.0001, 0.0001], [0.9999, 0.0001], [0.0001, 0.9999], [0.9999, 0.9999]]) positions.push(nav.seed(u, v, app.game.state().head.face));
    }
    for (const origin of positions) {
      const chart = app.atlas.createChart(origin);
      const centre = chart.project(origin);
      assert.ok(centre && Math.hypot(centre.x, centre.y) < 1e-6, type + ': chart centre');
      for (const radius of [0.02, 0.12, 0.30, 0.50]) for (let angle = 0; angle < 8; angle++) {
        const x = radius * Math.cos(angle * Math.PI / 4), y = radius * Math.sin(angle * Math.PI / 4);
        const p = chart.unproject(x, y);
        if (!p) continue; // Chart boundary or the actual boundary of the strip.
        const q = chart.project(p);
        assert.ok(q && Math.hypot(q.x - x, q.y - y) < 0.0003, type + ': chart inverse at ' + JSON.stringify({ origin, x, y, q }));
        roundTrips++;
      }
      const turned = nav.move(origin, 0.005, 0.12).point;
      const straight = nav.move(origin, 0.005).point;
      const a = chart.project(turned), b = chart.project(straight);
      if (a && b) assert.ok(a.x > b.x - 1e-5, type + ': right turn is right in the chart');
    }
    for (const edge of ['L', 'R', 'U', 'D']) {
      if (type === 'mobius' && (edge === 'U' || edge === 'D')) continue;
      const p = nav.seed(edge === 'L' ? 0 : edge === 'R' ? 1 : 0.37, edge === 'U' ? 0 : edge === 'D' ? 1 : 0.37, app.game.state().head.face);
      const q = nav.glue(p, edge);
      if (type === 'klein') q.v = ((q.v % 1) + 1) % 1;
      assert.ok(app.surfacePoint(p).distanceTo(app.surfacePoint(q)) < 1e-7, type + ': glued coordinates share one 3D point');
      const chart = app.atlas.createChart(p), a = chart.project(p), b = chart.project(q);
      assert.ok(a && b && Math.hypot(a.x - b.x, a.y - b.y) < 0.0003, type + ': glued edge ' + edge);
      seamPairs++;
    }
    app.clayActors.update(1234);
    app.clayActors.group.traverse(object => {
      assert.ok([...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray()].every(Number.isFinite), type + ': finite render pose ' + object.name);
      if (object.instanceMatrix) assert.ok([...object.instanceMatrix.array].every(Number.isFinite), type + ': finite instance matrices');
    });
    const visibleFruit = app.clayActors.group.children.filter(object => object.name === 'fruit' && object.visible);
    assert.equal(visibleFruit.length, app.game.state().foods.length, type + ': food is present in both views');
    const snapshot = app.chartView.snapshot;
    assert.equal(snapshot.body.length, app.game.state().snake.length, 'One chart result per body sample');
    assert.ok(Math.hypot(snapshot.body[0].x - snapshot.size / 2, snapshot.body[0].y - snapshot.size / 2) < 1e-6);
  }
  const rp = createApp(THREE, 'projective');
  const preimages = [];
  for (const angle of [Math.PI / 6, 5 * Math.PI / 6]) {
    rp.sandbox.doublePointSphere = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
    preimages.push(rp.invoke('({...navigation.seed(0,0), ...atlasPointFromSphere(doublePointSphere)})'));
  }
  const [p, q] = preimages;
  assert.ok(rp.surfacePoint(p).distanceTo(rp.surfacePoint(q)) < 1e-8, 'Fixture is a double point of the cross-cap');
  assert.equal(rp.navigation.samePoint(p, q), false, 'Those are distinct abstract points');
  assert.equal(rp.navigation.contact(p, p, q, q, .04), null, 'A display overlap is not a snake collision');
  for (const point of preimages) {
    const f = rp.surfaceFrame(point);
    assert.ok(f.normal.length() > .999, 'Each sheet at a double point has a valid display normal');
  }
  let pinchPassages = 0;
  for (const [u, v] of [[0, .5], [1, .5], [.5, 0], [.5, 1]]) {
    const pinch = rp.navigation.seed(u, v), h = .00001;
    const du = rp.surfacePoint({ ...pinch, u: u + h }).sub(rp.surfacePoint({ ...pinch, u: u - h }));
    const dv = rp.surfacePoint({ ...pinch, v: v + h }).sub(rp.surfacePoint({ ...pinch, v: v - h }));
    assert.ok(du.cross(dv).length() / (4 * h * h) < .00001, 'The fixture is a genuine display pinch');
    const intrinsic = rp.navigation.frame(pinch);
    assert.ok(intrinsic.du.clone().cross(intrinsic.dv).length() > .01, 'The movement metric stays regular at a display pinch');
    for (const side of [1, -1]) for (const angle of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
      let p = { ...pinch, side, du: Math.cos(angle), dv: Math.sin(angle) };
      for (let i = 0; i < 30; i++) {
        const visual = rp.surfaceFrame(p), companion = rp.surfaceFrame(rp.navigation.oppositeSide(p));
        assert.ok(visual.normal.length() > .999 && visual.forward.length() > .999, 'The display pose remains finite at and near a pinch');
        assert.ok(visual.normal.dot(companion.normal) < -.999 && visual.forward.dot(companion.forward) > .999, 'Pinch handling preserves the mirror pair');
        const step = rp.navigation.move(p, .01, .007);
        const length = step.segments.reduce((sum, segment) => sum + segment.length, 0);
        assert.ok(Math.abs(length - .01) < .00005, 'A pinch cannot stall or accelerate intrinsic motion');
        p = step.point;
      }
      pinchPassages++;
    }
  }
  // The cached chart can straddle an orientation-reversing seam. Turning right
  // must still move toward screen-right before the next chart is prepared.
  rp.game.reset(rp.navigation.seed(.9999, .37)); rp.chartView.reset(); rp.chartView.update(rp.game.state());
  rp.game.update(1 / 60); rp.chartView.update(rp.game.state());
  const snapshot = rp.chartView.snapshot, head = rp.game.state().head;
  const right = snapshot.chart.project(rp.navigation.move(head, .005, .12).point);
  const forward = snapshot.chart.project(rp.navigation.move(head, .005).point);
  const dx = ((right.x - forward.x) * snapshot.up.y - (right.y - forward.y) * snapshot.up.x) * snapshot.handedness;
  assert.ok(dx > 0, 'Right turn remains right across an orientation-reversing seam');
  const marker = rp.clayActors.group.parent.getObjectByName('local-chart-boundary').geometry.getAttribute('position');
  snapshot.chart.outline(32).forEach((sample, i) => {
    const f = rp.surfaceFrame(sample.point), expected = f.position.clone().addScaledVector(f.normal, .014);
    assert.ok(new THREE.Vector3().fromBufferAttribute(marker, i).distanceTo(expected) < .000001, 'The chart marker follows the cross-cap, not the invisible motion sphere');
  });
  return { maps, roundTrips, seamPairs, pinchPassages, uniqueSamples: true, finiteRenderPoses: true, surfaceSheetIsolation: true };
}

module.exports = { run };
if (require.main === module) (async () => {
  const response = await fetch('https://cdn.jsdelivr.net/npm/three@0.174.0/build/three.core.js');
  if (!response.ok) throw new Error('Could not load the pinned Three.js version');
  const THREE = await import('data:text/javascript;base64,' + Buffer.from(await response.text()).toString('base64'));
  console.log(run(THREE));
})().catch(error => { console.error(error); process.exitCode = 1; });
