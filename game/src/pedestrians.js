// Solmar Bay — pedestrians. They walk the sidewalks along the road grid,
// cross at intersections, and run from a speeding car or a player who
// throws a punch. Getting hit by a car is a crime: the caller decides.
import { PED_COUNT } from './config.js';

const PED_COLORS = [0xd94f4f, 0x4f7dd9, 0x53a05a, 0xd9a441, 0x8a5fd0, 0xd97fb0, 0x3a3a3a, 0xe8e0d0];
const NAMES = ['Mara', 'Theo', 'Iris', 'Dario', 'Sana', 'Kip', 'Luz', 'Ezra', 'Nia', 'Omar'];

export function createPedestrians(city, rng) {
  const peds = [];
  function spawnPed(x, z) {
    return {
      x, z,
      heading: rng.range(0, Math.PI * 2),
      speed: rng.range(1.0, 1.7),
      state: 'walk',          // walk | flee | down
      color: rng.pick(PED_COLORS),
      name: rng.pick(NAMES),
      node: city.nearestNode(x, z),
      targetNode: null,
      timer: rng.range(0, 4),
      downTimer: 0,
      bobPhase: rng.range(0, Math.PI * 2),
    };
  }
  for (let i = 0; i < PED_COUNT; i += 1) {
    const node = city.randomNode(rng);
    const n = city.nodes[node];
    peds.push(spawnPed(n.x + rng.range(-20, 20), n.z + rng.range(-20, 20)));
  }

  function pickTarget(ped) {
    const nb = city.adj[ped.node];
    if (!nb || !nb.length) return;
    ped.targetNode = rng.pick(nb);
    const t = city.nodes[ped.targetNode];
    // Walk on the sidewalk: offset from the road centreline.
    ped.tx = t.x + rng.range(-8, 8);
    ped.tz = t.z + rng.range(-8, 8);
  }

  return {
    peds,
    update(dt, ctx) {
      const { player, playerCar, threat } = ctx;
      for (const ped of peds) {
        if (ped.state === 'down') {
          ped.downTimer -= dt;
          if (ped.downTimer <= 0) {
            // They pick themselves up far away and walk on, like nothing happened.
            const node = city.randomNode(rng);
            const n = city.nodes[node];
            ped.x = n.x + rng.range(-20, 20);
            ped.z = n.z + rng.range(-20, 20);
            ped.state = 'walk';
            ped.node = node;
            ped.targetNode = null;
          }
          continue;
        }
        // Flee: a car barrelling at them, or the player swinging.
        const tx = playerCar ? playerCar.x : (threat ? threat.x : player.x);
        const tz = playerCar ? playerCar.z : (threat ? threat.z : player.z);
        const dx = ped.x - tx, dz = ped.z - tz;
        const d = Math.hypot(dx, dz);
        const dangerSpeed = playerCar ? Math.abs(playerCar.speed) : 0;
        if ((playerCar && d < 12 && dangerSpeed > 8) || (threat && d < 5)) {
          ped.state = 'flee';
          ped.heading = Math.atan2(-dz, dx);
          ped.timer = 1.2;
        }
        if (ped.state === 'flee') {
          ped.timer -= dt;
          ped.x += Math.cos(ped.heading) * 4.4 * dt;
          ped.z += -Math.sin(ped.heading) * 4.4 * dt;
          ped.bobPhase += dt * 14;
          if (ped.timer <= 0) ped.state = 'walk';
          continue;
        }
        if (!ped.targetNode) pickTarget(ped);
        if (!ped.targetNode) continue;
        const gx = ped.tx - ped.x, gz = ped.tz - ped.z;
        const gd = Math.hypot(gx, gz);
        if (gd < 1.5) {
          ped.node = ped.targetNode;
          ped.targetNode = null;
          continue;
        }
        ped.heading = Math.atan2(-gz, gx);
        ped.x += (gx / gd) * ped.speed * dt;
        ped.z += (gz / gd) * ped.speed * dt;
        ped.bobPhase += dt * 7;
      }
    },
    // A car overlapping a pedestrian knocks them down. Returns the ped hit.
    checkRunOver(car) {
      for (const ped of this.peds) {
        if (ped.state === 'down') continue;
        const d = Math.hypot(ped.x - car.x, ped.z - car.z);
        if (d < 1.6 && Math.abs(car.speed) > 4) {
          ped.state = 'down';
          ped.downTimer = 6;
          return ped;
        }
      }
      return null;
    },
    // The player's punch: nearest ped within reach goes down.
    punch(x, z, heading) {
      const fx = Math.cos(heading), fz = -Math.sin(heading);
      for (const ped of this.peds) {
        if (ped.state === 'down') continue;
        const dx = ped.x - x, dz = ped.z - z;
        const d = Math.hypot(dx, dz);
        if (d < 2.2 && dx * fx + dz * fz > 0) {
          ped.state = 'down';
          ped.downTimer = 5;
          return ped;
        }
      }
      return null;
    },
  };
}
