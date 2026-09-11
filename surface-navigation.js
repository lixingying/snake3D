/* Snake on Surfaces · Copyright 2026 Xingying Li · Apache-2.0 */
'use strict';

// Continuous charts and tangent vectors. The cell decomposition is used only
// to record intersections with the existing topological cuts, never to snap
// positions or restrict steering. No browser or renderer state is owned here.
function createSurfaceNavigator({ THREE, mapType, resolution, pointAt, normalAt,
  patchTransition, advanceTopology, cloneTopology, emptyTopology }) {
  const EPS = 1e-10;
  const edges = ['L', 'R', 'U', 'D'];
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const wrap = x => ((x % 1) + 1) % 1;
  const copy = p => ({ ...p, position: undefined, topo: cloneTopology(p.topo) });
  const oppositeSide = p => ({ ...copy(p), side: -(p.side ?? 1) });
  let chartFactory = null;

  function reverse(p, origin) {
    const q = copy(p);
    q.du = -p.du; q.dv = -p.dv;
    // A boundary visit is an unsigned event, not a group inverse. Reflect its
    // prefix counter when a backward-generated trail is read tail-to-head.
    if (mapType === 'mobius') q.topo.boundary = 2 * (origin.topo?.boundary || 0) - q.topo.boundary;
    return q;
  }

  function frame(p) {
    const h = 1e-5;
    const position = pointAt(p);
    const du = pointAt({ ...p, u: p.u + h }).sub(pointAt({ ...p, u: p.u - h })).multiplyScalar(0.5 / h);
    const dv = pointAt({ ...p, v: p.v + h }).sub(pointAt({ ...p, v: p.v - h })).multiplyScalar(0.5 / h);
    const normal = normalAt(p, position, du, dv).normalize();
    const forward = du.clone().multiplyScalar(p.du ?? 1).addScaledVector(dv, p.dv ?? 0).normalize();
    return { position, du, dv, normal, forward };
  }

  function coefficients(f, vector) {
    const a = f.du.dot(f.du), b = f.du.dot(f.dv), c = f.dv.dot(f.dv);
    const determinant = a * c - b * b;
    if (determinant < 1e-14) return { du: 0, dv: 0 };
    const x = f.du.dot(vector), y = f.dv.dot(vector);
    return { du: (c * x - b * y) / determinant, dv: (a * y - b * x) / determinant };
  }

  function glue(p, edge) {
    if (mapType === 'sphere' || mapType === 'genus2') return patchTransition(p, edge);
    const q = { ...p };
    if (edge === 'L' || edge === 'R') {
      q.u += edge === 'L' ? 1 : -1;
      if (mapType === 'projective' || mapType === 'mobius') {
        q.v = 1 - p.v; q.dv = -p.dv;
      } else if (mapType === 'klein') {
        q.v = 0.5 - p.v; q.dv = -p.dv;
      }
      if (mapType === 'projective' || mapType === 'mobius' || mapType === 'klein') q.side = -p.side;
    } else if (mapType === 'mobius') {
      q.v = edge === 'U' ? -p.v : 2 - p.v;
      q.dv = -p.dv; q.side = -p.side;
    } else {
      q.v += edge === 'U' ? 1 : -1;
      if (mapType === 'projective') { q.u = 1 - p.u; q.du = -p.du; q.side = -p.side; }
    }
    return q;
  }

  function legacyCell(p) {
    return { gx: clamp(Math.floor(p.u * resolution), 0, resolution - 1),
      gy: clamp(Math.floor(p.v * resolution), 0, resolution - 1),
      side: p.side, face: p.face, topo: p.topo };
  }

  // Trace a parameter-space segment, splitting exactly at every cut and chart
  // boundary. Before/after seam endpoints are kept as distinct chart records.
  function trace(start, deltaU, deltaV, transportMotion = false) {
    let p = copy(start), du = deltaU, dv = deltaV;
    const segments = [], crossings = [];
    let total = 0;
    for (let guard = 0; guard < 160 && Math.abs(du) + Math.abs(dv) > EPS; guard++) {
      const cell = legacyCell(p);
      const lineU = (cell.gx + (du > 0 ? 1 : 0)) / resolution;
      const lineV = (cell.gy + (dv > 0 ? 1 : 0)) / resolution;
      const crossingTime = (line, coordinate, delta) => {
        if (Math.abs(delta) <= EPS) return Infinity;
        const t = Math.max(0, (line - coordinate) / delta);
        // An endpoint on a cut is an event even if subtraction rounds t above 1.
        return t > 1 && (t - 1) * Math.abs(delta) < EPS ? 1 : t;
      };
      const tu = crossingTime(lineU, p.u, du), tv = crossingTime(lineV, p.v, dv);
      const t = Math.min(1, tu, tv);
      const q = { ...copy(p), u: p.u + du * t, v: p.v + dv * t };
      const axisU = tu <= tv;
      if (Math.min(tu, tv) <= 1) { if (axisU) q.u = lineU; else q.v = lineV; }
      // Resolve a vertex as two consecutive edge crossings. Keep the second
      // coordinate on its incoming side until its own event is recorded;
      // floor(u*N), floor(v*N) would otherwise silently skip one of the cuts.
      const offsetU = !axisU && tv <= 1 && Math.abs(du) > EPS && Math.abs(q.u - lineU) < EPS
        ? Math.sign(du) * EPS * 4 : 0;
      const offsetV = axisU && tu <= 1 && Math.abs(dv) > EPS && Math.abs(q.v - lineV) < EPS
        ? Math.sign(dv) * EPS * 4 : 0;
      q.u -= offsetU; q.v -= offsetV;
      const length = pointAt(p).distanceTo(pointAt(q));
      if (t > EPS) { segments.push({ from: copy(p), to: copy(q), length }); total += length; }
      if (tu > 1 && tv > 1) { p = q; du = dv = 0; break; }
      const sign = Math.sign(axisU ? du : dv);
      const move = { dx: axisU ? sign : 0, dy: axisU ? 0 : sign };
      const beforeCrossing = copy(q);
      q.topo = advanceTopology(p.topo, cell, move);
      crossings.push({ from: cell, move, topo: cloneTopology(q.topo) });
      let rest = { ...q, du: du * (1 - t) + offsetU, dv: dv * (1 - t) + offsetV };
      const outer = axisU ? q.u < EPS || q.u > 1 - EPS : q.v < EPS || q.v > 1 - EPS;
      if (outer) {
        const edge = axisU ? (sign < 0 ? 'L' : 'R') : (sign < 0 ? 'U' : 'D');
        const oldRest = rest;
        const oldFrame = transportMotion ? frame(q) : null;
        const heading = glue({ ...q, du: p.du, dv: p.dv }, edge);
        rest = glue(rest, edge);
        // Only the reflected u seam needs a periodic v normalization. At the
        // upper seam, glue already returns v=1; wrapping it to 0 traps motion.
        if (mapType === 'klein' && axisU) rest.v = wrap(rest.v);
        rest.u = clamp(rest.u, 0, 1); rest.v = clamp(rest.v, 0, 1);
        // Pick the destination side of the cut even when the step ends there.
        const inward = glue({ ...q, du: move.dx, dv: move.dy }, edge);
        rest.u += inward.du * EPS; rest.v += inward.dv * EPS;
        p = { ...rest, du: heading.du, dv: heading.dv };
        if (transportMotion && !(mapType === 'mobius' && !axisU)) {
          // Patch coordinates have different metric scales. Transport the
          // remaining world-space displacement, not its old UV components.
          const nextFrame = frame(p);
          const displacement = oldFrame.du.clone().multiplyScalar(oldRest.du).addScaledVector(oldFrame.dv, oldRest.dv);
          const remainingLength = displacement.length();
          displacement.addScaledVector(nextFrame.normal, -displacement.dot(nextFrame.normal)).normalize().multiplyScalar(remainingLength);
          Object.assign(rest, coefficients(nextFrame, displacement));
          const forward = oldFrame.forward.clone().addScaledVector(nextFrame.normal, -oldFrame.forward.dot(nextFrame.normal)).normalize();
          Object.assign(p, coefficients(nextFrame, forward));
        }
      } else {
        p = { ...q, u: q.u + move.dx * EPS, v: q.v + move.dy * EPS };
      }
      du = rest.du; dv = rest.dv;
      // This zero-length record changes chart/topology without drawing a chord
      // through a glued surface or losing a cut at an exact endpoint.
      segments.push({ from: beforeCrossing, to: copy(p), length: 0, transition: true });
    }
    return { point: p, segments, crossings, distance: total };
  }

  function move(start, distance, angle = 0) {
    let p = copy(start);
    let f = frame(p);
    // Positive input is a right turn as seen from the snake's local up side.
    let forward = f.forward.clone().applyAxisAngle(f.normal, -angle);
    Object.assign(p, coefficients(f, forward));
    let remaining = distance;
    const segments = [], crossings = [];
    for (let guard = 0; guard < 80 && remaining > 1e-9; guard++) {
      f = frame(p);
      forward = f.forward.clone();
      const velocity = coefficients(f, forward);
      const length = Math.min(remaining, 0.025 / Math.max(Math.abs(velocity.du), Math.abs(velocity.dv), 1e-8));
      if (Math.abs(velocity.du) + Math.abs(velocity.dv) < EPS) break;
      Object.assign(p, velocity);
      let scale = 1, result = trace(p, velocity.du * length, velocity.dv * length, true);
      // UV speed changes across curved patches. Match the requested arc step
      // instead of allowing a seam or a compressed parameter region to accelerate it.
      for (let correction = 0; correction < 3 && result.distance > 1e-9; correction++) {
        const ratio = length / result.distance;
        if (Math.abs(ratio - 1) < 0.0005) break;
        scale *= clamp(ratio, 0.5, 2);
        result = trace(p, velocity.du * length * scale, velocity.dv * length * scale, true);
      }
      const aroundBoundary = mapType === 'mobius' && result.crossings.some(c =>
        c.move.dy && (c.from.gy === 0 && c.move.dy < 0 || c.from.gy === resolution - 1 && c.move.dy > 0));
      p = result.point;
      const endFrame = frame(p);
      if (aroundBoundary) forward = endFrame.forward;
      else forward.addScaledVector(endFrame.normal, -forward.dot(endFrame.normal)).normalize();
      Object.assign(p, coefficients(endFrame, forward));
      if (result.segments.length) result.segments[result.segments.length - 1].to = copy(p);
      segments.push(...result.segments); crossings.push(...result.crossings);
      remaining -= length;
    }
    return { point: p, segments, crossings };
  }

  function interpolate(a, b, t) {
    if (a.face !== b.face || a.side !== b.side || Math.abs(a.u - b.u) + Math.abs(a.v - b.v) > 0.3) return copy(t < 1 ? a : b);
    return { ...copy(t < 1 ? a : b), u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t,
      du: a.du + (b.du - a.du) * t, dv: a.dv + (b.dv - a.dv) * t,
      s: (a.s ?? 0) + ((b.s ?? 0) - (a.s ?? 0)) * t };
  }

  function images(p, reference, depth = 2) {
    const queue = [{ ...p, depth: 0 }], seen = new Set(), result = [];
    for (let i = 0; i < queue.length; i++) {
      const q = queue[i];
      const key = [q.face, q.side, q.u.toFixed(7), q.v.toFixed(7)].join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      if (q.face === reference.face && q.side === reference.side) result.push(q);
      if (q.depth >= depth) continue;
      for (const edge of edges) {
        const next = glue(q, edge);
        if (next && Math.abs(next.u - 0.5) < 2.6 && Math.abs(next.v - 0.5) < 2.6) {
          queue.push({ ...next, depth: q.depth + 1 });
        }
      }
    }
    return result;
  }

  function chartVector(reference, image, f = frame(reference)) {
    return f.du.clone().multiplyScalar(image.u - reference.u).addScaledVector(f.dv, image.v - reference.v);
  }

  function nearby(reference, target, limit = Infinity, f = frame(reference)) {
    if (chartFactory) {
      const vector = chartFactory(reference).vector(target);
      return vector && vector.length() <= limit ? [{ image: target, vector }] : [];
    }
    return images(target, reference).map(image => ({ image, vector: chartVector(reference, image, f) }))
      .filter(hit => hit.vector.length() <= limit).sort((a, b) => a.vector.lengthSq() - b.vector.lengthSq());
  }

  function samePoint(a, b, tolerance = 1e-7) {
    return images(b, a).some(q => Math.hypot(q.u - a.u, q.v - a.v) < tolerance);
  }

  function closestSegments(a, b, c, d) {
    const u = b.clone().sub(a), v = d.clone().sub(c), w = a.clone().sub(c);
    const aa = u.dot(u), bb = u.dot(v), cc = v.dot(v), dd = u.dot(w), ee = v.dot(w);
    let s = 0, t = 0;
    if (aa < 1e-15) t = clamp(ee / Math.max(cc, 1e-15), 0, 1);
    else if (cc < 1e-15) s = clamp(-dd / aa, 0, 1);
    else {
      const determinant = aa * cc - bb * bb;
      s = determinant > 1e-15 ? clamp((bb * ee - cc * dd) / determinant, 0, 1) : 0;
      t = cc > 1e-15 ? (bb * s + ee) / cc : 0;
      if (t < 0) { t = 0; s = clamp(-dd / aa, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((bb - dd) / aa, 0, 1); }
    }
    return { s, t, distance: a.clone().addScaledVector(u, s).distanceTo(c.clone().addScaledVector(v, t)) };
  }

  function contact(a, b, c, d, radius) {
    if (a.face !== b.face || c.face !== d.face || a.side !== b.side || c.side !== d.side) return null;
    const pa = a.position || pointAt(a), pb = b.position || pointAt(b);
    const pc = c.position || pointAt(c), pd = d.position || pointAt(d);
    if (closestSegments(pa, pb, pc, pd).distance > radius * 1.6) return null;
    if (chartFactory) {
      const chart = chartFactory(a);
      const end = chart.vector(b), left = chart.vector(c), right = chart.vector(d);
      if (!end || !left || !right) return null;
      if (left.distanceTo(right) > pc.distanceTo(pd) * 2 + 0.03) return null;
      const hit = closestSegments(new THREE.Vector3(), end, left, right);
      return hit.distance <= radius ? hit : null;
    }
    const f = frame(a), zero = new THREE.Vector3(), end = chartVector(a, b, f);
    const left = nearby(a, c, radius + end.length() + pc.distanceTo(pd) + 0.04, f);
    let best = null;
    for (const candidate of left) {
      const right = nearby(a, d, radius + end.length() + pc.distanceTo(pd) + 0.04, f);
      for (const other of right) {
        if (candidate.vector.distanceTo(other.vector) > pc.distanceTo(pd) * 2 + 0.03) continue;
        const hit = closestSegments(zero, end, candidate.vector, other.vector);
        if (hit.distance <= radius && (!best || hit.s < best.s)) best = hit;
      }
    }
    return best;
  }

  // Add the short contact connector before testing the homotopy class. This
  // matters when a thick snake touches across a cut rather than exactly on it.
  function closeAt(head, body) {
    if (chartFactory) return chartFactory(head).connect(body);
    const hit = nearby(head, body)[0];
    if (!hit) return null;
    return trace(head, hit.image.u - head.u, hit.image.v - head.v).point;
  }

  function seed(u, v, face = null, side = 1) {
    return { u, v, face, side, du: 1, dv: 0, topo: emptyTopology() };
  }
  return { frame, trace, move, glue, interpolate, images, nearby, samePoint, contact, closeAt, seed, pointAt, copy, reverse, oppositeSide,
    setChartFactory(factory) { chartFactory = factory; } };
}

if (typeof module !== 'undefined') module.exports = { createSurfaceNavigator };
