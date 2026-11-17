// Solmar Bay — deterministic screenshot scenes behind ?shot=chase|street|
// mission|night (with &seed=N). Each one plays the real rules forward from
// a fresh world for a fixed number of steps, steered by an autopilot that
// follows the road graph toward the mission marker (never a straight line
// through buildings), so the frame is what a short game really looks like
// and the same seed always gives the same frame.
import { STEP, CITY } from './config.js';

function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Drive toward the mission marker along the roads for `seconds` of sim.
// The target is re-read every step: the mission may advance (enterCar ->
// driveTo) while we drive, and the route is rebuilt when it moves. The car
// aims at the right-hand lane of each route leg, brakes for the car ahead,
// and reverses out if it gets wedged against something.
function driveToward(game, getTarget, seconds, throttle) {
  const S = game.state;
  const city = S.city;
  let route = null;
  let wp = 1;
  let targetKey = '';
  let stuckTime = 0;
  let reversing = 0;
  const steps = Math.floor(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    const car = game.state.playerCar;
    if (!car || game.state.mode !== 'playing') break;
    const target = getTarget() || { x: 100, z: -100 };
    const key = `${target.x},${target.z}`;
    if (!route || key !== targetKey) {
      targetKey = key;
      route = city.route(city.nearestNode(car.x, car.z), city.nearestNode(target.x, target.z));
      wp = 1;
    }
    const tx = target.x, tz = target.z;
    const node = city.nodes[route[Math.min(wp, route.length - 1)]];
    const prev = city.nodes[route[Math.max(0, Math.min(wp, route.length - 1) - 1)]];
    const d = Math.hypot(node.x - car.x, node.z - car.z);
    if (d < 10 + Math.abs(car.speed) * 0.4 && wp < route.length - 1) wp += 1;
    // Off-road recovery: if the car was shoved into a block, aim at the
    // nearest intersection instead of through the buildings.
    let aim;
    const offRoad = (v) => {
      let best = Infinity;
      for (let i = 0; i < CITY.roads; i += 1) {
        const c = (i - (CITY.roads - 1) / 2) * CITY.pitch;
        best = Math.min(best, Math.abs(v - c));
      }
      return best;
    };
    if (offRoad(car.x) > 9 && offRoad(car.z) > 9) {
      const n = city.nodes[city.nearestNode(car.x, car.z)];
      aim = { x: n.x, z: n.z };
    } else {
      // Aim at the right-hand lane of the leg into this node.
      const legDx = node.x - prev.x, legDz = node.z - prev.z;
      const legLen = Math.hypot(legDx, legDz) || 1;
      const laneX = node.x + (-legDz / legLen) * 2.8;
      const laneZ = node.z + (legDx / legLen) * 2.8;
      aim = wp >= route.length - 1 ? { x: tx, z: tz } : { x: laneX, z: laneZ };
    }
    const want = Math.atan2(-(aim.z - car.z), aim.x - car.x);
    const err = angleDelta(car.heading, want);
    const steer = Math.max(-1, Math.min(1, err * 2.4));
    if (i % 30 === 0) {
      (S.trace = S.trace || []).push({
        step: i, x: +car.x.toFixed(1), z: +car.z.toFixed(1),
        heading: +car.heading.toFixed(2), speed: +car.speed.toFixed(1),
        wp, aimX: +aim.x.toFixed(1), aimZ: +aim.z.toFixed(1),
      });
    }
    // Slow for a sharp corner, brake for the car ahead, and brake for the
    // corner itself: a fast car overshoots the intersection into a building.
    let thr = (throttle ?? 0.85) * (Math.abs(err) > 0.6 ? 0.4 : 1);
    thr = Math.min(thr, 0.3 + d / 45);
    const fx = Math.cos(car.heading), fz = -Math.sin(car.heading);
    for (const c of S.traffic.cars) {
      const dx = c.veh.x - car.x, dz = c.veh.z - car.z;
      const ahead = dx * fx + dz * fz;
      const side = Math.abs(-dx * fz + dz * fx);
      if (ahead > 0 && ahead < 26 && side < 3.2) { thr = -0.7; break; }
    }
    if (reversing > 0) {
      reversing -= STEP;
      game.stepFixed({ throttle: -0.7, steer: -steer, handbrake: false });
      continue;
    }
    if (Math.abs(car.speed) < 2 && thr > 0.4) {
      stuckTime += STEP;
      if (stuckTime > 1.2) { reversing = 1.5; stuckTime = 0; continue; }
    } else stuckTime = 0;
    game.stepFixed({ throttle: thr, steer, handbrake: false });
  }
}

function idle(game, seconds) {
  const steps = Math.floor(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    if (game.state.mode !== 'playing') break;
    game.stepFixed({ throttle: 0, steer: 0, handbrake: false });
  }
}

// Walk straight ahead (on foot) for `seconds` of sim.
function walkForward(game, seconds) {
  const steps = Math.floor(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    if (game.state.mode !== 'playing') break;
    game.stepFixed({ throttle: 1, steer: 0, handbrake: false, sprint: false });
  }
}

/**
 * Stage the named scene on the live game object and return the dialog lines
 * the shot should show (or null). The game must already be reset.
 */
export function stageShot(name, game) {
  const S = game.state;
  if (name === 'street') {
    // On foot on the marina road: Rook walks east down the street while
    // traffic brakes and queues around her — the city at street level.
    game.placePlayerOnFoot(-214, 2, 0);
    game.setTimeOfDay(10.5);
    game.setHeat(0);
    walkForward(game, 8);
    idle(game, 4);
    return null;
  }
  if (name === 'mission') {
    // Mid-mission: driving the cab toward the fare with the intro dialog up.
    game.startMission(0);
    game.setTimeOfDay(16.5);
    game.setHeat(0);
    driveToward(game, () => S.missions.marker, 9, 0.75);
    return null;
  }
  if (name === 'night') {
    // Night chase: headlights, lit windows, two cruisers closing in.
    game.startMission(3);
    game.setHeat(58);
    game.setTimeOfDay(22.2);
    driveToward(game, () => S.missions.marker, 8, 0.8);
    return null;
  }
  // Default: 'chase' — the cover. Three-star pursuit in daylight, mid-town.
  game.startMission(1);
  game.setHeat(55);
  game.setTimeOfDay(10.0);
  driveToward(game, () => S.missions.marker, 7, 0.8);
  return null;
}
