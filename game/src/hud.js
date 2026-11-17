// Solmar Bay — the HUD is DOM over the canvas: cash/health bars, wanted
// stars, a live minimap radar, mission objective, dialog box, speedometer
// and the start/pause/end menus. The minimap redraws from the same city
// data the sim uses, so it can never disagree with the world.
import { CITY } from './config.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const hud = {
    dialogQueue: [],
    toastTimer: 0,
    onPlay: null, onContinue: null, onResume: null,
    onRestartMission: null, onQuitMenu: null, onRespawn: null,
    onMissionPick: null,
  };

  const el = {
    cash: $('cash'), healthFill: $('healthFill'), carFill: $('carFill'), carLabel: $('carLabel'),
    stars: $('stars'), minimap: $('minimap'), clockTime: $('clockTime'), clockDay: $('clockDay'),
    objTitle: $('objTitle'), objText: $('objText'), objDist: $('objDist'),
    speed: $('speed'), carName: $('carName'),
    dialog: $('dialog'), dlgWho: $('dlgWho'), dlgText: $('dlgText'),
    prompt: $('prompt'), toast: $('toast'),
    menu: $('menu'), pauseMenu: $('pauseMenu'), endMenu: $('endMenu'),
    endTitle: $('endTitle'), endText: $('endText'), missionList: $('missionList'),
    status: $('status'),
  };
  const mapCtx = el.minimap.getContext('2d');

  $('btnPlay').addEventListener('click', () => hud.onPlay && hud.onPlay());
  $('btnContinue').addEventListener('click', () => hud.onContinue && hud.onContinue());
  $('btnResume').addEventListener('click', () => hud.onResume && hud.onResume());
  $('btnRestartMission').addEventListener('click', () => hud.onRestartMission && hud.onRestartMission());
  $('btnQuitMenu').addEventListener('click', () => hud.onQuitMenu && hud.onQuitMenu());
  $('btnRespawn').addEventListener('click', () => hud.onRespawn && hud.onRespawn());
  $('btnMissions').addEventListener('click', () => {
    const list = el.missionList;
    list.style.display = list.style.display === 'none' ? 'block' : 'none';
  });
  el.dialog.addEventListener('click', () => hud.advanceDialog());

  hud.setMissionList = (defs, done, current) => {
    el.missionList.innerHTML = defs.map((d, i) => {
      const cls = done.has(d.id) ? 'done' : (i === current ? 'cur' : '');
      const mark = done.has(d.id) ? '✓ ' : (i === current ? '▸ ' : '· ');
      return `<div class="${cls}">${mark}${d.id}. ${d.title} — ${d.brief}</div>`;
    }).join('');
  };

  hud.showMenu = (show, hasSave) => {
    el.menu.style.display = show ? 'flex' : 'none';
    $('btnContinue').style.display = hasSave ? 'inline-block' : 'none';
  };
  hud.showPause = (show) => { el.pauseMenu.style.display = show ? 'flex' : 'none'; };
  hud.showEnd = (title, text) => {
    el.endTitle.textContent = title;
    el.endText.textContent = text;
    el.endMenu.style.display = 'flex';
  };
  hud.hideEnd = () => { el.endMenu.style.display = 'none'; };

  hud.queueDialog = (lines) => {
    if (!lines.length) return;
    const showing = hud.hasDialog();
    hud.dialogQueue.push(...lines);
    if (!showing) hud.advanceDialog();
  };
  hud.advanceDialog = () => {
    const next = hud.dialogQueue.shift();
    if (!next) { el.dialog.style.display = 'none'; return false; }
    el.dlgWho.textContent = next.who;
    el.dlgText.textContent = next.text;
    el.dialog.style.display = 'block';
    return true;
  };
  hud.hasDialog = () => el.dialog.style.display === 'block';
  hud.clearDialog = () => { hud.dialogQueue.length = 0; el.dialog.style.display = 'none'; };

  hud.setPrompt = (html) => {
    if (!html) { el.prompt.style.display = 'none'; return; }
    el.prompt.innerHTML = html;
    el.prompt.style.display = 'block';
  };

  hud.toast = (text) => {
    el.toast.textContent = text;
    el.toast.style.display = 'block';
    hud.toastTimer = 3;
  };

  function drawMinimap(state) {
    const { city, player, cars, peds, marker } = state;
    const S = 208;
    const span = city.extent * 2 + 90;
    const toMap = (x, z) => [(x + span / 2) / span * S, (z + span / 2) / span * S];
    mapCtx.fillStyle = '#0a2033';
    mapCtx.fillRect(0, 0, S, S);
    // Sea to the west.
    const [seaX] = toMap(CITY.seaX, 0);
    mapCtx.fillStyle = '#1d6f9e';
    mapCtx.fillRect(0, 0, Math.max(0, seaX), S);
    mapCtx.fillStyle = '#d9c48f';
    const [sandX] = toMap(CITY.sandX, 0);
    mapCtx.fillRect(seaX, 0, Math.max(0, sandX - seaX), S);
    // Buildings.
    mapCtx.fillStyle = '#3a4a58';
    for (const b of city.buildings) {
      const [x, y] = toMap(b.x - b.w / 2, b.z - b.d / 2);
      mapCtx.fillRect(x, y, Math.max(1, b.w / span * S), Math.max(1, b.d / span * S));
    }
    // Roads.
    mapCtx.strokeStyle = '#8a97a3';
    mapCtx.lineWidth = 2;
    for (let i = 0; i < CITY.roads; i += 1) {
      const c = (i - (CITY.roads - 1) / 2) * CITY.pitch;
      const [x0] = toMap(c, 0);
      const [, y0] = toMap(0, c);
      mapCtx.beginPath(); mapCtx.moveTo(x0, 0); mapCtx.lineTo(x0, S); mapCtx.stroke();
      mapCtx.beginPath(); mapCtx.moveTo(0, y0); mapCtx.lineTo(S, y0); mapCtx.stroke();
    }
    // Mission marker: a pulsing yellow diamond.
    if (marker) {
      const [mx, my] = toMap(marker.x, marker.z);
      const pulse = 5 + Math.sin(performance.now() / 300) * 2;
      mapCtx.fillStyle = '#ffd94d';
      mapCtx.beginPath();
      mapCtx.moveTo(mx, my - pulse - 3); mapCtx.lineTo(mx + pulse, my);
      mapCtx.lineTo(mx, my + pulse + 3); mapCtx.lineTo(mx - pulse, my);
      mapCtx.closePath(); mapCtx.fill();
    }
    // Traffic dots, police in red/blue, peds faint.
    for (const ped of peds) {
      const [x, y] = toMap(ped.x, ped.z);
      mapCtx.fillStyle = 'rgba(220,220,220,0.5)';
      mapCtx.fillRect(x - 1, y - 1, 2, 2);
    }
    for (const car of cars) {
      const [x, y] = toMap(car.veh.x, car.veh.z);
      if (car.role === 'police') {
        mapCtx.fillStyle = (Math.floor(performance.now() / 300) % 2) ? '#ff4444' : '#4488ff';
        mapCtx.beginPath(); mapCtx.arc(x, y, 3.5, 0, Math.PI * 2); mapCtx.fill();
      } else if (car.role === 'traffic') {
        mapCtx.fillStyle = '#e8e8e8';
        mapCtx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    }
    // Player arrow, rotated to the heading.
    const [px, py] = toMap(player.x, player.z);
    const heading = player.heading ?? 0;
    mapCtx.save();
    mapCtx.translate(px, py);
    mapCtx.rotate(-heading);
    mapCtx.fillStyle = '#ffffff';
    mapCtx.strokeStyle = '#111';
    mapCtx.lineWidth = 1;
    mapCtx.beginPath();
    mapCtx.moveTo(7, 0); mapCtx.lineTo(-5, -4.5); mapCtx.lineTo(-5, 4.5);
    mapCtx.closePath(); mapCtx.fill(); mapCtx.stroke();
    mapCtx.restore();
  }

  hud.update = (state, dt) => {
    el.cash.innerHTML = `$${Math.floor(state.cash).toLocaleString('en-US')} <small>CASH</small>`;
    el.healthFill.style.width = `${Math.max(0, state.health)}%`;
    el.carLabel.textContent = state.inCar ? `CAR — ${state.carName}` : 'CAR';
    el.carFill.style.width = `${state.inCar ? Math.max(0, state.carHealth) : 0}%`;
    let stars = '';
    for (let i = 0; i < 5; i += 1) stars += `<span class="${i < state.stars ? '' : 'off'}">★</span>`;
    el.stars.innerHTML = stars;
    const hours = Math.floor(state.timeOfDay) % 24;
    const mins = Math.floor((state.timeOfDay % 1) * 60);
    el.clockTime.textContent = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    el.clockDay.textContent = hours >= 19 || hours < 6 ? 'SOLMAR BAY — NIGHT' : 'SOLMAR BAY';
    el.objText.textContent = state.objective;
    el.objDist.textContent = state.objectiveDist ?? '';
    el.speed.innerHTML = `${Math.round(Math.abs(state.speedKmh))} <small>KM/H</small>`;
    el.carName.textContent = state.inCar ? state.carName : 'ON FOOT';
    if (hud.toastTimer > 0) {
      hud.toastTimer -= dt;
      if (hud.toastTimer <= 0) el.toast.style.display = 'none';
    }
    drawMinimap(state);
    el.status.textContent = state.objective;
  };

  return hud;
}
