/* Snake on Surfaces · Copyright 2026 Xingying Li · Apache-2.0 */
'use strict';

// The square maps to a hemisphere; antipodal boundary points are identified.
// Its spherical double cover supplies a smooth metric even at cross-cap pinches.
function projectiveSpherePoint(THREE, u, v) {
  const a = 2 * u - 1, b = 2 * v - 1;
  const dx = a * Math.sqrt(Math.max(0, 1 - b * b / 2));
  const dy = b * Math.sqrt(Math.max(0, 1 - a * a / 2));
  const radius = Math.hypot(dx, dy);
  const angle = radius * Math.PI / 2;
  const factor = radius > 1e-10 ? Math.sin(angle) / radius : Math.PI / 2;
  return new THREE.Vector3(dx * factor, dy * factor, Math.cos(angle));
}

// C(x,y,z) = (2xz, .78(z²-x²), 2yz) is even, so C(s) = C(-s).
// The equator maps to a self-intersection segment with two pinch endpoints.
function crossCapPoint(THREE, s, scale = 1) {
  return new THREE.Vector3(2 * s.x * s.z, .78 * (s.z * s.z - s.x * s.x), 2 * s.y * s.z).multiplyScalar(scale);
}

function crossCapSurfacePoint(THREE, u, v, scale = 1) {
  return crossCapPoint(THREE, projectiveSpherePoint(THREE, u, v), scale);
}

function crossCapFrame(THREE, sphere, forward, scale = 1) {
  const s = sphere.clone().normalize();
  let tangent = forward.clone().addScaledVector(s, -forward.dot(s)).normalize();
  if (tangent.lengthSq() < 1e-12) {
    tangent = new THREE.Vector3(Math.abs(s.x) < .9 ? 1 : 0, Math.abs(s.x) < .9 ? 0 : 1, 0);
    tangent.addScaledVector(s, -tangent.dot(s)).normalize();
  }
  const derivative = (p, t) => new THREE.Vector3(
    2 * (t.x * p.z + p.x * t.z),
    1.56 * (p.z * t.z - p.x * t.x),
    2 * (t.y * p.z + p.y * t.z),
  );
  function directions(p, t) {
    const right = new THREE.Vector3().crossVectors(p.clone().negate(), t);
    const heading = derivative(p, t);
    return { forward: heading, normal: new THREE.Vector3().crossVectors(heading, derivative(p, right)) };
  }
  let axes = directions(s, tangent);
  if (axes.normal.lengthSq() < 1e-12 || axes.forward.lengthSq() < 1e-12) {
    // A pinch has no unique tangent plane. Use the incoming display frame;
    // movement and collisions continue on the nonsingular spherical cover.
    const previous = s.clone().addScaledVector(tangent, -.001).normalize();
    const incoming = tangent.clone().addScaledVector(previous, -tangent.dot(previous)).normalize();
    axes = directions(previous, incoming);
  }
  return { position: crossCapPoint(THREE, s, scale), normal: axes.normal.normalize(), forward: axes.forward.normalize() };
}

if (typeof module !== 'undefined') module.exports = { projectiveSpherePoint, crossCapPoint, crossCapSurfacePoint, crossCapFrame };
