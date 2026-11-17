// Solmar Bay — boot and the one loop. Input is read every frame, the world
// advances in fixed 1/60 s steps, and the renderer paints what is there.
// The game moves between menu, playing, paused, wasted and busted screens.
//
// ?seed=N fixes the city. ?shot=chase|street|mission|night (with &seed=N)
// stages that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.
import { STEP, SAVE_KEY, PLAYER, WANTED, DAY_SECONDS } from './config.js';
import { createRng } from './rng.js';
import { buildCity } from './city.js';
import { createVehicle, stepVehicle, collideVehicle } from './vehicles.js';
import { createTraffic } from './traffic.js';
import { createPedestrians } from './pedestrians.js';
import { createMissions } from './missions.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { createRenderer } from './render.js';
import { stageShot } from './shots.js';

const params = new URLSearchParams(window.location.search);
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);
const shot = params.get('shot');

window.addEventListener('error', (e) => {
  const el = document.getElementById('err');
  if (el) el.textContent += `${e.message}\n`;
});

const canvas = document.getElementById('game');
const audio = createAudio();
const input = createInput(canvas);
const hud = createHud();

const game = {
  state: null,
  resetWorld(nextSeed) { game.state = buildWorld(nextSeed); },
  startMission(i) { return game.state.missions.start(i); },
  setHeat(v) { game.state.heat = v; game.state.lastCrimeAt = game.state.elapsed; },
  setTimeOfDay(h) { game.state.timeOfDay = h; },
  placePlayerOnFoot(x, z, heading) {
    const S = game.state;
    S.player.x = x; S.player.z = z; S.player.heading = heading;
    S.player.vx = 0; S.player.vz = 0;
    if (S.playerCar) { S.playerCar = null; }
  },
  stepFixed(intent) { stepWorld(game.state, intent, STEP); },
};

// One fresh world: city, traffic, peds, missions, player and the HUD state.
function buildWorld(worldSeed) {
  const rng = createRng(worldSeed);
  const city = buildCity(worldSeed);
  const traffic = createTraffic(city, rng);
  const peds = createPedestrians(city, rng);
  const missions = createMissions(city);
  // A taxi waits at the marina rank for mission one.
  const rank = city.nodes[6 * 9 + 2];
  traffic.addParked('taxi', rank.x + 8, rank.z, Math.PI / 2);
  const state = {
    seed: worldSeed, city, traffic, peds, missions,
    mode: 'menu',
    player: { x: city.spawn.x, z: city.spawn.z, heading: city.spawn.heading, vx: 0, vz: 0, health: PLAYER.maxHealth },
    playerCar: null,
    cash: 250,
    heat: 0,
    lastCrimeAt: -999,
    timeOfDay: 9.5,
    elapsed: 0,
    shake: 0,
    cameraOrbit: { dx: 0, dy: 0, wheel: 0 },
    saveTimer: 0,
    endReason: '',
  };
  return state;
}

function starsFromHeat(heat) {
  if (heat <= 0) return 0;
  return Math.min(5, Math.ceil(heat / 20));
}

function addHeat(state, amount) {
  state.heat = Math.min(100, state.heat + amount);
  state.lastCrimeAt = state.elapsed;
}

function pushOutOfBuildings(state, x, z, r) {
  let px = x, pz = z;
  for (const c of state.city.queryColliders(px, pz, r + 2)) {
    const cx = Math.max(c.x - c.hw, Math.min(px, c.x + c.hw));
    const cz = Math.max(c.z - c.hd, Math.min(pz, c.z + c.hd));
    const dx = px - cx, dz = pz - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    const d = Math.sqrt(d2) || 0.001;
    px += (dx / d) * (r - d);
    pz += (dz / d) * (r - d);
  }
  return { x: px, z: pz };
}

// One fixed sim step. intent: {throttle, steer, handbrake, sprint} —
// driving reads throttle/steer/handbrake, walking reads throttle as
// forward and steer as turn. Only runs while the game is playing.
function stepWorld(S, intent, dt) {
  if (S.mode !== 'playing') return;
  S.elapsed += dt;
  S.timeOfDay = (S.timeOfDay + dt * 24 / DAY_SECONDS) % 24;

  // Wanted cools after a quiet spell.
  if (S.heat > 0 && S.elapsed - S.lastCrimeAt > WANTED.coolDelay) {
    S.heat = Math.max(0, S.heat - WANTED.coolRate * dt);
  }
  const stars = starsFromHeat(S.heat);

  // --- Player ---
  const P = S.player;
  if (S.playerCar) {
    const car = S.playerCar;
    const before = car.health;
    stepVehicle(car, {
      throttle: intent.throttle, steer: intent.steer, handbrake: intent.handbrake,
    }, dt, (v, nx, nz) => collideVehicle(v, nx, nz, S.city.queryColliders));
    if (car.health < before) {
      S.shake = Math.max(S.shake, 0.5);
      audio.sfx('crash');
      P.health = Math.max(0, P.health - (before - car.health) * 0.4);
    }
    P.x = car.x; P.z = car.z; P.heading = car.heading;
    P.vx = car.vx; P.vz = car.vz;
    // Running a pedestrian over is a crime.
    const hit = S.peds.checkRunOver(car);
    if (hit) {
      addHeat(S, WANTED.hitPed);
      audio.sfx('crash');
      S.shake = Math.max(S.shake, 0.7);
      hud.toast(`You hit ${hit.name}! The bay saw that.`);
    }
    // Wrecked car: it burns out, Rook walks away from it.
    if (car.health <= 0) {
      audio.sfx('crash');
      S.shake = 1;
      P.health = Math.max(0, P.health - 20);
      exitCar(S, true);
      hud.toast('Your ride is wrecked. On foot now.');
    }
  } else {
    const speed = intent.sprint ? PLAYER.runSpeed : PLAYER.walkSpeed;
    P.heading += intent.steer * 2.4 * dt;
    const fx = Math.cos(P.heading), fz = -Math.sin(P.heading);
    const nx = P.x + fx * intent.throttle * speed * dt;
    const nz = P.z + fz * intent.throttle * speed * dt;
    const fixed = pushOutOfBuildings(S, nx, nz, PLAYER.radius);
    P.x = Math.max(-300, Math.min(300, fixed.x));
    P.z = Math.max(-300, Math.min(300, fixed.z));
    P.vx = fx * intent.throttle * speed;
    P.vz = fz * intent.throttle * speed;
    // A moving car that clips the player hurts.
    for (const c of S.traffic.cars) {
      if (c.role === 'parked') continue;
      const d = Math.hypot(c.veh.x - P.x, c.veh.z - P.z);
      if (d < 2.4) {
        if (Math.abs(c.veh.speed) > 4) {
          P.health = Math.max(0, P.health - 15);
          audio.sfx('crash');
          S.shake = Math.max(S.shake, 0.8);
          const push = pushOutOfBuildings(S, P.x + (P.x - c.veh.x), P.z + (P.z - c.veh.z), PLAYER.radius);
          P.x = push.x; P.z = push.z;
        } else {
          const push = pushOutOfBuildings(S, P.x, P.z, PLAYER.radius);
          P.x = push.x; P.z = push.z;
        }
      }
    }
  }

  // --- Traffic + police ---
  S.traffic.update(dt, {
    player: P, playerCar: S.playerCar, wantedStars: stars, city: S.city,
    onCrash: (closing, involvesPlayer) => {
      if (!involvesPlayer) return;
      if (closing > 7) {
        S.shake = Math.max(S.shake, 0.4);
        audio.sfx('crash');
        if (S.playerCar) {
          S.playerCar.health = Math.max(0, S.playerCar.health - (closing - 7) * 0.8);
          addHeat(S, WANTED.ram);
        }
      }
    },
  });
  // Busted: a cruiser sitting on a slow player ends the run.
  for (const cop of S.traffic.police) {
    if (cop.busted >= WANTED.bustedHold) { endRun(S, 'busted'); return; }
  }

  // --- Pedestrians ---
  S.peds.update(dt, { player: P, playerCar: S.playerCar, threat: null });

  // --- Missions ---
  const event = S.missions.update(dt, {
    x: P.x, z: P.z, inCar: !!S.playerCar, wantedStars: stars,
  });
  if (event) {
    if (event.type === 'missionComplete') {
      S.cash += event.reward;
      audio.sfx('mission');
      hud.toast(`Mission complete — $${event.reward}`);
      hud.setMissionList(S.missions.defs, S.missions.done, S.missions.index);
      saveGame(S);
      if (!S.missions.isFinished()) {
        // Next job starts when the dialog clears.
        S.pendingMission = S.missions.index;
      }
    } else if (event.type === 'missionFailed') {
      audio.sfx('fail');
      hud.toast('Mission failed — press M to retry');
    }
  }
  if (S.pendingMission !== undefined && !hud.hasDialog()) {
    const next = S.pendingMission;
    S.pendingMission = undefined;
    S.missions.start(next);
    if (S.missions.current().id === 4) addHeat(S, 58);
  }
  // Dialog lines queued by missions surface one at a time.
  if (S.missions.dialog.length && !hud.hasDialog()) {
    hud.queueDialog(S.missions.dialog.splice(0, S.missions.dialog.length));
  }

  // --- Wasted ---
  if (P.health <= 0) { endRun(S, 'wasted'); return; }

  // --- Audio + save ---
  audio.setEngine(S.playerCar ? S.playerCar.speed * 3.6 : 0, !!S.playerCar);
  audio.setSiren(S.traffic.police.length > 0);
  audio.update(dt);
  S.saveTimer += dt;
  if (S.saveTimer > 15) { S.saveTimer = 0; saveGame(S); }
}

function nearestCar(S, maxDist) {
  let best = null, bd = maxDist * maxDist;
  for (const c of S.traffic.cars) {
    const d = (c.veh.x - S.player.x) ** 2 + (c.veh.z - S.player.z) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function enterCar(S) {
  const car = nearestCar(S, 4.2);
  if (!car || Math.abs(car.veh.speed) > 3) return;
  // Stealing: parked and traffic cars are fair game, cruisers cost more.
  S.playerCar = car.veh;
  S.playerCar.health = Math.max(S.playerCar.health, 40);
  if (car.role === 'parked') S.traffic.stealParked(car);
  else S.traffic.removeCar(car);
  addHeat(S, car.role === 'police' ? WANTED.hitPolice : WANTED.stealCar);
  audio.sfx('door');
  hud.toast(car.role === 'police'
    ? 'You stole a cruiser. Bold. Very bold.'
    : 'Car borrowed. The owner will notice.');
}

function exitCar(S, wrecked) {
  const car = S.playerCar;
  if (!car) return;
  S.playerCar = null;
  const rx = Math.sin(S.player.heading), rz = Math.cos(S.player.heading);
  const spot = pushOutOfBuildings(S, car.x + rx * 2.6, car.z + rz * 2.6, PLAYER.radius);
  S.player.x = spot.x; S.player.z = spot.z;
  S.player.vx = 0; S.player.vz = 0;
  if (!wrecked) {
    S.traffic.addParked(car.profileKey, car.x, car.z, car.heading, car);
    audio.sfx('door');
  }
}

function endRun(S, kind) {
  S.mode = kind;
  audio.sfx(kind === 'wasted' ? 'wasted' : 'busted');
  audio.setEngine(0, false);
  audio.setSiren(false);
  if (kind === 'wasted') {
    S.cash = Math.floor(S.cash * 0.9);
    hud.showEnd('WASTED', 'The bay got the better of you this time. The hospital patches you up — minus ten percent for the trouble.');
  } else {
    S.cash = Math.floor(S.cash * 0.8);
    hud.showEnd('BUSTED', 'The SBPD finally boxed you in. Bail costs twenty percent. The heat is gone — for now.');
  }
  saveGame(S);
}

function respawn(S) {
  const P = S.player;
  P.health = PLAYER.maxHealth;
  P.x = S.city.spawn.x; P.z = S.city.spawn.z; P.heading = S.city.spawn.heading;
  P.vx = 0; P.vz = 0;
  S.playerCar = null;
  S.heat = 0;
  S.mode = 'playing';
  hud.hideEnd();
  hud.toast('Back on the streets. Don’t make it a habit.');
}

function saveGame(S) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: S.cash, health: S.player.health, mission: S.missions.index,
      done: [...S.missions.done], timeOfDay: S.timeOfDay,
      x: S.player.x, z: S.player.z, heading: S.player.heading,
    }));
  } catch { /* storage can be off; the game still plays */ }
}

function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ---------- Boot ----------
game.resetWorld(seed);
const renderer = createRenderer(canvas, game.state.city);
let save = loadSave();

hud.setMissionList(game.state.missions.defs, game.state.missions.done, 0);
hud.showMenu(true, !!save);
hud.onPlay = () => {
  audio.ensure();
  audio.setMusic(true);
  game.resetWorld(seed);
  hud.showMenu(false);
  game.state.mode = 'playing';
  game.state.missions.start(0);
  hud.setMissionList(game.state.missions.defs, game.state.missions.done, 0);
};
hud.onContinue = () => {
  audio.ensure();
  audio.setMusic(true);
  if (!save) return;
  const S = game.state;
  S.cash = save.cash ?? 250;
  S.player.health = save.health ?? PLAYER.maxHealth;
  S.timeOfDay = save.timeOfDay ?? 9.5;
  S.player.x = save.x ?? S.city.spawn.x;
  S.player.z = save.z ?? S.city.spawn.z;
  S.player.heading = save.heading ?? S.city.spawn.heading;
  for (const id of save.done ?? []) S.missions.done.add(id);
  S.missions.index = Math.min(save.mission ?? 0, S.missions.defs.length - 1);
  hud.showMenu(false);
  S.mode = 'playing';
  if (!S.missions.isFinished()) S.missions.start(S.missions.index);
  hud.setMissionList(S.missions.defs, S.missions.done, S.missions.index);
};
hud.onResume = () => { game.state.mode = 'playing'; hud.showPause(false); };
hud.onRestartMission = () => {
  const S = game.state;
  hud.showPause(false);
  S.missions.start(S.missions.index);
  if (S.missions.current().id === 4) addHeat(S, 58);
  S.mode = 'playing';
};
hud.onQuitMenu = () => {
  const S = game.state;
  saveGame(S);
  S.mode = 'menu';
  hud.showPause(false);
  hud.showMenu(true, !!loadSave());
};
hud.onRespawn = () => respawn(game.state);

// ---------- Main loop ----------
const MAX_FRAME = 0.25;
let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(MAX_FRAME, (now - last) / 1000);
  last = now;
  const S = game.state;

  if (S.mode === 'playing') {
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 8) {
      // Intent for this fixed step, from the live input.
      let intent;
      if (S.playerCar) {
        const d = input.drive();
        intent = { throttle: d.throttle, steer: d.steer, handbrake: d.handbrake, sprint: false };
      } else {
        const w = input.walk();
        intent = { throttle: w.forward, steer: -w.strafe, handbrake: false, sprint: w.sprint };
      }
      stepWorld(S, intent, STEP);
      acc -= STEP;
      steps += 1;
      if (S.mode !== 'playing') break;
    }
    if (steps === 8) acc = 0;

    // One-shot actions, consumed once per press.
    if (input.consumePressed('enter')) {
      if (S.playerCar) exitCar(S, false);
      else enterCar(S);
    }
    if (input.consumePressed('punch') && !S.playerCar) {
      const hit = S.peds.punch(S.player.x, S.player.z, S.player.heading);
      audio.sfx('punch');
      if (hit) {
        addHeat(S, WANTED.punch);
        hud.toast(`You decked ${hit.name}. Witnesses everywhere.`);
      }
    }
    if (input.consumePressed('missions')) {
      if (!S.missions.active && !S.missions.isFinished()) {
        S.missions.start(S.missions.index);
        if (S.missions.current().id === 4) addHeat(S, 58);
        hud.toast(`Mission ${S.missions.current().id}: ${S.missions.current().title}`);
      } else {
        hud.toast(S.missions.objective);
      }
    }
    if (input.consumePressed('radio')) hud.toast(audio.nextStation());
    if (input.consumePressed('pause')) {
      S.mode = 'paused';
      hud.showPause(true);
      saveGame(S);
    }
    if (input.consumePressed('confirm') && hud.hasDialog()) hud.advanceDialog();
    // Mouse orbit + wheel feed the camera.
    const orbit = input.takeOrbit();
    const wheel = input.takeWheel();
    S.cameraOrbit.dx = orbit.dx;
    S.cameraOrbit.dy = orbit.dy;
    S.cameraOrbit.wheel = wheel;
  } else if (S.mode === 'paused') {
    if (input.consumePressed('pause')) {
      S.mode = 'playing';
      hud.showPause(false);
    }
  }

  // HUD + render every frame, whatever the mode.
  const stars = starsFromHeat(S.heat);
  const marker = S.missions.marker;
  const objectiveDist = marker
    ? `${Math.round(Math.hypot(S.player.x - marker.x, S.player.z - marker.z))} m — follow the yellow diamond`
    : '';
  hud.update({
    cash: S.cash, health: S.player.health,
    carHealth: S.playerCar ? S.playerCar.health : 0,
    inCar: !!S.playerCar, carName: S.playerCar ? S.playerCar.profile.name : '',
    speedKmh: S.playerCar ? S.playerCar.speed * 3.6 : Math.hypot(S.player.vx, S.player.vz) * 3.6,
    stars, timeOfDay: S.timeOfDay,
    objective: S.missions.active ? S.missions.objective : 'Press M to start the next mission',
    objectiveDist,
    city: S.city, player: S.player, cars: S.traffic.cars, peds: S.peds.peds, marker,
  }, dt);
  renderer.setShake(S.shake);
  S.shake = 0;
  renderer.update({
    player: S.player, playerCar: S.playerCar, cars: S.traffic.cars,
    peds: S.peds.peds, timeOfDay: S.timeOfDay, cameraOrbit: S.cameraOrbit,
  }, dt);
  S.cameraOrbit.dx = 0; S.cameraOrbit.dy = 0; S.cameraOrbit.wheel = 0;
}

// ---------- Screenshot mode ----------
if (shot) {
  hud.showMenu(false);
  game.resetWorld(seed);
  const S = game.state;
  S.mode = 'playing';
  // Give Rook a car to drive for the driving shots.
  if (shot !== 'street') {
    const spot = S.city.nodes[4 * 9 + 4];
    const car = createVehicle('sports', spot.x, spot.z + 6, 0);
    S.playerCar = car;
    S.player.x = car.x; S.player.z = car.z; S.player.heading = car.heading;
  }
  const dialog = stageShot(shot, game);
  if (dialog) hud.queueDialog(dialog);
  renderer.snapCamera(S.playerCar || S.player, (S.playerCar || S.player).heading);
  hud.update({
    cash: S.cash, health: S.player.health,
    carHealth: S.playerCar ? S.playerCar.health : 0,
    inCar: !!S.playerCar, carName: S.playerCar ? S.playerCar.profile.name : '',
    speedKmh: S.playerCar ? S.playerCar.speed * 3.6 : 0,
    stars: starsFromHeat(S.heat), timeOfDay: S.timeOfDay,
    objective: S.missions.active ? S.missions.objective : 'Press M to start the next mission',
    objectiveDist: '',
    city: S.city, player: S.player, cars: S.traffic.cars, peds: S.peds.peds,
    marker: S.missions.marker,
  }, 0);
  let painted = 0;
  (function paint() {
    renderer.update({
      player: S.player, playerCar: S.playerCar, cars: S.traffic.cars,
      peds: S.peds.peds, timeOfDay: S.timeOfDay, cameraOrbit: { dx: 0, dy: 0, wheel: 0 },
    }, 0.016);
    painted += 1;
    if (painted < 3) requestAnimationFrame(paint);
    else window.__shotReady = true;
  })();
} else {
  requestAnimationFrame(frame);
}

// Debug handle for play-testing (mode, health, wanted, positions).
window.__game = {
  get mode() { return game.state.mode; },
  get health() { return game.state.player.health; },
  get wanted() { return starsFromHeat(game.state.heat); },
  get cash() { return game.state.cash; },
  get mission() { return game.state.missions.active ? game.state.missions.current().title : 'none'; },
  get player() { return { x: game.state.player.x, z: game.state.player.z, heading: game.state.player.heading, inCar: !!game.state.playerCar }; },
  get parked() { return game.state.traffic.parked.map((p) => ({ x: p.veh.x, z: p.veh.z, profile: p.veh.profileKey })); },
  get car() {
    const c = game.state.playerCar;
    return c ? { x: c.x, z: c.z, heading: c.heading, speed: c.speed, health: c.health } : null;
  },
  get police() { return game.state.traffic.police.map((p) => ({ x: p.veh.x, z: p.veh.z, speed: p.veh.speed, busted: p.busted })); },
  get trace() { return game.state.trace || []; },
  get vehicles() { return game.state.traffic.cars.length; },
  get city() { return { buildings: game.state.city.buildings.length }; },
};
