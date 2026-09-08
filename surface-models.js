/* Snake on Surfaces · Copyright 2026 Xingying Li · Apache-2.0 */
'use strict';

// Bryant–Kusner immersion of RP². Unlike a cross-cap, it has no pinch points.
// Formula: https://drorbn.net/AcademicPensieve/2013-04/nb/Boy.pdf
// The same square and antipodal boundary identifications are used by the game.
function boySurfacePoint(THREE, u, v, scale = 1) {
  const a = 2 * u - 1, b = 2 * v - 1;
  const dx = a * Math.sqrt(Math.max(0, 1 - b * b / 2));
  const dy = b * Math.sqrt(Math.max(0, 1 - a * a / 2));
  const radius = Math.hypot(dx, dy);
  // Stereographic radius for the hemisphere coordinates used by the atlas.
  const factor = radius > 1e-10 ? Math.tan(Math.PI * radius / 4) / radius : Math.PI / 4;
  const x = dx * factor, y = dy * factor;
  const multiply = (p, q) => [p[0] * q[0] - p[1] * q[1], p[0] * q[1] + p[1] * q[0]];
  const w = [x, y], w2 = multiply(w, w), w3 = multiply(w2, w), w4 = multiply(w2, w2), w6 = multiply(w3, w3);
  const dr = w6[0] + Math.sqrt(5) * w3[0] - 1, di = w6[1] + Math.sqrt(5) * w3[1];
  const d2 = dr * dr + di * di;
  const n1 = multiply(w, [1 - w4[0], -w4[1]]), n2 = multiply(w, [1 + w4[0], w4[1]]);
  const g1 = -1.5 * (n1[1] * dr - n1[0] * di);
  const g2 = -1.5 * (n2[0] * dr + n2[1] * di);
  const g3 = w6[1] * dr - (1 + w6[0]) * di - 0.5 * d2;
  const denominator = g1 * g1 + g2 * g2 + g3 * g3;
  // The three poles of the minimal surface become the regular triple point
  // after inversion. Keep that finite limit instead of dividing by zero.
  const inversion = denominator > 1e-28 ? d2 / denominator : 0;
  return new THREE.Vector3(g1 * inversion * scale, (g3 * inversion + 0.8) * scale, g2 * inversion * scale);
}

if (typeof module !== 'undefined') module.exports = { boySurfacePoint };
