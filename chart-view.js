/* Snake on Surfaces · Copyright 2026 Xingying Li · Apache-2.0 */
'use strict';

function createChartView({ THREE, canvas, parent, atlas, navigation: nav, colors }) {
  const ctx = canvas.getContext('2d');
  const boundaryGeometry = new THREE.BufferGeometry();
  const boundaryLine = new THREE.Line(boundaryGeometry,
    new THREE.LineBasicMaterial({ color: 0xfff1bd, transparent: true, opacity: 0.95, depthWrite: false }));
  boundaryLine.name = 'local-chart-boundary';
  boundaryLine.frustumCulled = false;
  parent.add(boundaryLine);
  let chart = null, outline = [], cached = new WeakMap(), footprints = new WeakMap(), lastHead = null;
  let snapshot = null;

  function project(p) {
    if (!cached.has(p)) cached.set(p, chart.project(p));
    return cached.get(p);
  }
  function install(nextChart, nextOutline) {
    chart = nextChart; outline = nextOutline; cached = new WeakMap(); footprints = new WeakMap();
    const positions = [];
    for (const q of outline) {
      const f = q.position ? q : nav.frame(q.point);
      const p = f.position.clone().addScaledVector(f.normal, 0.014);
      positions.push(p.x, p.y, p.z);
    }
    const attribute = boundaryGeometry.getAttribute('position');
    if (attribute && attribute.array.length === positions.length) {
      attribute.array.set(positions); attribute.needsUpdate = true;
    } else boundaryGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    boundaryGeometry.computeBoundingSphere();
  }
  function rebuild(head) {
    const next = atlas.createChart(head);
    install(next, next.outline(32));
  }

  function update(state) {
    if (!state.snake.length) return;
    const head = state.head;
    // The displayed chart follows the head continuously. Recentring only
    // after a distance threshold made its rim drift and then snap back.
    if (!chart || head !== lastHead) rebuild(head);
    lastHead = head;
    const centre = project(head) || { x: 0, y: 0 }, up = chart.directionAt(head);
    if (!footprints.has(head)) footprints.set(head, chart.footprint(head));
    const headRight = footprints.get(head)?.right;
    // A chart transition on a non-orientable surface may reverse orientation.
    // Screen-right must still agree with the game's local right-turn control.
    const handedness = headRight ? Math.sign(headRight.x * up.y - headRight.y * up.x) || 1 : 1;
    const cssSize = Math.max(180, Math.round(canvas.getBoundingClientRect().width));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(cssSize * dpr)) canvas.width = canvas.height = Math.round(cssSize * dpr);
    const size = cssSize, zoom = size * 0.435 / chart.radius, middle = size / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const screen = q => q && ({ x: middle + ((q.x - centre.x) * up.y - (q.y - centre.y) * up.x) * zoom * handedness,
      y: middle - ((q.x - centre.x) * up.x + (q.y - centre.y) * up.y) * zoom });
    const point = p => screen(project(p));
    const domainBoundary = outline.map(screen);
    const viewRadius = size * 0.435;
    const boundary = Array.from({ length: 65 }, (_, i) => ({
      x: middle + Math.cos(i / 64 * Math.PI * 2) * viewRadius,
      y: middle + Math.sin(i / 64 * Math.PI * 2) * viewRadius,
    }));
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#f6f5ec'; ctx.fillRect(0, 0, size, size);
    const viewport = () => {
      ctx.beginPath(); ctx.arc(middle, middle, viewRadius, 0, Math.PI * 2); ctx.closePath();
    };
    const domain = () => {
      ctx.beginPath(); domainBoundary.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
    };
    // The fixed viewport rim does not move with the surface coordinates. The
    // valid chart domain is still clipped, including the Mobius strip's edge.
    ctx.save(); viewport(); ctx.clip();
    domain(); ctx.fillStyle = '#dde9db'; ctx.fill();
    domain(); ctx.clip();
    ctx.strokeStyle = '#bdcebd'; ctx.lineWidth = 0.6;
    const grid = size * 0.14;
    for (let i = -4; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(middle + i * grid, 0); ctx.lineTo(middle + i * grid, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, middle + i * grid); ctx.lineTo(size, middle + i * grid); ctx.stroke();
    }
    const vector = v => ({ x: (v.x * up.y - v.y * up.x) * zoom * state.radius * handedness,
      y: -(v.x * up.x + v.y * up.y) * zoom * state.radius });
    const pose = p => {
      const q = point(p);
      if (!q || q.x < -size || q.x > size * 2 || q.y < -size || q.y > size * 2) return null;
      if (!footprints.has(p)) footprints.set(p, chart.footprint(p));
      const footprint = footprints.get(p);
      if (!footprint) return null;
      return { ...q, r: vector(footprint.right), f: vector(footprint.forward) };
    };
    const body = state.snake.map(pose);
    const companionBody = (state.companionSnake || []).map(pose);
    ctx.lineCap = ctx.lineJoin = 'round';
    // Widths and heads use the chart differential too: local coordinates may
    // distort lengths, so a world-space round body need not be a 2D circle.
    const offset = (p, side, height = 0) => ({ x: p.x + p.r.x * side + p.f.x * height,
      y: p.y + p.r.y * side + p.f.y * height });
    function disk(p, color, scale = 1) {
      ctx.save(); ctx.transform(p.r.x, p.r.y, p.f.x, p.f.y, p.x, p.y);
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, scale, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    function ribbon(samples, color, width) {
      ctx.fillStyle = color;
      let previous = null;
      for (let i = samples.length - 1; i >= 0; i--) {
        const p = samples[i];
        if (!p) { previous = null; continue; }
        if (previous && Math.hypot(previous.x - p.x, previous.y - p.y) < state.spacing * zoom * 5) {
          const quad = [offset(previous, width), offset(p, width), offset(p, -width), offset(previous, -width)];
          ctx.beginPath(); quad.forEach((q, j) => j ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath(); ctx.fill();
        }
        disk(p, color, width); previous = p;
      }
    }
    for (const samples of [body, companionBody]) {
      ribbon(samples, '#d67a49', 1.04); ribbon(samples, '#eea568', 0.88);
    }
    const visibleFoods = [];
    for (const food of state.foods) {
      const p = pose(food);
      if (!p) continue;
      visibleFoods.push({ food, ...p });
      ctx.save(); ctx.transform(p.r.x, p.r.y, p.f.x, p.f.y, p.x, p.y);
      ctx.fillStyle = colors[food.type]; ctx.beginPath(); ctx.arc(0, 0, .96, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff7dba0'; ctx.beginPath(); ctx.ellipse(-.3, .3, .22, .3, .4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4f9560'; ctx.beginPath(); ctx.ellipse(.32, 1, .45, .2, .5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    const headPose = body[0];
    if (headPose) {
      ctx.save(); ctx.transform(headPose.r.x, headPose.r.y, headPose.f.x, headPose.f.y, middle, middle);
      ctx.fillStyle = '#ec9860'; ctx.beginPath(); ctx.ellipse(0, 0, 1.1, 1.22, 0, 0, Math.PI * 2); ctx.fill();
      for (const sign of [-1, 1]) {
        ctx.fillStyle = '#fffdf0'; ctx.beginPath(); ctx.arc(sign * .57, .4, .4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#304b49'; ctx.beginPath(); ctx.arc(sign * .57, .57, .18, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore(); viewport(); ctx.strokeStyle = '#fff5cc'; ctx.lineWidth = 3; ctx.stroke();
    snapshot = { chart, centre, up, handedness, boundary, domainBoundary, body, companionBody, foods: visibleFoods, size, zoom };
  }
  return { update, reset() { chart = null; lastHead = null; cached = new WeakMap(); }, get chart() { return chart; }, get snapshot() { return snapshot; } };
}

if (typeof module !== 'undefined') module.exports = { createChartView };
