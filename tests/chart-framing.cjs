// Run: node tests/chart-framing.cjs
const assert = require('node:assert/strict');
const { createApp } = require('./continuous-motion.cjs');

function run(THREE) {
  const reports = [];
  for (const type of ['torus', 'sphere', 'mobius', 'projective', 'klein', 'genus2']) {
    const app = createApp(THREE, type), rim = app.chartView.snapshot.boundary;
    let maximumJump = 0, previous = rim;
    for (let i = 0; i < 90; i++) {
      app.game.setTurn(i < 45 ? 0.3 : -0.3);
      app.game.update(1 / 60);
      app.chartView.update(app.game.state());
      const view = app.chartView.snapshot;
      for (let j = 0; j < rim.length; j++) {
        const p = view.boundary[j];
        maximumJump = Math.max(maximumJump, Math.hypot(p.x - previous[j].x, p.y - previous[j].y));
        assert.ok(Math.hypot(p.x - rim[j].x, p.y - rim[j].y) < 1e-8, type + ': rim is fixed during travel and steering');
      }
      assert.ok(Math.hypot(view.body[0].x - view.size / 2, view.body[0].y - view.size / 2) < 1e-6, type + ': head remains centred');
      assert.ok(app.navigation.samePoint(view.chart.origin, app.game.state().head), type + ': surface marker follows the current head');
      previous = view.boundary;
    }
    app.game.setPaused(true);
    const state = JSON.stringify(app.game.state()), pausedChart = app.chartView.chart;
    app.chartView.update(app.game.state());
    assert.equal(app.chartView.chart, pausedChart, 'Pausing does not rebuild a stationary chart');
    assert.equal(JSON.stringify(app.game.state()), state, 'Drawing does not mutate the game');
    reports.push({ map: type, maximumJump });
  }

  const strip = createApp(THREE, 'mobius');
  strip.game.reset(strip.navigation.seed(.3, .01)); strip.chartView.reset(); strip.chartView.update(strip.game.state());
  const view = strip.chartView.snapshot, radius = view.size * .435;
  assert.ok(view.domainBoundary.some(p => Math.hypot(p.x - view.size / 2, p.y - view.size / 2) < radius * .2), 'The physical strip edge still clips the valid chart domain');
  assert.ok(view.boundary.every(p => Math.abs(Math.hypot(p.x - view.size / 2, p.y - view.size / 2) - radius) < 1e-8), 'The physical edge does not pull the viewport rim inward');

  const genus = createApp(THREE, 'genus2');
  let surfaceSamples = 0;
  for (const [u, v, face] of [[.5, .5, genus.game.state().head.face], [.998, .37, genus.game.state().head.face], [.5, .5, 'G2_0_0_0_PZ']]) {
    const chart = genus.atlas.createChart(genus.navigation.seed(u, v, face));
    for (const q of chart.outline(32)) {
      genus.sandbox.boundarySample = q.position;
      assert.ok(Math.abs(genus.invoke('genus2Field(boundarySample.x,boundarySample.y,boundarySample.z)')) < 1e-7, 'The moving marker lies on the actual manifold');
      const p = chart.unproject(q.x * .97, q.y * .97);
      assert.ok(p, 'Points inside the border belong to the coordinate chart');
      const projected = chart.project(p);
      assert.ok(projected && Math.hypot(projected.x - q.x * .97, projected.y - q.y * .97) < 1e-4, 'The 3D marker and 2D chart describe the same neighbourhood');
      surfaceSamples++;
    }
  }
  return { reports, surfaceSamples, physicalBoundary: true, pauseStable: true };
}

module.exports = { run };
if (require.main === module) (async () => {
  const response = await fetch('https://cdn.jsdelivr.net/npm/three@0.174.0/build/three.core.js');
  if (!response.ok) throw new Error('Could not load the pinned Three.js version');
  const THREE = await import('data:text/javascript;base64,' + Buffer.from(await response.text()).toString('base64'));
  console.log(run(THREE));
})().catch(error => { console.error(error); process.exitCode = 1; });
