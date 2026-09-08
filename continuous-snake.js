/* Snake on Surfaces · Copyright 2026 Xingying Li · Apache-2.0 */
'use strict';

// Time-based motion and a trail measured in world-space arc length. Rendering,
// frame rate and keyboard repeat events never determine the game trajectory.
function createContinuousSnake({ navigation: nav, classifyLoop, randomPoint, onEvent = () => {},
  radius = 0.052, initialLength = 1.4, initialSpeed = 0.9, turnRate = 4,
  random = Math.random, foodWeights = { grow: 52, slow: 12, shrink: 24, speedUp: 12 } }) {
  const STEP = 1 / 120, SPACING = 0.065, FOOD_LIFETIME = 33;
  let trail = [], foods = [], head, length = initialLength, speed = initialSpeed;
  let score = 0, running = true, paused = false, accumulator = 0, spawnClock = 0;
  let turn = 0, contactCooldown = 0, lastClosure = null, revision = 0;
  let renderSnake = [], renderRevision = -1;

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
      if (!occupied) { foods.push({ ...p, position, type, age: 0 }); return; }
    }
  }

  function reset(start) {
    length = initialLength; speed = initialSpeed; score = 0; running = true; paused = false;
    accumulator = spawnClock = contactCooldown = 0; turn = 0; lastClosure = null; foods = [];
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
    revision++; onEvent({ type: 'reset' });
  }

  function append(segments) {
    for (const segment of segments) {
      head = node(segment.to, head.s + segment.length);
      trail.push(head);
    }
  }

  function eat(food) {
    if (food.type === 'grow') { score++; length += 0.38; }
    else if (food.type === 'shrink') length = Math.max(0.45, length - 0.45);
    else if (food.type === 'slow') speed = Math.max(0.35, speed * 0.86);
    else if (food.type === 'speedUp') speed = Math.min(2.5, speed * 1.16);
    foods.splice(foods.indexOf(food), 1);
    onEvent({ type: food.type, score });
  }

  function step(dt) {
    contactCooldown = Math.max(0, contactCooldown - dt);
    for (const food of foods) food.age += dt;
    foods = foods.filter(food => food.age < FOOD_LIFETIME);
    spawnClock += dt;
    if (foods.length < 3 || spawnClock >= 3.6) { spawnFood(); spawnClock = 0; }
    const result = nav.move(head, speed * dt, turn * turnRate * dt);
    for (const segment of result.segments) {
      if (segment.transition) { append([segment]); continue; }
      segment.from.position = nav.pointAt(segment.from);
      segment.to.position = nav.pointAt(segment.to);
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
          lastClosure = classifyLoop(bodyPoint.topo, joined.topo);
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
      for (let s = head.s; s > trail[0].s; s -= SPACING) renderSnake.push(sampleAt(s));
      renderSnake.push(nav.copy(trail[0]));
      renderRevision = revision;
    }
    return { snake: renderSnake, foods, direction: { dx: head.du, dy: head.dv },
      running, paused, score, speed, scale: 1, continuous: true, radius, spacing: SPACING,
      foodLifetime: FOOD_LIFETIME, lastClosure, length, head, trail };
  }
  return { reset, update, state, sampleAt, setTurn(value) { turn = Math.max(-1, Math.min(1, value)); },
    setPaused(value) { paused = value; accumulator = 0; }, togglePause() { paused = !paused; accumulator = 0; } };
}

if (typeof module !== 'undefined') module.exports = { createContinuousSnake };
