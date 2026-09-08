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
  const w = Math.cbrt((3 - Math.sqrt(5)) / 2), preimages = [];
  for (const angle of [0, 2 * Math.PI / 3, 4 * Math.PI / 3]) {
    rp.sandbox.triplePointSphere = new THREE.Vector3(2 * w * Math.cos(angle) / (1 + w * w), 2 * w * Math.sin(angle) / (1 + w * w), (1 - w * w) / (1 + w * w));
    preimages.push(rp.invoke('({...navigation.seed(0,0), ...atlasPointFromSphere(triplePointSphere)})'));
  }
  const [p, q] = preimages;
  assert.ok(rp.surfacePoint(p).distanceTo(rp.surfacePoint(q)) < 1e-8, 'Fixture is the triple point of the Boy immersion');
  assert.equal(rp.navigation.samePoint(p, q), false, 'Those are distinct abstract points');
  assert.equal(rp.navigation.contact(p, p, q, q, .04), null, 'Immersion overlap is not a snake collision');
  for (const point of preimages) {
    const f = rp.navigation.frame(point);
    assert.ok(f.du.clone().cross(f.dv).length() > 1, 'The triple point has three regular tangent planes');
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
  return { maps, roundTrips, seamPairs, uniqueSamples: true, finiteRenderPoses: true, immersionSheetIsolation: true };
}

module.exports = { run };
if (require.main === module) (async () => {
  const response = await fetch('https://cdn.jsdelivr.net/npm/three@0.174.0/build/three.core.js');
  if (!response.ok) throw new Error('Could not load the pinned Three.js version');
  const THREE = await import('data:text/javascript;base64,' + Buffer.from(await response.text()).toString('base64'));
  console.log(run(THREE));
})().catch(error => { console.error(error); process.exitCode = 1; });
