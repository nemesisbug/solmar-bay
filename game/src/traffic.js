// Solmar Bay — traffic, parked cars and police. Traffic drives the road
// graph: each car follows a route of intersection nodes on the right-hand
// lane and brakes for the car ahead. Police are the same vehicle model with
// a pursuit driver: they steer toward where the player will be, ram to slow
// them, and sit on a slow player to bust them.
import { TRAFFIC_COUNT, PARKED_COUNT, CITY } from './config.js';
import { createVehicle, stepVehicle, separateVehicles, collideVehicle, forwardOf } from './vehicles.js';

const TRAFFIC_PROFILES = ['sedan', 'sedan', 'taxi', 'van', 'sports', 'sedan', 'taxi'];
const TRAFFIC_COLORS = [0x3f6fb5, 0x8a2f2f, 0x2f6b4f, 0xcfd6dd, 0x5b4a8a, 0xb5793a, 0x333a44];
const LANE = 2.8; // metres right of the road centreline

function edgePoint(city, a, b, t, side) {
  const A = city.nodes[a], B = city.nodes[b];
  const dx = B.x - A.x, dz = B.z - A.z;
  const len = Math.hypot(dx, dz) || 1;
  // Right of the travel direction, in world XZ.
  const rx = -dz / len * side, rz = dx / len * side;
  return { x: A.x + dx * t + rx * LANE, z: A.z + dz * t + rz * LANE, heading: Math.atan2(-dz, dx) };
}

function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function createTraffic(city, rng) {
  const manager = {
    cars: [],
    police: [],
    parked: [],
    respawnTimer: 0,
  };

  function spawnTrafficCar() {
    const a = city.randomNode(rng);
    const nb = city.adj[a];
    if (!nb.length) return;
    const b = rng.pick(nb);
    const veh = createVehicle(rng.pick(TRAFFIC_PROFILES), 0, 0, 0);
    veh.color = rng.pick(TRAFFIC_COLORS);
    const start = edgePoint(city, a, b, rng.range(0, 0.9), 1);
    veh.x = start.x; veh.z = start.z; veh.heading = start.heading;
    manager.cars.push({
      veh, role: 'traffic',
      route: [a, b], edge: 0, t: rng.range(0, 0.9),
      cruise: rng.range(9, 14),
    });
  }

  // Park a car at a spot. With an existing vehicle, re-register that car
  // (used when the player steps out); otherwise spawn a fresh one.
  function spawnParkedCar(profileKey, x, z, heading, existing) {
    const veh = existing || createVehicle(profileKey || rng.pick(TRAFFIC_PROFILES), x, z, heading);
    if (existing) { veh.x = x; veh.z = z; veh.heading = heading; veh.vx = 0; veh.vz = 0; veh.speed = 0; }
    else veh.color = rng.pick(TRAFFIC_COLORS);
    const entry = { veh, role: 'parked' };
    manager.parked.push(entry);
    manager.cars.push(entry);
    return entry;
  }
  manager.addParked = (profileKey, x, z, heading, existing) =>
    spawnParkedCar(profileKey, x, z, heading, existing);

  for (let i = 0; i < TRAFFIC_COUNT; i += 1) spawnTrafficCar();
  for (let i = 0; i < PARKED_COUNT; i += 1) {
    const spot = rng.pick(city.parkingSpots);
    spawnParkedCar(null, spot.x, spot.z, spot.heading, null);
  }

  // Keep exactly `count` police cruisers active, spawning on roads near
  // the player and recycling ones that fall far behind.
  manager.setWanted = (stars, player) => {
    while (manager.police.length < stars) {
      const angle = rng.range(0, Math.PI * 2);
      const dist = rng.range(55, 95);
      const node = city.nearestNode(player.x + Math.cos(angle) * dist, player.z + Math.sin(angle) * dist);
      const veh = createVehicle('police', city.nodes[node].x, city.nodes[node].z,
        Math.atan2(-(player.z - city.nodes[node].z), player.x - city.nodes[node].x));
      const cop = { veh, role: 'police', busted: 0, siren: rng.range(0, 1), route: null, wp: 1, routeTimer: 0 };
      manager.police.push(cop);
      manager.cars.push(cop);
    }
    while (manager.police.length > stars) {
      const cop = manager.police.pop();
      const idx = manager.cars.indexOf(cop);
      if (idx >= 0) manager.cars.splice(idx, 1);
    }
  };

  manager.nearestParked = (x, z, maxDist) => {
    let best = null, bd = maxDist * maxDist;
    for (const p of manager.parked) {
      const d = (p.veh.x - x) ** 2 + (p.veh.z - z) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };

  manager.stealParked = (parked) => {
    const i = manager.parked.indexOf(parked);
    if (i >= 0) manager.parked.splice(i, 1);
    const j = manager.cars.indexOf(parked);
    if (j >= 0) manager.cars.splice(j, 1);
    manager.respawnTimer = 18;
  };

  // Take a car out of the world entirely (stolen traffic car or cruiser).
  manager.removeCar = (car) => {
    const j = manager.cars.indexOf(car);
    if (j >= 0) manager.cars.splice(j, 1);
    const k = manager.police.indexOf(car);
    if (k >= 0) manager.police.splice(k, 1);
  };

  manager.update = (dt, ctx) => {
    const { player, playerCar, wantedStars } = ctx;
    manager.setWanted(wantedStars, player);

    // Respawn a fresh parked car a while after one was stolen.
    if (manager.respawnTimer > 0) {
      manager.respawnTimer -= dt;
      if (manager.respawnTimer <= 0) {
        const spot = rng.pick(city.parkingSpots);
        spawnParkedCar(null, spot.x, spot.z, spot.heading, null);
      }
    }

    for (const car of manager.cars) {
      if (car.role === 'parked') continue;
      if (car.role === 'traffic') updateTrafficCar(car, dt, ctx);
      if (car.role === 'police') updatePoliceCar(car, dt, ctx);
    }

    // Car-on-car separation for every pair that matters (player included).
    const all = playerCar ? [...manager.cars.map((c) => c.veh), playerCar] : manager.cars.map((c) => c.veh);
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        const closing = separateVehicles(all[i], all[j]);
        if (closing > 7 && ctx.onCrash) ctx.onCrash(closing, all[i] === playerCar || all[j] === playerCar);
      }
    }
    // Keep traffic on the roads: they never leave the graph, so no
    // building collision pass is needed for them.
  };

  function updateTrafficCar(car, dt, ctx) {
    const { player, playerCar } = ctx;
    const route = car.route;
    const a = route[car.edge], b = route[car.edge + 1];
    if (b === undefined) {
      const dest = city.randomNode(rng);
      car.route = city.route(a, dest);
      car.edge = 0; car.t = 0;
      return;
    }
    const A = city.nodes[a], B = city.nodes[b];
    const edgeLen = Math.hypot(B.x - A.x, B.z - A.z);
    // Brake for the car ahead, for the on-foot player, and at random
    // red-light pauses so the flow feels alive.
    let target = car.cruise;
    const ahead = edgePoint(city, a, b, Math.min(1, car.t + 14 / edgeLen), 1);
    for (const other of manager.cars) {
      if (other === car || other.role === 'parked') continue;
      const d = Math.hypot(other.veh.x - ahead.x, other.veh.z - ahead.z);
      if (d < 7) { target = 0; break; }
    }
    if (playerCar) {
      const d = Math.hypot(playerCar.x - ahead.x, playerCar.z - ahead.z);
      if (d < 7) target = 0;
    } else if (player) {
      // Traffic brakes for a pedestrian in the road — it will not run
      // the player over unless they dart out at the last moment.
      const d = Math.hypot(player.x - ahead.x, player.z - ahead.z);
      if (d < 6) target = 0;
    }
    const point = edgePoint(city, a, b, car.t, 1);
    const wantHeading = point.heading;
    car.veh.heading += angleDelta(car.veh.heading, wantHeading) * Math.min(1, dt * 6);
    car.veh.speed += (target - car.veh.speed) * Math.min(1, dt * 1.5);
    const f = forwardOf(car.veh.heading);
    car.veh.x += f.x * car.veh.speed * dt;
    car.veh.z += f.z * car.veh.speed * dt;
    car.veh.vx = f.x * car.veh.speed;
    car.veh.vz = f.z * car.veh.speed;
    car.t += (car.veh.speed * dt) / edgeLen;
    if (car.t >= 1) {
      car.edge += 1; car.t = 0;
      if (car.edge >= car.route.length - 1) {
        const dest = city.randomNode(rng);
        car.route = city.route(b, dest);
        car.edge = 0;
      }
    }
  }

  function updatePoliceCar(car, dt, ctx) {
    const { player, playerCar } = ctx;
    const target = playerCar || player;
    // Pursuit with a lead: aim where the player will be, not where they are.
    const lead = 1.1;
    const tx = target.x + (target.vx || 0) * lead;
    const tz = target.z + (target.vz || 0) * lead;
    const dx = tx - car.veh.x, dz = tz - car.veh.z;
    const dist = Math.hypot(dx, dz) || 1;
    // Chase on the road graph, re-routing as the player moves; only the
    // last stretch is a straight ram. Driving straight through the city
    // would wedge a cruiser in the buildings.
    car.routeTimer -= dt;
    if (!car.route || car.routeTimer <= 0) {
      car.route = city.route(city.nearestNode(car.veh.x, car.veh.z), city.nearestNode(tx, tz));
      car.wp = 1;
      car.routeTimer = 1.5;
    }
    let wantHeading;
    let nodeDist = Infinity;
    // Ram straight at the player only when the line between us is clear
    // of buildings; otherwise a cruiser cuts the corner into a block and
    // wedges itself between the buildings there.
    const pathClear = (x0, z0, x1, z1) => {
      for (let t = 0.25; t < 1; t += 0.25) {
        const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
        for (const c of city.queryColliders(x, z, 3)) {
          if (Math.abs(x - c.x) < c.hw + 2 && Math.abs(z - c.z) < c.hd + 2) return false;
        }
      }
      return true;
    };
    if (dist < 14 && pathClear(car.veh.x, car.veh.z, tx, tz)) {
      wantHeading = Math.atan2(-dz, dx);
    } else {
      const node = city.nodes[car.route[Math.min(car.wp, car.route.length - 1)]];
      nodeDist = Math.hypot(node.x - car.veh.x, node.z - car.veh.z);
      if (nodeDist < 10 + Math.abs(car.veh.speed) * 0.4 && car.wp < car.route.length - 1) car.wp += 1;
      wantHeading = Math.atan2(-(node.z - car.veh.z), node.x - car.veh.x);
    }
    // Off-road recovery: shoved into a block, aim at the nearest
    // intersection instead of through the buildings.
    const offRoad = (v) => {
      let best = Infinity;
      for (let i = 0; i < CITY.roads; i += 1) {
        const c = (i - (CITY.roads - 1) / 2) * CITY.pitch;
        best = Math.min(best, Math.abs(v - c));
      }
      return best;
    };
    if (offRoad(car.veh.x) > 9 && offRoad(car.veh.z) > 9) {
      const n = city.nodes[city.nearestNode(car.veh.x, car.veh.z)];
      wantHeading = Math.atan2(-(n.z - car.veh.z), n.x - car.veh.x);
    }
    const err = angleDelta(car.veh.heading, wantHeading);
    // Brake for the corner ahead and for a big heading error, so a fast
    // cruiser does not overshoot the intersection into a building.
    let throttle = dist > 40 ? 1 : dist > 12 ? 0.6 : 0.3;
    throttle = Math.min(throttle, 0.3 + nodeDist / 45);
    throttle *= (1 - Math.min(0.6, Math.abs(err) * 0.35));
    const steer = Math.max(-1, Math.min(1, err * 2.2));
    // Stuck recovery: a cruiser wedged in a corner reverses out.
    if (car.reversing > 0) {
      car.reversing -= dt;
      stepVehicle(car.veh, { throttle: -0.7, steer: -steer, handbrake: false }, dt,
        (v, nx, nz) => collideVehicle(v, nx, nz, ctx.city.queryColliders));
    } else {
      if (Math.abs(car.veh.speed) < 2 && dist > 14) {
        car.stuckTime = (car.stuckTime || 0) + dt;
        if (car.stuckTime > 1.5) { car.reversing = 1.0; car.stuckTime = 0; }
      } else car.stuckTime = 0;
      // Police drive the same physics as the player, with the same building
      // collision, so a chase can end with a cruiser in a wall.
      stepVehicle(car.veh, { throttle, steer, handbrake: false }, dt,
        (v, nx, nz) => collideVehicle(v, nx, nz, ctx.city.queryColliders));
    }
    // Busted timer: a cruiser parked on a slow player for long enough ends it.
    const speed = playerCar ? Math.abs(playerCar.speed) : Math.hypot(player.vx || 0, player.vz || 0);
    if (dist < 7 && speed < 3) car.busted += dt;
    else car.busted = Math.max(0, car.busted - dt * 2);
    car.siren += dt;
  }

  return manager;
}
