// Solmar Bay — arcade vehicle physics (pure, no three.js). One model drives
// the player car, traffic, parked cars and police: velocity is split into a
// forward and a lateral part each step, and tyre grip bleeds the lateral part
// away — the handbrake slashes grip, which is what makes a powerslide.
import { VEHICLES } from './config.js';

// Heading 0 points along +X; forward = (cos h, 0, -sin h).
export function forwardOf(heading) { return { x: Math.cos(heading), z: -Math.sin(heading) }; }
export function rightOf(heading) { return { x: Math.sin(heading), z: Math.cos(heading) }; }

export function createVehicle(profileKey, x, z, heading) {
  const profile = VEHICLES[profileKey];
  return {
    profileKey, profile,
    x, z, heading,
    vx: 0, vz: 0,
    speed: 0,           // signed forward speed, m/s
    steer: 0,           // smoothed steering angle
    health: 100,
    color: profile.color,
    width: 2.0, length: 4.4,
    crashed: 0,         // seconds of post-crash wobble left
  };
}

// input: { throttle: -1..1, steer: -1..1, handbrake: bool }. dt in seconds.
// collide(x, z, radius) pushes the car out of buildings and returns the
// impact speed along the surface normal (0 when nothing was hit).
export function stepVehicle(v, input, dt, collide) {
  const p = v.profile;
  const fwd = forwardOf(v.heading);
  // Signed forward speed from the velocity vector.
  let forwardSpeed = v.vx * fwd.x + v.vz * fwd.z;
  const rgt = rightOf(v.heading);
  let lateralSpeed = v.vx * rgt.x + v.vz * rgt.z;

  // Steering: sharper at low speed, gentle at the top end.
  const steerTarget = input.steer * p.steer * (1 - Math.min(0.7, Math.abs(forwardSpeed) / p.topSpeed * 0.7));
  v.steer += (steerTarget - v.steer) * Math.min(1, dt * 8);
  // Heading rate grows with forward speed, so the car turns in proportion
  // to how far it travels — with a floor, so a stopped car can still turn
  // its wheels and work itself out of a corner instead of grinding a wall.
  // The rate gives a ~5 m turning radius at full lock: a U-turn fits in
  // a 12 m road; at speed the lock itself shrinks, so fast corners stay wide.
  const turnSpeed = Math.max(Math.abs(forwardSpeed), 2);
  v.heading += v.steer * turnSpeed * 0.35 * dt;

  // Throttle / brake / reverse.
  if (input.throttle > 0) forwardSpeed += p.accel * input.throttle * dt;
  else if (input.throttle < 0) {
    if (forwardSpeed > 0.5) forwardSpeed -= p.brake * dt;
    else forwardSpeed += p.accel * 0.55 * input.throttle * dt; // reverse
  } else {
    forwardSpeed -= Math.sign(forwardSpeed) * Math.min(Math.abs(forwardSpeed), 6 * dt);
  }
  // Drag and the top-speed cap.
  forwardSpeed -= forwardSpeed * 0.25 * dt;
  forwardSpeed = Math.max(-p.topSpeed * 0.45, Math.min(p.topSpeed, forwardSpeed));

  // Grip bleeds lateral velocity away; the handbrake cuts grip hard.
  const grip = input.handbrake ? p.grip * 0.22 : p.grip;
  lateralSpeed -= lateralSpeed * Math.min(1, grip * dt);
  if (input.handbrake) forwardSpeed -= forwardSpeed * 0.35 * dt;

  const f2 = forwardOf(v.heading);
  const r2 = rightOf(v.heading);
  v.vx = f2.x * forwardSpeed + r2.x * lateralSpeed;
  v.vz = f2.z * forwardSpeed + r2.z * lateralSpeed;
  v.speed = forwardSpeed;

  const nx = v.x + v.vx * dt;
  const nz = v.z + v.vz * dt;
  let impact = 0;
  if (collide) impact = collide(v, nx, nz);
  else { v.x = nx; v.z = nz; }
  if (impact > 0) {
    // Kill the velocity component that ran into the wall, keep the slide.
    const f3 = forwardOf(v.heading);
    const into = v.vx * f3.x + v.vz * f3.z;
    v.vx -= f3.x * into * 0.4;
    v.vz -= f3.z * into * 0.4;
    v.speed = v.vx * f3.x + v.vz * f3.z;
    v.crashed = Math.min(0.5, impact * 0.03);
    v.health = Math.max(0, v.health - crashDamage(impact));
  }
  if (v.crashed > 0) v.crashed -= dt;
  return impact;
}

// Damage above a free-bump threshold, growing with impact speed.
export function crashDamage(impactSpeed) {
  if (impactSpeed < 6) return 0;
  return Math.min(30, (impactSpeed - 6) * 1.6);
}

// Circle-vs-AABB push-out for one vehicle against the city's colliders.
// Returns impact speed (0 when clear). Mutates v.x / v.z.
export function collideVehicle(v, nx, nz, queryColliders) {
  const r = 1.6;
  let impact = 0;
  let x = nx, z = nz;
  for (const c of queryColliders(x, z, r + 2)) {
    const cx = Math.max(c.x - c.hw, Math.min(x, c.x + c.hw));
    const cz = Math.max(c.z - c.hd, Math.min(z, c.z + c.hd));
    const dx = x - cx, dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    const d = Math.sqrt(d2) || 0.001;
    const push = r - d;
    x += (dx / d) * push;
    z += (dz / d) * push;
    // Impact speed is how fast we were closing on the wall.
    const closing = Math.abs(v.vx * (dx / d) + v.vz * (dz / d));
    if (closing > impact) impact = closing;
  }
  v.x = x; v.z = z;
  return impact;
}

// Circle-vs-circle separation for two vehicles (momentum-ish exchange).
export function separateVehicles(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const minD = (a.length + b.length) / 2 * 0.8;
  const d2 = dx * dx + dz * dz;
  if (d2 >= minD * minD || d2 < 0.0001) return 0;
  const d = Math.sqrt(d2);
  const push = (minD - d) / 2;
  const ux = dx / d, uz = dz / d;
  a.x -= ux * push; a.z -= uz * push;
  b.x += ux * push; b.z += uz * push;
  const closing = Math.abs((b.vx - a.vx) * ux + (b.vz - a.vz) * uz);
  // Exchange a little velocity along the contact normal.
  const ex = (b.vx - a.vx) * ux * 0.3, ez = (b.vz - a.vz) * uz * 0.3;
  a.vx += ex * ux; a.vz += ez * uz;
  b.vx -= ex * ux; b.vz -= ez * uz;
  return closing;
}
