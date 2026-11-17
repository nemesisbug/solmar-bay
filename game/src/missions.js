// Solmar Bay — the five-mission story arc. Lena "Rook" Marlowe, ex-getaway
// driver, pulled back for one last score. Each mission is data: a title, an
// intro dialog, and steps the manager checks against the live game. Steps:
// goto (reach a point), enterCar, driveTo (reach a point in a car, optional
// clock), survive (stay alive with heat on), loseHeat (get clean).
import { CITY } from './config.js';

function nodePos(city, ix, iz) {
  const n = city.nodes[iz * CITY.roads + ix];
  return { x: n.x, z: n.z };
}

export function buildMissions(city) {
  const cabStand = nodePos(city, 2, 6);   // taxi rank by the marina
  const pickup = nodePos(city, 1, 2);     // fare waiting on the north side
  const dropoff = nodePos(city, 7, 7);    // far south-east corner
  const lot = nodePos(city, 5, 1);        // car lot, north edge
  const stash = nodePos(city, 8, 4);      // east-side drop point
  const bank = nodePos(city, 4, 4);       // Harbor Exchange, downtown
  const beach = nodePos(city, 0, 4);      // the promenade, west end

  return [
    {
      id: 1, title: 'First Shift',
      brief: 'Pick up the cab, collect your fare, and prove you still know these streets.',
      intro: [
        { who: 'VIC', text: 'Rook. You said one last job — this is it. Cab’s waiting at the marina rank. Keys are in it.' },
        { who: 'ROOK', text: 'I retired, Vic. Twice. Fine. One shift. Then I’m gone.' },
        { who: 'VIC', text: 'Fare’s up north, drop’s south-east. Don’t scratch the paint. Go.' },
      ],
      steps: [
        { type: 'enterCar', text: 'Get in the cab at the marina rank' },
        { type: 'driveTo', ...pickup, radius: 10, text: 'Pick up your fare on the north side' },
        { type: 'driveTo', ...dropoff, radius: 10, text: 'Drop the fare south-east — mind the traffic' },
      ],
      reward: 350,
    },
    {
      id: 2, title: 'Borrowed Wheels',
      brief: 'Vic needs a clean car. “Clean” is doing a lot of work there. Take one and lose the tail.',
      intro: [
        { who: 'VIC', text: 'The cab’s too hot now. Borrow something faster from the lot up north. Don’t ask whose.' },
        { who: 'ROOK', text: 'Borrow. Right. And when the blue lights show up?' },
        { who: 'VIC', text: 'Then you drive like you used to. Lose them and meet me at the stash.' },
      ],
      steps: [
        { type: 'enterCar', text: 'Take a car from the north lot' },
        { type: 'driveTo', ...stash, radius: 12, text: 'Reach the stash on the east side — with heat on your tail' },
        { type: 'loseHeat', text: 'Lose the heat. Stay out of sight till the stars fade' },
      ],
      reward: 600,
    },
    {
      id: 3, title: 'The Drop',
      brief: 'A package, a clock, and half the city between you and the money.',
      intro: [
        { who: 'MARA', text: 'Package is in the trunk. Seventy-five seconds, Rook. The buyer does not wait.' },
        { who: 'ROOK', text: 'Seventy-five seconds across town? You’re joking.' },
        { who: 'MARA', text: 'I never joke about money. Drive.' },
      ],
      steps: [
        { type: 'driveTo', ...stash, radius: 10, timeLimit: 75, text: 'Deliver the package east — 75 seconds on the clock' },
      ],
      reward: 900,
    },
    {
      id: 4, title: 'Heat Wave',
      brief: 'Three stars, roadblocks, and the whole SBPD on your bumper. Survive it.',
      intro: [
        { who: 'SBPD RADIO', text: 'All units — suspect vehicle fleeing downtown. Three stars. Box them in.' },
        { who: 'ROOK', text: 'Of course. Of course it’s three stars. Okay. Breathe. Drive.' },
        { who: 'VIC', text: 'Don’t stop, Rook. They can’t catch what they can’t corner.' },
      ],
      steps: [
        { type: 'survive', seconds: 40, text: 'Survive the three-star chase for 40 seconds' },
        { type: 'loseHeat', text: 'Now shake them. Get clean' },
      ],
      reward: 1200,
    },
    {
      id: 5, title: 'The Last Score',
      brief: 'The Harbor Exchange. One vault, one getaway, and the bay behind you.',
      intro: [
        { who: 'VIC', text: 'This is the one, Rook. Harbor Exchange, downtown. In and out. Then the beach, then gone.' },
        { who: 'ROOK', text: 'One last score. Then I’m a ghost story this city tells tourists.' },
        { who: 'VIC', text: 'Make it a good one.' },
      ],
      steps: [
        { type: 'driveTo', ...bank, radius: 12, text: 'Reach the Harbor Exchange downtown' },
        { type: 'driveTo', ...beach, radius: 12, text: 'Getaway — run for the promenade, west end' },
        { type: 'loseHeat', text: 'Disappear. Lose the heat for good' },
      ],
      reward: 5000,
    },
  ];
}

export function createMissions(city) {
  const defs = buildMissions(city);
  const manager = {
    defs,
    index: 0,            // current mission
    stepIndex: 0,
    active: false,
    done: new Set(),     // completed mission ids
    dialog: [],          // queued {who, text}
    timer: null,         // seconds left on a timed step
    surviveLeft: null,
    marker: null,        // {x, z} for the HUD + minimap
    objective: 'Start a mission from the menu (M)',
    stepTimer: 0,
  };

  manager.current = () => defs[manager.index];
  manager.isFinished = () => manager.index >= defs.length;

  manager.start = (i) => {
    if (i >= defs.length) return false;
    manager.index = i;
    manager.stepIndex = 0;
    manager.active = true;
    manager.timer = null;
    manager.surviveLeft = null;
    const def = defs[i];
    manager.dialog.push(...def.intro);
    manager.applyStep();
    return true;
  };

  manager.applyStep = () => {
    const def = manager.current();
    const step = def.steps[manager.stepIndex];
    manager.timer = step.timeLimit ?? null;
    manager.surviveLeft = step.type === 'survive' ? step.seconds : null;
    manager.marker = (step.x !== undefined) ? { x: step.x, z: step.z } : null;
    manager.objective = `${def.title} — ${step.text}`;
    if (step.type === 'survive') manager.marker = null;
  };

  manager.advance = () => {
    const def = manager.current();
    manager.stepIndex += 1;
    if (manager.stepIndex >= def.steps.length) {
      manager.done.add(def.id);
      manager.active = false;
      manager.marker = null;
      manager.objective = def.id >= defs.length
        ? 'The Last Score is done. Solmar Bay is yours, Rook.'
        : 'Mission complete. Press M for the next job.';
      manager.dialog.push({ who: 'VIC', text: `${def.title} — done. $${def.reward} in your pocket. Clean work.` });
      manager.index += 1;
      return { type: 'missionComplete', reward: def.reward, mission: def };
    }
    manager.applyStep();
    return { type: 'stepDone', mission: def };
  };

  // ctx: {x, z, inCar, wantedStars, addHeat}. Returns an event or null.
  manager.update = (dt, ctx) => {
    if (!manager.active) return null;
    const def = manager.current();
    const step = def.steps[manager.stepIndex];
    if (manager.timer !== null) {
      manager.timer -= dt;
      if (manager.timer <= 0) {
        manager.active = false;
        manager.marker = null;
        manager.objective = `${def.title} — failed. Press M to try again.`;
        manager.dialog.push({ who: 'VIC', text: 'Too slow, Rook. The buyer walked. We run it again.' });
        return { type: 'missionFailed', mission: def, reason: 'Out of time' };
      }
    }
    const dist = step.x !== undefined
      ? Math.hypot(ctx.x - step.x, ctx.z - step.z) : Infinity;
    switch (step.type) {
      case 'enterCar':
        if (ctx.inCar) return manager.advance();
        break;
      case 'goto':
        if (dist < (step.radius ?? 8)) return manager.advance();
        break;
      case 'driveTo':
        if (ctx.inCar && dist < (step.radius ?? 10)) return manager.advance();
        break;
      case 'survive':
        manager.surviveLeft -= dt;
        if (manager.surviveLeft <= 0) return manager.advance();
        break;
      case 'loseHeat':
        if (ctx.wantedStars === 0) return manager.advance();
        break;
      default:
        break;
    }
    return null;
  };

  manager.failText = () => manager.objective;
  return manager;
}
