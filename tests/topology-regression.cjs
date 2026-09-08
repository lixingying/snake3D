// Run: node tests/topology-regression.cjs
// Geometry-based counterexamples, independent of the displayed group formula.
const assert = require('node:assert/strict');
const { createApp } = require('./continuous-motion.cjs');

function classification(app, from, to) {
  app.sandbox.checkFrom = from.topo;
  app.sandbox.checkTo = to.topo;
  return app.invoke('topologyDifferenceInfo(checkFrom, checkTo)');
}

function path(app, start, steps) {
  let p = start;
  for (const [du, dv] of steps) p = app.navigation.trace(p, du, dv).point;
  return p;
}

function contractible(app, start, steps, label) {
  const end = path(app, start, steps);
  assert.ok(app.navigation.samePoint(start, end, 1e-6), label + ': closed on the same local side');
  assert.equal(classification(app, start, end).nontrivial, false, label + ': contracts to a point');
}

function genus2Audit(app) {
  // A cell's neighbours are determined by the actual surface gluing. Walking
  // once around ANY mesh vertex bounds a disk, including concave patch corners.
  // A cut implementation must send all these attaching loops to the identity.
  const report = app.invoke(`(() => {
    const n = GENUS2_PATCH_CELLS, cells = new Map(), stars = new Map();
    const key = p => [p.face, p.gx, p.gy].join(':');
    const moves = [{dx:1,dy:0},{dx:0,dy:1},{dx:-1,dy:0},{dx:0,dy:-1}];
    const neighbour = (p, move) => normalizeGenus2Position(p.gx+move.dx,p.gy+move.dy,move,1,p.face);
    for (const face of getGenus2Topology().faces) for (let gx=0;gx<n;gx++) for (let gy=0;gy<n;gy++) {
      const p = {face:face.key,gx,gy,side:1}; cells.set(key(p),p);
      for (const [x,y] of [[gx,gy],[gx+1,gy],[gx,gy+1],[gx+1,gy+1]]) {
        const vertex = genus2GridVertexKey(face.key,x,y);
        if (!stars.has(vertex)) stars.set(vertex,[]);
        stars.get(vertex).push(p);
      }
    }
    const failures = [];
    for (const [vertex, incident] of stars) {
      const local = new Set(incident.map(key)), start = incident[0];
      let p=start, previous=null, topo=emptyTopologyState();
      for (let step=0;step<incident.length;step++) {
        const move = moves.find(move => {
          const q=neighbour(p,move); return local.has(key(q)) && key(q)!==previous;
        });
        if (!move) { failures.push({vertex,reason:'open vertex link'}); break; }
        topo=advanceTopologyState(topo,p,move); previous=key(p); p=neighbour(p,move);
      }
      if (key(p)!==key(start) || topologyDifferenceInfo(emptyTopologyState(),topo).nontrivial)
        failures.push({vertex,word:topo.word});
    }
    // Connect the complement of the cuts. An edge labelled by one generator,
    // closed via these cut-free paths, gives an actual noncontractible loop.
    const root = cells.values().next().value, parent = new Map([[key(root),null]]), queue=[root];
    for (let i=0;i<queue.length;i++) for (const move of moves) {
      const p=queue[i], q=neighbour(p,move);
      if (genus2StepWord(p,move).length || parent.has(key(q))) continue;
      parent.set(key(q),{point:p,move}); queue.push(q);
    }
    const generators = new Map(); let inverseEdges=0;
    for (const p of cells.values()) for (const move of moves) {
      const q=neighbour(p,move);
      const back=moves.find(back => key(neighbour(q,back))===key(p));
      const word=genus2StepWord(p,move);
      if (!back || reduceGenus2Word([...word,...genus2StepWord(q,back)]).length)
        failures.push({edge:key(p),move,reason:'edge inverse'});
      inverseEdges++;
      if (word.length===1 && word[0]===word[0].toLowerCase() && parent.has(key(p)) && parent.has(key(q)))
        generators.set(word[0],{p,q,move});
    }
    const rootPath = p => {
      const edges=[];
      while (parent.get(key(p))) { const edge=parent.get(key(p)); edges.push(edge); p=edge.point; }
      return edges.reverse();
    };
    const generatorWords={};
    for (const [label,{p,q,move}] of generators) {
      const edges=[...rootPath(p),{point:p,move}];
      for (const edge of rootPath(q).reverse()) {
        const destination=neighbour(edge.point,edge.move);
        edges.push({point:destination,move:moves.find(back=>key(neighbour(destination,back))===key(edge.point))});
      }
      let topo=emptyTopologyState();
      for (const edge of edges) topo=advanceTopologyState(topo,edge.point,edge.move);
      generatorWords[label]=topo.word;
    }
    const a=generatorWords.a, c=generatorWords.c;
    const commutator = a && c ? reduceGenus2Word([...a,...c,...invertWord(a),...invertWord(c)]) : [];
    return {vertices:stars.size,inverseEdges,failures,generatorWords,commutator};
  })()`);
  assert.equal(report.failures.length, 0, JSON.stringify(report.failures));
  assert.equal(Object.keys(report.generatorWords).sort().join(''), 'abcd', 'All four generators come from closed surface paths');
  for (const word of Object.values(report.generatorWords)) assert.ok(word.length, 'A handle generator stays nontrivial');
  assert.ok(report.commutator.length, 'A separating loop is nontrivial even though its homology vanishes');
  return { vertices: report.vertices, inverseEdges: report.inverseEdges, generators: 4, separatingLoop: true };
}

function run(THREE) {
  const maps = ['torus','sphere','mobius','projective','klein','genus2'];
  const apps = Object.fromEntries(maps.map(type=>[type,createApp(THREE,type)]));
  let turns=0, vertexLoops=0, kleinLifts=0;
  for (const [type,app] of Object.entries(apps)) {
    const nav=app.navigation;
    const points=[app.game.state().head,nav.seed(.998,.37,app.game.state().head.face)];
    if (type==='mobius'||type==='klein') points.push({...points[1],side:-1});
    for (const p of points) for (const sign of [-1,1]) {
      const f=nav.frame(p), right=f.forward.clone().cross(f.normal).normalize();
      // This uses 3D geometry, not the chart's own (possibly mirrored) basis.
      const rotated=nav.frame(nav.move(p,0,sign*.12).point).forward;
      assert.ok(sign*rotated.dot(right)>.1, type+': physical steering viewed from above the snake');
      const chart=app.atlas.createChart(p), straight=nav.move(p,.001).point, turned=nav.move(p,.001,sign*.12).point;
      const a=chart.project(turned), b=chart.project(straight);
      if (a&&b) assert.ok(sign*(a.x-b.x)>0, type+': chart agrees with 3D steering');
      turns++;
    }
    // A zero-length cut record must have the incoming and outgoing group
    // states on the correct endpoints, so reversing an initial trail works.
    const p=nav.seed(.49,.37,app.game.state().head.face);
    const segments=nav.trace(p,.54,.11).segments;
    for (let i=1;i<segments.length;i++) assert.equal(JSON.stringify(segments[i-1].to.topo),JSON.stringify(segments[i].from.topo),type+': contiguous topology records');
  }

  const torus=apps.torus, nav=torus.navigation;
  for (let x=1;x<20;x++) for (let y=1;y<20;y++) for (const dx of [-1,1]) for (const dy of [-1,1]) {
    const p=nav.seed(x/20-dx*.01,y/20-dy*.01);
    contractible(torus,p,[[dx*.02,dy*.02],[-dx*.02,0],[0,-dy*.02]],'Torus cut vertex'); vertexLoops++;
  }
  for (const du of [-1,1]) for (const dv of [-1,1]) {
    const p=nav.seed(.49,.49), end=nav.trace(p,du,dv).point;
    assert.ok(nav.samePoint(p,end,1e-6));
    assert.equal(end.topo.wx,du); assert.equal(end.topo.wy,dv);
    contractible(torus,nav.seed(du>0?.99:.01,dv>0?.99:.01),[[du*.02,dv*.02],[-du*.02,0],[0,-dv*.02]],'Torus corner');
  }
  const start=nav.seed(.49,.49), direct=nav.trace(start,.02,.02).point;
  const subdivided=path(torus,start,[[.01,.01],[.01,.01]]);
  assert.equal(JSON.stringify(direct.topo),JSON.stringify(subdivided.topo),'Subdividing at a cut vertex preserves the class');

  const klein=apps.klein;
  contractible(klein,klein.navigation.seed(.99,.24),[[.02,0],[0,-.02],[-.02,0],[0,-.02]],'Klein seam rectangle');
  const upper=klein.navigation.trace(klein.navigation.seed(.31,.001),.002,-.02);
  assert.ok(Math.abs(upper.point.u-.312)<1e-6 && Math.abs(upper.point.v-.981)<1e-6,'Klein upper seam preserves the rest of the step');
  assert.equal(upper.crossings.filter(c=>c.from.gy===0&&c.move.dy===-1).length,1,'Klein upper seam is crossed once, without a zero-distance loop');
  // Independent oracle: a Klein loop is trivial exactly when its lift in R²
  // returns to its starting point. Use piecewise linear paths upstairs, with
  // deck action (X,Y) -> (X+m,(-1)^m*Y+n), then project to game coordinates.
  let randomSeed=4567;
  const random=()=>((randomSeed=(Math.imul(randomSeed,1664525)+1013904223)>>>0)/4294967296);
  for (const u of [.17,.63,.99]) for (const v of [.24,.57]) for (const m of [-2,0,2]) for (const n of [-1,0,1]) {
    const s=klein.navigation.seed(u,v); let p=s, x=u, y=v-.25;
    const vertices=Array.from({length:3},()=>[u+(random()-.5)*1.4,v-.25+(random()-.5)*1.4]);
    vertices.push([u+m,v-.25+n]); // m is even, so the local side also matches.
    for (const [tx,ty] of vertices) {
      const steps=Math.ceil((Math.abs(tx-x)+Math.abs(ty-y))/.3);
      const dx=(tx-x)/steps, dy=(ty-y)/steps;
      for (let i=0;i<steps;i++) {
        p=klein.navigation.trace(p,dx,(Math.floor(x)%2===0?1:-1)*dy).point;
        x+=dx; y+=dy;
      }
    }
    assert.ok(klein.navigation.samePoint(s,p,1e-6),'Lift projects to a closed same-side loop: '+JSON.stringify({u,v,m,n,end:p}));
    assert.equal(classification(klein,s,p).nontrivial,m!==0||n!==0,'Klein group agrees with the universal-cover endpoint');
    kleinLifts++;
  }

  const genus2=apps.genus2;
  contractible(genus2,genus2.navigation.seed(2.5/6,.05,'G2_0_0_0_NX'),[[1/6,0],[0,-.10],[0,-1/6],[-.10,0]],'Genus-2 overlap junction');
  const genus2Report=genus2Audit(genus2);

  const mobius=apps.mobius;
  mobius.game.reset({...mobius.navigation.seed(.18,.98),du:0,dv:-1});
  const state=mobius.game.state();
  assert.ok(state.trail[0].topo.boundary<state.head.topo.boundary,'Backward seed counts boundary visits in forward time');
  for (let i=1;i<state.trail.length;i++) assert.ok(state.trail[i].topo.boundary>=state.trail[i-1].topo.boundary,'Boundary counts never cancel');
  const oldBody={topo:{...state.trail[0].topo,w:-1}}, newHead={topo:{...state.head.topo,boundary:1}};
  assert.equal(classification(mobius,oldBody,newHead).nontrivial,false,'Boundary crossings on both sides of reset cannot cancel into a win');
  return { turns, vertexLoops, kleinLifts, genus2:genus2Report, reversedTrail:true, boundaryVisits:true };
}

module.exports={run};
if(require.main===module)(async()=>{
  const response=await fetch('https://cdn.jsdelivr.net/npm/three@0.174.0/build/three.core.js');
  if(!response.ok)throw new Error('Could not load the pinned Three.js version');
  const THREE=await import('data:text/javascript;base64,'+Buffer.from(await response.text()).toString('base64'));
  console.log(run(THREE));
})().catch(error=>{console.error(error);process.exitCode=1;});
