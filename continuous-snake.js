/* Snake on Surfaces · Copyright 2026 Xingying Li · Apache-2.0 */
'use strict';

// Time-based motion and a trail measured in the navigation metric. Rendering,
// frame rate and keyboard repeat events never determine the game trajectory.
function createContinuousSnake({ navigation: nav, classifyLoop, randomPoint, onEvent = () => {},
  radius = 0.052, segmentLength = 0.15, initialLength = segmentLength * 4, initialSpeed = 0.9, turnRate = 4,
  portalSettings = null, random = Math.random, foodWeights = { grow: 52, slow: 12, shrink: 24, speedUp: 12 } }) {
  const STEP = 1 / 120, SPACING = 0.05, FOOD_LIFETIME = 33;
  const portalConfig = portalSettings && { interval: 5, chance: 0.4, lifetime: 60, maxCount: 2,
    radius: 0.08, initialCount: 1, ...portalSettings };
  let trail = [], foods = [], head, length = initialLength, speed = initialSpeed;
  let score = 0, running = true, paused = false, accumulator = 0, spawnClock = 0;
  let turn = 0, contactCooldown = 0, lastClosure = null, revision = 0;
  let renderSnake = [], segmentJoints = [], renderRevision = -1;
  let portals = [], passages = [], portalClock = 0, nextPortalId = 1, lockedPortal = null;

  function node(p, s) { return { ...nav.copy(p), s, position: nav.pointAt(p) }; }

  function sampleAt(s) {
    if (s <= trail[0].s) return nav.copy(trail[0]);
    if (s >= trail[trail.length - 1].s) return nav.copy(trail[trail.length - 1]);
    let lo = 0, hi = trail.length - 1;
    while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (trail[mid].s <= s) lo = mid; else hi = mid; }
    const a = trail[lo], b = trail[hi];
    return nav.interpolate(a, b, (s - a.s) / Math.max(b.s - a.s, 1e-12));
  }

  function trim() {
    const tailS = head.s - length;
    let keep = 0;
    while (keep + 1 < trail.length && trail[keep + 1].s < tailS) keep++;
    if (keep) trail.splice(0, keep);
    if (trail.length > 1 && trail[0].s < tailS) trail[0] = node(sampleAt(tailS), tailS);
    passages = passages.filter(passage => passage.s + passage.length >= trail[0].s);
  }

  // A portal is accessible from either lift, while ordinary contacts stay on
  // one local side. Passing through it projects to a constant path on RP².
  function nearPortal(point, portal, distance) {
    const position = point.position || nav.pointAt(point);
    return [portal, nav.oppositeSide(portal)].some(target =>
      position.distanceTo(target.position || nav.pointAt(target)) <= distance * 1.6 &&
      nav.nearby(point, target, distance).length > 0);
  }

  function spawnPortal(preferred = null) {
    if (!portalConfig || portals.length >= portalConfig.maxCount) return false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const point = attempt === 0 && preferred ? preferred : randomPoint(random);
      const distance = portalConfig.radius + radius * 3;
      if ([...trail, ...foods].some(item => nearPortal(point, item, distance)) ||
          portals.some(portal => nearPortal(point, portal, portalConfig.radius * 3))) continue;
      portals.push({ ...nav.copy(point), id: nextPortalId++, radius: portalConfig.radius,
        age: 0, lifetime: portalConfig.lifetime, heldActive: false });
      return true;
    }
    return false;
  }

  function updatePortals(dt) {
    if (!portalConfig) return;
    for (const portal of portals) {
      portal.age += dt;
      portal.heldActive = passages.some(passage => passage.portalId === portal.id);
    }
    portals = portals.filter(portal => portal.age < portal.lifetime || portal.heldActive);
    if (lockedPortal && !nearPortal(head, lockedPortal, lockedPortal.radius + radius)) lockedPortal = null;
    portalClock += dt;
    if (portalClock + 1e-12 >= portalConfig.interval) {
      portalClock -= portalConfig.interval;
      if (portals.length < portalConfig.maxCount && random() < portalConfig.chance) spawnPortal();
    }
  }

  function portalContact(segment) {
    let closest = null;
    for (const portal of portals) {
      if (portal.id === lockedPortal?.id) continue;
      for (const target of [portal, nav.oppositeSide(portal)]) {
        const hit = nav.contact(segment.from, segment.to, target, target, portal.radius * 0.55);
        if (hit && (!closest || hit.s < closest.hit.s)) closest = { portal, hit };
      }
    }
    return closest;
  }

  function spawnFood() {
    if (foods.length >= 9) return;
    const total = Object.values(foodWeights).reduce((a, b) => a + b, 0);
    let choice = random() * total, type = 'grow';
    for (const [key, weight] of Object.entries(foodWeights)) { choice -= weight; if (choice <= 0) { type = key; break; } }
    for (let attempt = 0; attempt < 100; attempt++) {
      const p = randomPoint(random), position = nav.pointAt(p);
      const occupied = [...trail, ...foods].some(item => {
        const world = item.position || nav.pointAt(item);
        return world.distanceTo(position) < radius * 4 && nav.nearby(p, item, radius * 3).length > 0;
      });
      if (!occupied && !portals.some(portal => nearPortal(p, portal, portal.radius + radius * 2))) {
        foods.push({ ...p, position, type, age: 0 }); return;
      }
    }
  }

  function reset(start) {
    length = initialLength; speed = initialSpeed; score = 0; running = true; paused = false;
    accumulator = spawnClock = contactCooldown = 0; turn = 0; lastClosure = null; foods = [];
    portals = []; passages = []; portalClock = 0; nextPortalId = 1; lockedPortal = null;
    // Reverse the recorded backward path itself. Re-integrating it forward
    // introduces drift at curved seams and can move the chosen starting point.
    let p = nav.copy(start);
    p.du *= -1; p.dv *= -1;
    const backward = [];
    for (let d = 0; d < initialLength; d += 0.01) {
      const result = nav.move(p, Math.min(0.01, initialLength - d));
      backward.push(...result.segments); p = result.point;
    }
    const reverse = p => nav.reverse(p, start);
    trail = [node(reverse(p), 0)]; head = trail[0];
    append(backward.reverse().map(segment => ({ ...segment, from: reverse(segment.to), to: reverse(segment.from) })));
    head = node(start, head.s); trail[trail.length - 1] = head; trim();
    for (let i = 0; i < 4; i++) spawnFood();
    if (portalConfig) for (let i = 0; i < portalConfig.initialCount; i++) {
      spawnPortal(i === 0 ? nav.move(head, 0.65, 0.3).point : null);
    }
    revision++; onEvent({ type: 'reset' });
  }

  function append(segments) {
    for (const segment of segments) {
      head = node(segment.to, head.s + segment.length);
      trail.push(head);
    }
  }

  function eat(food) {
    if (food.type === 'grow') { score++; length += segmentLength; }
    else if (food.type === 'shrink') length = Math.max(0.45, length - 0.45);
    else if (food.type === 'slow') speed = Math.max(0.35, speed * 0.86);
    else if (food.type === 'speedUp') speed = Math.min(2.5, speed * 1.16);
    foods.splice(foods.indexOf(food), 1);
    onEvent({ type: food.type, score });
  }

  function step(dt) {
    contactCooldown = Math.max(0, contactCooldown - dt);
    updatePortals(dt);
    for (const food of foods) food.age += dt;
    foods = foods.filter(food => food.age < FOOD_LIFETIME);
    spawnClock += dt;
    if (foods.length < 3 || spawnClock >= 3.6) { spawnFood(); spawnClock = 0; }
    const result = nav.move(head, speed * dt, turn * turnRate * dt);
    for (let index = 0; index < result.segments.length; index++) {
      let segment = result.segments[index];
      if (segment.transition) { append([segment]); continue; }
      segment.from.position = nav.pointAt(segment.from);
      segment.to.position = nav.pointAt(segment.to);
      const entry = portalContact(segment);
      if (entry) {
        const point = nav.interpolate(segment.from, segment.to, entry.hit.s);
        const rest = { from: point, to: segment.to, length: segment.length * (1 - entry.hit.s) };
        segment = { from: segment.from, to: point, length: segment.length * entry.hit.s };
        if (rest.length > 1e-12) result.segments.splice(index + 1, 0, rest);
      }
      let collision = null;
      if (contactCooldown === 0) {
        for (let i = 0; i + 1 < trail.length; i++) {
          const a = trail[i], b = trail[i + 1];
          if (head.s - b.s < Math.max(radius * 6, 0.32) || b.s <= a.s) continue;
          const hit = nav.contact(segment.from, segment.to, a, b, radius * 1.65);
          if (hit && (!collision || hit.s < collision.hit.s)) collision = { hit, a, b };
        }
      }
      if (collision) {
        const { hit, a, b } = collision;
        const bodyPoint = nav.interpolate(a, b, hit.t);
        const headPoint = nav.interpolate(segment.from, segment.to, hit.s);
        const joined = nav.closeAt(headPoint, bodyPoint);
        if (joined && nav.samePoint(joined, bodyPoint, 0.001)) {
          lastClosure = classifyLoop(bodyPoint.topo, joined.topo, { from: bodyPoint, to: joined });
          append([{ from: segment.from, to: headPoint, length: segment.length * hit.s }]);
          length = Math.max(0.32, head.s - bodyPoint.s);
          trim();
          if (lastClosure.nontrivial) { running = false; onEvent({ type: 'win', info: lastClosure }); }
          else { contactCooldown = 0.6; onEvent({ type: 'cut', info: lastClosure }); }
          revision++; return;
        }
      }
      for (const food of [...foods]) {
        if (nav.contact(segment.from, segment.to, food, food, radius * 1.9)) eat(food);
      }
      append([segment]);
      if (entry) {
        const from = nav.copy(head), to = nav.oppositeSide(head);
        passages.push({ portalId: entry.portal.id, s: head.s, length: entry.portal.radius * 1.2, from, to });
        entry.portal.heldActive = true;
        lockedPortal = entry.portal;
        // Keep the exact side change in the trail; the body follows it as its
        // arc-length samples reach this point. The homotopy prefix is unchanged.
        append([{ from, to, length: 0, transition: true }]);
        for (let j = index + 1; j < result.segments.length; j++) {
          result.segments[j] = { ...result.segments[j], from: nav.oppositeSide(result.segments[j].from),
            to: nav.oppositeSide(result.segments[j].to) };
        }
        result.point = nav.oppositeSide(result.point);
        onEvent({ type: 'portal', portalId: entry.portal.id });
      }
    }
    head = node(result.point, head.s);
    trail[trail.length - 1] = head;
    trim(); revision++;
    for (const crossing of result.crossings) onEvent({ type: 'crossing', ...crossing });
  }

  function update(elapsed) {
    if (!running || paused) { accumulator = 0; return; }
    accumulator += Math.min(Math.max(elapsed, 0), 0.1);
    while (accumulator + 1e-12 >= STEP && running) { step(STEP); accumulator -= STEP; }
  }

  function state() {
    if (revision !== renderRevision) {
      renderSnake = [];
      const available = head.s - trail[0].s;
      for (let i = 0; i * SPACING < available - 1e-8; i++) renderSnake.push(sampleAt(head.s - i * SPACING));
      renderSnake.push(nav.copy(trail[0]));
      // Visible sections are independent of the finer path/render samples.
      // Growth fills the new tail section as the snake continues moving.
      segmentJoints = [];
      for (let i = 1; i * segmentLength < available - 0.0001; i++) segmentJoints.push(sampleAt(head.s - i * segmentLength));
      renderRevision = revision;
    }
    return { snake: renderSnake, segmentLength, segmentJoints, foods, portals, passages, portalConfig, direction: { dx: head.du, dy: head.dv },
      running, paused, score, speed, scale: 1, continuous: true, radius, spacing: SPACING,
      foodLifetime: FOOD_LIFETIME, lastClosure, length, head, trail };
  }
  return { reset, update, state, sampleAt, setTurn(value) { turn = Math.max(-1, Math.min(1, value)); },
    setPaused(value) { paused = value; accumulator = 0; }, togglePause() { paused = !paused; accumulator = 0; } };
}

if (typeof module !== 'undefined') module.exports = { createContinuousSnake };
