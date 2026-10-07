/* Snake on Surfaces · Copyright 2026 Xingying Li · Apache-2.0 */
'use strict';

// A chart maps ONE connected surface neighbourhood to the plane. In particular,
// a projection of a 3D surface model is not enough to identify its sheet.
function createSurfaceAtlas({ THREE, navigation: nav, mapType, sphereAt, sphereToPoint, sphereScale = 1.2, implicitSurface }) {
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const finite = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);

  function createChart(reference, radius = mapType === 'genus2' ? 0.55 : 0.86, { unfold = false } = {}) {
    const origin = nav.copy(reference), f = nav.frame(origin);
    const right = new THREE.Vector3().crossVectors(f.forward, f.normal).normalize();
    const plane = vector => ({ x: vector.dot(right), y: vector.dot(f.forward) });
    const a = plane(f.du), b = plane(f.dv), det = a.x * b.y - a.y * b.x;
    const fromUV = (u, v) => ({ x: a.x * u + b.x * v, y: a.y * u + b.y * v });
    const toUV = (x, y) => ({ u: (b.y * x - b.x * y) / det, v: (a.x * y - a.y * x) / det });
    let project, unproject, tangent, displayBoundary;

    if (mapType === 'sphere' || mapType === 'projective') {
      // Normal coordinates on S², or on a hemisphere of its antipodal quotient.
      // These cover cube seams and the square's corners without planar tiling.
      const north = sphereAt(origin).normalize(), h = 1e-5;
      const su = sphereAt({ ...origin, u: origin.u + h }).sub(sphereAt({ ...origin, u: origin.u - h })).multiplyScalar(0.5 / h);
      const sv = sphereAt({ ...origin, v: origin.v + h }).sub(sphereAt({ ...origin, v: origin.v - h })).multiplyScalar(0.5 / h);
      if (mapType === 'projective') {
        const localScale = sphereScale * Math.sqrt(su.clone().cross(sv).length() / Math.max(1e-10, f.du.clone().cross(f.dv).length()));
        radius *= clamp(localScale, 0.35, 1.4);
      }
      const up = su.clone().multiplyScalar(origin.du).addScaledVector(sv, origin.dv).normalize();
      const across = new THREE.Vector3().crossVectors(north, up).normalize();
      const uvRight = toUV(1, 0);
      if (across.dot(su.clone().multiplyScalar(uvRight.u).addScaledVector(sv, uvRight.v)) < 0) across.negate();
      const maxAngle = mapType === 'projective' ? Math.PI * 0.47 : Math.PI * 0.8;
      project = target => {
        const s = sphereAt(target).normalize();
        // Antipodal representatives reverse the local side. Compare sides in
        // this chart, not the signs stored in two different square patches.
        const sign = mapType === 'projective' && s.dot(north) < 0 ? -1 : 1;
        if (target.side * sign !== origin.side) return null;
        s.multiplyScalar(sign);
        const cosine = clamp(s.dot(north), -1, 1), angle = Math.acos(cosine);
        if (angle >= maxAngle) return null;
        const scale = angle < 1e-8 ? sphereScale : sphereScale * angle / Math.sin(angle);
        return { x: s.dot(across) * scale, y: s.dot(up) * scale };
      };
      unproject = (x, y) => {
        const distance = Math.hypot(x, y), angle = distance / sphereScale;
        if (angle >= maxAngle) return null;
        const s = north.clone().multiplyScalar(Math.cos(angle));
        if (distance > 1e-10) s.addScaledVector(across, Math.sin(angle) * x / distance).addScaledVector(up, Math.sin(angle) * y / distance);
        const point = { ...nav.copy(origin), ...sphereToPoint(s) };
        if (mapType === 'projective' && sphereAt(point).dot(s) < 0) point.side *= -1;
        return point;
      };
    } else if (mapType !== 'genus2') {
      // Keep periodic coordinates within a single lift. Across the Mobius
      // strip there is no period: its display stops only at the physical edges.
      // Contact charts keep their existing neighbourhood bounds.
      const fullStrip = mapType === 'mobius' && unfold;
      const valid = image => Math.abs(image.u - origin.u) < 0.49 && (fullStrip || Math.abs(image.v - origin.v) < 0.49) &&
        (mapType !== 'mobius' || image.v >= 0 && image.v <= 1);
      project = target => {
        const image = nav.images(target, origin).find(valid);
        return image ? fromUV(image.u - origin.u, image.v - origin.v) : null;
      };
      unproject = (x, y) => {
        const uv = toUV(x, y);
        if (!finite({ x: uv.u, y: uv.v }) || !valid({ u: origin.u + uv.u, v: origin.v + uv.v })) return null;
        return nav.trace(origin, uv.u, uv.v).point;
      };
    } else {
      // The display can unfold bending neighbourhoods using their normal turn.
      // Contact charts retain the original tangent-plane projection.
      const expanded = unfold && implicitSurface;
      function projectPosition(position) {
        const q = plane(position.clone().sub(f.position));
        if (!expanded) return q;
        const cosine = clamp(implicitSurface.gradient(position).normalize().dot(f.normal), -1, 1);
        const angle = Math.acos(cosine);
        const stretch = angle < 1e-5 ? 1 : angle / Math.max(1e-6, Math.sin(angle));
        return { x: q.x * stretch, y: q.y * stretch };
      }
      function derivative(position, vector) {
        if (!expanded) return plane(vector);
        const d = projectionDifferential(position);
        return d ? { x: d.dx.dot(vector), y: d.dy.dot(vector) } : { x: 0, y: 0 };
      }
      function projectionDifferential(position) {
        const gradient = implicitSurface.gradient(position), length = gradient.length();
        if (length < 1e-8) return null;
        const normal = gradient.clone().multiplyScalar(1 / length);
        const cosine = clamp(normal.dot(f.normal), -1, 1), angle = Math.acos(cosine);
        const sine = Math.sqrt(Math.max(1e-12, 1 - cosine * cosine));
        const stretch = angle < 1e-5 ? 1 : angle / sine;
        const rate = cosine > 0.99999 ? -1 / 3 : (angle * cosine / sine - 1) / (sine * sine);
        const axis = f.normal.clone().addScaledVector(normal, -cosine), h = 1e-5;
        // A Hessian-vector product gives both projected coordinate gradients.
        const change = implicitSurface.gradient(position.clone().addScaledVector(axis, h))
          .sub(implicitSurface.gradient(position.clone().addScaledVector(axis, -h)))
          .multiplyScalar(rate / (2 * h * length));
        const raw = plane(position.clone().sub(f.position));
        return { gradient, normal, q: { x: raw.x * stretch, y: raw.y * stretch },
          dx: right.clone().multiplyScalar(stretch).addScaledVector(change, raw.x),
          dy: f.forward.clone().multiplyScalar(stretch).addScaledVector(change, raw.y) };
      }
      const rawProject = target => projectPosition(nav.pointAt(target));
      tangent = (p, vector) => derivative(nav.pointAt(p), vector);
      const positionSolutions = [{ x: 0, y: 0, position: f.position, normal: f.normal }];
      function inversePosition(x, y, useCache = true) {
        let sample = positionSolutions[0], distance = Math.hypot(x, y);
        for (const candidate of positionSolutions) {
          if (!useCache) break;
          if (candidate.x * x + candidate.y * y < 0 || Math.hypot(candidate.x, candidate.y) > Math.hypot(x, y) ||
              Math.abs(candidate.x * y - candidate.y * x) > 1e-8) continue;
          const d = Math.hypot(x - candidate.x, y - candidate.y);
          if (d < distance) { sample = candidate; distance = d; }
        }
        const start = sample;
        function solve(tx, ty, previous) {
          const position = previous.position.clone();
          for (let iteration = 0; iteration < 14; iteration++) {
            const differential = projectionDifferential(position);
            if (!differential) return null;
            const { gradient, normal, q, dx, dy } = differential;
            if (normal.dot(f.normal) < -0.65 || position.distanceTo(previous.position) > 0.12) return null;
            const errorX = tx - q.x, errorY = ty - q.y;
            const value = implicitSurface.value(position);
            const cross = dy.clone().cross(gradient), determinant = dx.dot(cross);
            if (determinant < 1e-4) return null;
            if (Math.hypot(errorX, errorY) < 2e-6 && Math.abs(value) < 1e-8) return { position, normal };
            const delta = cross.multiplyScalar(errorX)
              .addScaledVector(gradient.clone().cross(dx), errorY)
              .addScaledVector(dx.clone().cross(dy), -value).multiplyScalar(1 / determinant);
            position.add(delta.clampLength(0, 0.06));
          }
          return null;
        }
        let progress = 0, step = Math.min(1, 0.08 / Math.max(distance, 1e-8));
        while (progress < 1) {
          const nextProgress = Math.min(1, progress + step);
          const next = solve(start.x + (x - start.x) * nextProgress, start.y + (y - start.y) * nextProgress, sample);
          if (!next) {
            step *= 0.5;
            if (step * distance < 0.0005) return useCache && start !== positionSolutions[0] ? inversePosition(x, y, false) : null;
            continue;
          }
          progress = nextProgress; sample = next;
          step = Math.min(step * 1.5, 0.08 / Math.max(distance, 1e-8));
        }
        const result = { ...sample, x, y };
        if (positionSolutions.length < 600) positionSolutions.push(result);
        return result;
      }
      const solutions = [{ x: 0, y: 0, point: origin }];
      unproject = (x, y) => {
        if (!finite({ x, y }) || Math.hypot(x, y) > radius * 1.5) return null;
        let seed = solutions[0], distance = Math.hypot(x, y);
        for (const candidate of solutions) {
          // Always continue expanded UV inverses from the chart centre.
          if (expanded) break;
          const d = Math.hypot(x - candidate.x, y - candidate.y);
          if (d < distance) { seed = candidate; distance = d; }
        }
        function solveUV(previous, tx, ty) {
          let p = nav.copy(previous);
          for (let iteration = 0; iteration < 12; iteration++) {
            const pf = nav.frame(p), q = projectPosition(pf.position);
            if (pf.normal.dot(f.normal) < (expanded ? -0.65 : 0.24)) return null;
            const ex = tx - q.x, ey = ty - q.y;
            if (!expanded && Math.hypot(ex, ey) < 2e-6) return p;
            const u = derivative(pf.position, pf.du), v = derivative(pf.position, pf.dv), determinant = u.x * v.y - u.y * v.x;
            if (Math.abs(determinant) < 1e-8) return null;
            // Stop before the displayed coordinates fold over themselves.
            if (expanded && determinant * pf.du.clone().cross(pf.dv).dot(pf.normal) <= 0) return null;
            if (Math.hypot(ex, ey) < 2e-6) return p;
            let du = (v.y * ex - v.x * ey) / determinant, dv = (u.x * ey - u.y * ex) / determinant;
            const factor = Math.min(1, 0.12 / Math.max(Math.abs(du), Math.abs(dv)));
            const next = nav.trace(p, du * factor, dv * factor).point;
            if (nav.pointAt(next).distanceTo(pf.position) > 0.12) return null;
            p = next;
          }
          return null;
        }
        let p = nav.copy(seed.point);
        if (expanded) {
          let progress = 0, step = Math.min(1, 0.045 / Math.max(distance, 1e-8));
          while (progress < 1) {
            const nextProgress = Math.min(1, progress + step);
            const next = solveUV(p, x * nextProgress, y * nextProgress);
            if (!next) {
              step *= 0.5;
              if (step * distance < 0.00025) return null;
              continue;
            }
            p = next; progress = nextProgress;
            step = Math.min(step * 1.5, 0.045 / Math.max(distance, 1e-8));
          }
        } else {
          const steps = Math.max(1, Math.ceil(distance / 0.055));
          for (let step = 1; step <= steps; step++) {
            p = solveUV(p, seed.x + (x - seed.x) * step / steps, seed.y + (y - seed.y) * step / steps);
            if (!p) return null;
          }
        }
        if (distance > 0.012 && solutions.length < 600) solutions.push({ x, y, point: p });
        return p;
      };
      project = target => {
        if (target.side !== origin.side) return null;
        const q = rawProject(target);
        if (Math.hypot(q.x, q.y) > radius * 1.45 || nav.pointAt(target).distanceTo(f.position) > radius * 2) return null;
        if (expanded) {
          // The double torus is embedded. Match the point reached by continuous
          // inversion, so an overlapping projection cannot reveal another fold.
          let inverse = inversePosition(q.x, q.y);
          if (inverse && inverse.position.distanceTo(nav.pointAt(target)) >= 1e-5) inverse = inversePosition(q.x, q.y, false);
          return inverse && inverse.position.distanceTo(nav.pointAt(target)) < 1e-5 ? q : null;
        }
        const inverse = unproject(q.x, q.y);
        // Compare the abstract position, not just the 3D immersion.
        if (!inverse || !nav.samePoint(inverse, target, 0.0001)) return null;
        return q;
      };
      if (expanded) displayBoundary = angle => {
        const x = Math.cos(angle), y = Math.sin(angle);
        let lo = 0, hi = radius, sample = inversePosition(x * hi, y * hi);
        if (!sample) {
          for (let i = 0; i < 9; i++) {
            const mid = (lo + hi) / 2;
            if (inversePosition(x * mid, y * mid)) lo = mid; else hi = mid;
          }
          hi = lo * 0.99; sample = inversePosition(x * hi, y * hi);
        }
        return { x: x * hi, y: y * hi, position: sample?.position || f.position, normal: sample?.normal || f.normal };
      };
    }

    function contains(q) { return finite(q) && Math.hypot(q.x, q.y) < radius; }
    function implicitBoundary(angle) {
      const x = Math.cos(angle), y = Math.sin(angle);
      const ray = right.clone().multiplyScalar(x).addScaledVector(f.forward, y);
      // In this chart the surface is a graph over the tangent plane. Follow
      // that graph from the origin, solving only its height, without repeatedly
      // converting the border through the polycube's UV patches.
      function solve(distance, previous) {
        let height = previous.height;
        for (let i = 0; i < 8; i++) {
          const position = f.position.clone().addScaledVector(ray, distance).addScaledVector(f.normal, height);
          const gradient = implicitSurface.gradient(position), derivative = gradient.dot(f.normal);
          // Let the visible patch turn farther while retaining a margin above
          // the inverse projection's 0.24 cutoff and rejecting branch jumps.
          if (derivative < gradient.length() * 0.5 || position.distanceTo(previous.position) > 0.12) return null;
          const value = implicitSurface.value(position);
          if (Math.abs(value) < 1e-8) return { position, normal: gradient.normalize(), height };
          height -= clamp(value / derivative, -0.08, 0.08);
        }
        return null;
      }
      let distance = 0, sample = { position: f.position, normal: f.normal, height: 0 };
      while (distance < radius) {
        const nextDistance = Math.min(radius, distance + 0.025), next = solve(nextDistance, sample);
        if (next) { distance = nextDistance; sample = next; continue; }
        let lo = distance, hi = nextDistance;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2, candidate = solve(mid, sample);
          if (candidate) { lo = mid; sample = candidate; } else hi = mid;
        }
        distance = lo; break;
      }
      return { x: x * distance, y: y * distance, position: sample.position, normal: sample.normal };
    }
    function boundaryPoint(angle) {
      if (displayBoundary) return displayBoundary(angle);
      if (mapType === 'genus2' && implicitSurface && !unfold) return implicitBoundary(angle);
      const x = Math.cos(angle), y = Math.sin(angle);
      let lo = 0, hi = radius, p = unproject(x * hi, y * hi);
      if (!p) {
        for (let step = 0; step < 9; step++) {
          const mid = (lo + hi) / 2;
          if (unproject(x * mid, y * mid)) lo = mid; else hi = mid;
        }
        hi = lo * 0.99; p = unproject(x * hi, y * hi);
      }
      return { x: x * hi, y: y * hi, point: p || origin };
    }
    function outline(count = 48) {
      return Array.from({ length: count + 1 }, (_, i) => boundaryPoint(i / count * Math.PI * 2));
    }
    function directionAt(p) {
      const q = project(p), next = project(nav.move(p, 0.002).point);
      if (!q || !next) return { x: 0, y: 1 };
      const distance = Math.hypot(next.x - q.x, next.y - q.y);
      return distance > 1e-9 ? { x: (next.x - q.x) / distance, y: (next.y - q.y) / distance } : { x: 0, y: 1 };
    }
    function footprint(p) {
      const pf = nav.frame(p), q = project(p);
      if (!q) return null;
      const across = new THREE.Vector3().crossVectors(pf.forward, pf.normal).normalize();
      function derivative(vector) {
        if (tangent) return tangent(p, vector);
        const aa = pf.du.dot(pf.du), ab = pf.du.dot(pf.dv), bb = pf.dv.dot(pf.dv), determinant = aa * bb - ab * ab;
        const x = pf.du.dot(vector), y = pf.dv.dot(vector), h = 0.00002;
        const next = nav.trace(p, (bb * x - ab * y) / determinant * h, (aa * y - ab * x) / determinant * h).point;
        const r = project(next);
        return r ? { x: (r.x - q.x) / h, y: (r.y - q.y) / h } : { x: 0, y: 0 };
      }
      return { right: derivative(across), forward: derivative(pf.forward) };
    }
    function connect(target) {
      if (mapType === 'projective' && nav.samePoint(origin, target)) return nav.copy(origin);
      const q = project(target);
      if (!q) return null;
      if (mapType !== 'projective') return unproject(q.x, q.y);
      // Track the lift of the short spherical connector through the original
      // cuts. Returning only its endpoint would drop its homotopy contribution.
      let p = nav.copy(origin);
      const steps = Math.max(1, Math.ceil(Math.hypot(q.x, q.y) / 0.025));
      for (let i = 1; i <= steps; i++) {
        const next = unproject(q.x * i / steps, q.y * i / steps);
        const image = nav.images(next, p).sort((a, b) =>
          Math.hypot(a.u - p.u, a.v - p.v) - Math.hypot(b.u - p.u, b.v - p.v))[0];
        if (!image) return null;
        p = nav.trace(p, image.u - p.u, image.v - p.v).point;
      }
      return p;
    }
    let metric = null;
    function vector(target) {
      const q = project(target);
      if (!q || Math.hypot(q.x, q.y) > radius) return null;
      if (!metric) {
        const h = 0.0002, x = unproject(h, 0), y = unproject(0, h);
        if (!x || !y) return null;
        metric = { x: nav.pointAt(x).sub(f.position).multiplyScalar(1 / h), y: nav.pointAt(y).sub(f.position).multiplyScalar(1 / h) };
      }
      return metric.x.clone().multiplyScalar(q.x).addScaledVector(metric.y, q.y);
    }
    return { origin, radius, frame: f, project, unproject, contains, outline, boundaryPoint, directionAt, footprint, connect, vector };
  }

  return { createChart };
}

if (typeof module !== 'undefined') module.exports = { createSurfaceAtlas };
