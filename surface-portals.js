/* Snake on Surfaces · Copyright 2026 Xingying Li · Apache-2.0 */
'use strict';

// A translucent signal on each local side of the intact surface. No surface
// geometry or material is cut: teleportation only changes the snake's side.
function createSurfacePortals({ THREE, parent, atlas, frameAt, getState }) {
  const group = new THREE.Group();
  group.name = 'surface-portals';
  parent.add(group);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.translate(128, 128);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 128);
  glow.addColorStop(0, 'rgba(166,238,255,.15)');
  glow.addColorStop(.65, 'rgba(125,218,255,.08)');
  glow.addColorStop(.87, 'rgba(146,238,255,.48)');
  glow.addColorStop(1, 'rgba(146,238,255,0)');
  ctx.fillStyle = glow; ctx.fillRect(-128, -128, 256, 256);
  ctx.strokeStyle = 'rgba(92,212,249,.85)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, 110, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowColor = '#9eeeff'; ctx.shadowBlur = 16;
  ctx.lineCap = 'round'; ctx.strokeStyle = '#e8fcff'; ctx.lineWidth = 7;
  for (const start of [0, Math.PI]) {
    ctx.beginPath(); ctx.arc(0, 0, 110, start, start + Math.PI * .65); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(171,222,255,.8)';
    ctx.beginPath(); ctx.arc(0, 0, 75, start + .5, start + 1.7); ctx.stroke();
    ctx.lineWidth = 7; ctx.strokeStyle = '#e8fcff';
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.center.set(.5, .5);
  const entries = new Map();

  function create(portal) {
    const marker = new THREE.Group();
    marker.name = 'portal-marker';
    const chart = atlas.createChart(portal), rings = 4, segments = 48;
    const frames = [frameAt(portal)], uvs = [.5, .5], indices = [];
    for (let ring = 1; ring <= rings; ring++) for (let i = 0; i < segments; i++) {
      const angle = i / segments * Math.PI * 2;
      const x = Math.cos(angle) * ring / rings, y = Math.sin(angle) * ring / rings;
      frames.push(frameAt(chart.unproject(x * portal.radius, y * portal.radius)));
      uvs.push(.5 + x * .5, .5 + y * .5);
    }
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      indices.push(0, 1 + i, 1 + next);
      for (let ring = 1; ring < rings; ring++) {
        const a = 1 + (ring - 1) * segments + i, b = 1 + (ring - 1) * segments + next;
        indices.push(a, a + segments, b, b, a + segments, b + segments);
      }
    }
    const map = texture.clone();
    const material = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, opacity: .9, toneMapped: false });
    // A shallow 3D rim stays legible at grazing angles without enlarging the
    // portal footprint. Both local sides keep ordinary surface occlusion.
    const rimMaterial = new THREE.MeshBasicMaterial({ color: 0x259fc8, transparent: true,
      opacity: .9, depthWrite: false, toneMapped: false });
    const coreMaterial = new THREE.MeshBasicMaterial({ color: 0xd5fbff, transparent: true,
      opacity: .98, depthWrite: false, toneMapped: false });
    const rimFrames = Array.from({ length: segments }, (_, i) => {
      const angle = i / segments * Math.PI * 2;
      return frameAt(chart.unproject(Math.cos(angle) * portal.radius * .86, Math.sin(angle) * portal.radius * .86));
    });
    const particleGeometry = new THREE.SphereGeometry(.006, 8, 6), particles = [];
    for (const side of [1, -1]) {
      const positions = frames.flatMap(frame => frame.position.clone().addScaledVector(frame.normal, .014 * side).toArray());
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'portal-glow'; mesh.renderOrder = 3;
      marker.add(mesh);
      const points = rimFrames.map(frame => frame.position.clone().addScaledVector(frame.normal, .018 * side));
      const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
      for (const [width, ringMaterial, order] of [[.006, rimMaterial, 4], [.0028, coreMaterial, 5]]) {
        const ring = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, width, 6, true), ringMaterial);
        ring.name = 'portal-rim'; ring.renderOrder = order;
        marker.add(ring);
      }
      for (let i = 0; i < 2; i++) {
        const particle = new THREE.Mesh(particleGeometry, coreMaterial);
        particle.name = 'portal-spark'; particle.renderOrder = 5;
        marker.add(particle);
        particles.push({ mesh: particle, frame: rimFrames[i * segments / 2], side,
          phase: i * .5 + (side < 0 ? .25 : 0) });
      }
    }
    group.add(marker);
    return { marker, material, map, portal, rimMaterial, coreMaterial, particles };
  }

  function update() {
    const state = getState(), alive = new Map(state.portals.map(portal => [portal.id, portal]));
    for (const [id, entry] of entries) if (alive.get(id) !== entry.portal) {
      group.remove(entry.marker);
      new Set(entry.marker.children.map(mesh => mesh.geometry)).forEach(geometry => geometry.dispose());
      entry.material.dispose(); entry.rimMaterial.dispose(); entry.coreMaterial.dispose();
      entry.map.dispose(); entries.delete(id);
    }
    for (const portal of state.portals) {
      if (!entries.has(portal.id)) entries.set(portal.id, create(portal));
      const { material, map, rimMaterial, coreMaterial, particles } = entries.get(portal.id);
      const fading = portal.lifetime - portal.age < 4;
      const pulse = reducedMotion ? 0 : Math.sin(portal.age * 3);
      material.color.setHex(fading ? 0xffc8a0 : 0xffffff);
      material.opacity = portal.heldActive ? .98 + .02 * pulse : .92 + .06 * pulse;
      rimMaterial.color.setHex(fading ? 0xdf9867 : 0x259fc8);
      coreMaterial.color.setHex(fading ? 0xffecd1 : 0xd5fbff);
      rimMaterial.opacity = .88 + .08 * pulse;
      coreMaterial.opacity = .95 + .05 * pulse;
      map.rotation = reducedMotion ? 0 : portal.age * .65;
      for (const particle of particles) {
        const phase = reducedMotion ? .4 : (portal.age * .9 + particle.phase) % 1;
        particle.mesh.position.copy(particle.frame.position).addScaledVector(particle.frame.normal,
          particle.side * (.024 + phase * .055));
        particle.mesh.scale.setScalar(reducedMotion ? .7 : .2 + .8 * Math.sin(Math.PI * phase));
      }
    }
  }
  return { group, update };
}

if (typeof module !== 'undefined') module.exports = { createSurfacePortals };
