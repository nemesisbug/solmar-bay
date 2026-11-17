// Solmar Bay — the render layer (the only file that imports three.js).
// The sim owns all state; this file only reads it and paints it. Draw calls
// stay tiny: one InstancedMesh per thing type (buildings, car bodies,
// cabins, wheels, peds, palms, lamps), one ground, one sea.
import * as THREE from 'three';
import { CITY } from './config.js';

const MAX_CARS = 40;
const MAX_POLICE = 5;
const MAX_PEDS = 40;
const SPAN = CITY.roads * CITY.pitch + 60;

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function makeWindowTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#e8e2d4';
  g.fillRect(0, 0, 128, 256);
  for (let y = 8; y < 248; y += 16) {
    for (let x = 8; x < 120; x += 16) {
      const lit = ((x * 7 + y * 13) % 5) < 2;
      g.fillStyle = lit ? '#ffd98a' : '#2c3a48';
      g.fillRect(x, y, 9, 10);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGroundTexture(city) {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const px = (x) => (x + SPAN / 2) / SPAN * S;
  const py = (z) => (z + SPAN / 2) / SPAN * S;
  // Base: sun-baked concrete.
  g.fillStyle = '#b7a98c';
  g.fillRect(0, 0, S, S);
  // Beach sand west of the city, then the sea is its own plane.
  g.fillStyle = '#e0c98f';
  g.fillRect(0, 0, px(CITY.sandX), S);
  // Parks.
  g.fillStyle = '#6fae5f';
  for (const p of city.parks) g.fillRect(px(p.x - 20), py(p.z - 20), px(40) - px(0), py(40) - py(0));
  // Roads: dark asphalt with lighter sidewalks.
  for (let i = 0; i < CITY.roads; i += 1) {
    const coord = (i - (CITY.roads - 1) / 2) * CITY.pitch;
    const w = CITY.roadWidth;
    g.fillStyle = '#c9bfa8';
    g.fillRect(px(coord - w / 2 - 2.5), 0, px(w + 5) - px(0), S);
    g.fillRect(0, py(coord - w / 2 - 2.5), S, py(w + 5) - py(0));
    g.fillStyle = '#3c3f45';
    g.fillRect(px(coord - w / 2), 0, px(w) - px(0), S);
    g.fillRect(0, py(coord - w / 2), S, py(w) - py(0));
    // Dashed centre lines.
    g.fillStyle = '#e8d44f';
    for (let d = -260; d < 260; d += 16) {
      g.fillRect(px(coord) - 1, py(d), 2, 8);
      g.fillRect(px(d), py(coord) - 1, 8, 2);
    }
  }
  // Crosswalks at every intersection.
  g.fillStyle = '#e8e8e8';
  for (let iz = 0; iz < CITY.roads; iz += 1) {
    for (let ix = 0; ix < CITY.roads; ix += 1) {
      const x = (ix - (CITY.roads - 1) / 2) * CITY.pitch;
      const z = (iz - (CITY.roads - 1) / 2) * CITY.pitch;
      for (let k = -2; k <= 2; k += 1) {
        g.fillRect(px(x - 5 + k * 2), py(z - 8), 1.5, 4);
        g.fillRect(px(x - 5 + k * 2), py(z + 4), 1.5, 4);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeWaveTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#2a7fb5';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(255,255,255,0.25)';
  g.lineWidth = 2;
  for (let i = 0; i < 24; i += 1) {
    g.beginPath();
    const y = (i * 37) % 256;
    g.moveTo(0, y);
    g.bezierCurveTo(80, y - 8, 170, y + 8, 256, y);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createRenderer(canvas, city) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7ec8e3);
  scene.fog = new THREE.Fog(0x9ecfe8, 120, 620);

  const hemi = new THREE.HemisphereLight(0xbfdfff, 0x8a7a5a, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -260; sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260; sun.shadow.camera.bottom = -260;
  sun.shadow.camera.far = 800;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);

  // Ground + sea.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(SPAN, SPAN),
    new THREE.MeshStandardMaterial({ map: makeGroundTexture(city), roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const waveTex = makeWaveTexture();
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(500, SPAN + 200),
    new THREE.MeshStandardMaterial({ map: waveTex, roughness: 0.35, metalness: 0.1 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(CITY.seaX - 250, -0.15, 0);
  scene.add(sea);

  // Buildings: one instanced box with a window texture, tinted per instance.
  const windowTex = makeWindowTexture();
  const buildingMat = new THREE.MeshStandardMaterial({
    map: windowTex, emissiveMap: windowTex, emissive: 0xffffff,
    emissiveIntensity: 0.05, roughness: 0.85,
  });
  const buildings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), buildingMat, city.buildings.length);
  buildings.castShadow = true;
  buildings.receiveShadow = true;
  const roofs = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x4a4640, roughness: 0.9 }),
    city.buildings.length,
  );
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sv = new THREE.Vector3();
  const pv = new THREE.Vector3();
  const col = new THREE.Color();
  city.buildings.forEach((b, i) => {
    m4.compose(pv.set(b.x, b.h / 2, b.z), q.identity(), sv.set(b.w, b.h, b.d));
    buildings.setMatrixAt(i, m4);
    buildings.setColorAt(i, col.setHex(b.color));
    m4.compose(pv.set(b.x, b.h + 0.2, b.z), q.identity(), sv.set(b.w + 0.4, 0.4, b.d + 0.4));
    roofs.setMatrixAt(i, m4);
  });
  buildings.instanceMatrix.needsUpdate = true;
  roofs.instanceMatrix.needsUpdate = true;
  scene.add(buildings);
  scene.add(roofs);

  // Landmark beacons on the two towers.
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0xff4444, emissive: 0xff2222, emissiveIntensity: 1.5 });
  const beaconA = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 8), beaconMat);
  beaconA.position.set(-26, 98, -26);
  scene.add(beaconA);
  const beaconB = new THREE.Mesh(new THREE.SphereGeometry(1.0, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xffd94d, emissive: 0xffb400, emissiveIntensity: 1.5 }));
  beaconB.position.set(26, 76, 26);
  scene.add(beaconB);

  // Cars: body + cabin + 4 wheels per car, all instanced.
  const carBody = new THREE.InstancedMesh(
    new THREE.BoxGeometry(4.4, 0.72, 2.0),
    new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.4 }),
    MAX_CARS,
  );
  carBody.castShadow = true;
  const carCabin = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2.1, 0.55, 1.7),
    new THREE.MeshStandardMaterial({ color: 0x1a2733, roughness: 0.15, metalness: 0.7 }),
    MAX_CARS,
  );
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
  wheelGeo.rotateX(Math.PI / 2);
  const wheels = new THREE.InstancedMesh(
    wheelGeo,
    new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 }),
    MAX_CARS * 4,
  );
  const barGeo = new THREE.BoxGeometry(0.5, 0.22, 0.8);
  const redBar = new THREE.InstancedMesh(barGeo,
    new THREE.MeshStandardMaterial({ color: 0xaa1111, emissive: 0xff2222, emissiveIntensity: 2 }), MAX_POLICE);
  const blueBar = new THREE.InstancedMesh(barGeo,
    new THREE.MeshStandardMaterial({ color: 0x1122aa, emissive: 0x2244ff, emissiveIntensity: 2 }), MAX_POLICE);
  scene.add(carBody, carCabin, wheels, redBar, blueBar);

  // Pedestrians: body + head, instanced.
  const pedBody = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.3, 0.36, 1.05, 8),
    new THREE.MeshStandardMaterial({ roughness: 0.9 }),
    MAX_PEDS,
  );
  pedBody.castShadow = true;
  const pedHead = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.21, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xd9a986, roughness: 0.8 }),
    MAX_PEDS,
  );
  scene.add(pedBody, pedHead);

  // Rook herself, on foot: red jacket, so the player is easy to spot
  // among the pedestrians. Hidden while she is driving.
  const playerBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.37, 1.1, 8),
    new THREE.MeshStandardMaterial({ color: 0xc22430, roughness: 0.8 }),
  );
  playerBody.castShadow = true;
  const playerHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xd9a986, roughness: 0.8 }),
  );
  scene.add(playerBody, playerHead);

  // Palms: trunk + canopy.
  const palmTrunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.12, 0.18, 4.6, 6),
    new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.95 }),
    city.palms.length,
  );
  const palmTop = new THREE.InstancedMesh(
    new THREE.ConeGeometry(2.3, 2.4, 7),
    new THREE.MeshStandardMaterial({ color: 0x2f7d3a, roughness: 0.9 }),
    city.palms.length,
  );
  city.palms.forEach((p, i) => {
    m4.compose(pv.set(p.x, 2.3, p.z), q.identity(), sv.set(1, 1, 1));
    palmTrunk.setMatrixAt(i, m4);
    m4.compose(pv.set(p.x, 5.4, p.z), q.identity(), sv.set(1, 1, 1));
    palmTop.setMatrixAt(i, m4);
  });
  palmTrunk.instanceMatrix.needsUpdate = true;
  palmTop.instanceMatrix.needsUpdate = true;
  scene.add(palmTrunk, palmTop);

  // Street lamps: pole + glowing head.
  const lampPole = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.07, 0.09, 5, 6),
    new THREE.MeshStandardMaterial({ color: 0x2c3136, roughness: 0.6, metalness: 0.5 }),
    city.lamps.length,
  );
  const lampHeadMat = new THREE.MeshStandardMaterial({
    color: 0xffe9a8, emissive: 0xffc94d, emissiveIntensity: 0.15, roughness: 0.4,
  });
  const lampHead = new THREE.InstancedMesh(new THREE.SphereGeometry(0.26, 8, 6), lampHeadMat, city.lamps.length);
  city.lamps.forEach((l, i) => {
    m4.compose(pv.set(l.x, 2.5, l.z), q.identity(), sv.set(1, 1, 1));
    lampPole.setMatrixAt(i, m4);
    m4.compose(pv.set(l.x, 5.1, l.z), q.identity(), sv.set(1, 1, 1));
    lampHead.setMatrixAt(i, m4);
  });
  lampPole.instanceMatrix.needsUpdate = true;
  lampHead.instanceMatrix.needsUpdate = true;
  scene.add(lampPole, lampHead);

  // Player headlights at night.
  const headlight = new THREE.SpotLight(0xfff2c8, 0, 55, 0.55, 0.5, 1.2);
  scene.add(headlight);
  scene.add(headlight.target);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1200);
  const camState = { yaw: 0, pitch: 0.32, dist: 11, pos: new THREE.Vector3(0, 30, 60), look: new THREE.Vector3() };

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  const skyDay = new THREE.Color(0x7ec8e3);
  const skyDusk = new THREE.Color(0xff9a5c);
  const skyNight = new THREE.Color(0x0a1626);
  const tmpSky = new THREE.Color();

  function setTimeOfDay(t) {
    // Sun elevation: up at 06:00, down at 18:00.
    const ang = ((t - 6) / 12) * Math.PI;
    const elev = Math.sin(ang);
    const dayF = clamp(elev * 2.2, 0, 1);
    const duskF = clamp(1 - Math.abs(elev) * 3.2, 0, 1) * (t > 6 && t < 20 ? 1 : 0);
    tmpSky.copy(skyNight).lerp(skyDay, dayF).lerp(skyDusk, duskF * 0.55);
    scene.background.copy(tmpSky);
    scene.fog.color.copy(tmpSky);
    sun.position.set(Math.cos(ang) * 320, Math.max(24, elev * 320 + 40), 140);
    sun.intensity = 0.4 + dayF * 1.3;
    sun.color.setHex(duskF > 0.4 ? 0xffb27a : 0xfff2d8);
    hemi.intensity = 0.4 + dayF * 0.55;
    buildingMat.emissiveIntensity = lerp(1.25, 0.05, dayF);
    lampHeadMat.emissiveIntensity = lerp(2.2, 0.12, dayF);
    beaconMat.emissiveIntensity = lerp(2.5, 0.6, dayF);
    return dayF;
  }

  const wheelOffsets = [
    { x: 1.45, z: 0.95 }, { x: 1.45, z: -0.95 },
    { x: -1.45, z: 0.95 }, { x: -1.45, z: -0.95 },
  ];
  const euler = new THREE.Euler();
  const tmpQ = new THREE.Quaternion();
  const zeroScale = new THREE.Vector3(0.0001, 0.0001, 0.0001);
  const oneScale = new THREE.Vector3(1, 1, 1);

  function putCar(i, veh, wobble) {
    euler.set(0, veh.heading, 0);
    tmpQ.setFromEuler(euler);
    const bob = wobble ? Math.sin(performance.now() / 40) * 0.05 * wobble : 0;
    m4.compose(pv.set(veh.x, 0.55 + bob, veh.z), tmpQ, sv.set(1, 1, 1));
    carBody.setMatrixAt(i, m4);
    carBody.setColorAt(i, col.setHex(veh.color));
    m4.compose(pv.set(veh.x - Math.cos(veh.heading) * 0.25, 1.12 + bob, veh.z + Math.sin(veh.heading) * 0.25), tmpQ, sv.set(1, 1, 1));
    carCabin.setMatrixAt(i, m4);
    for (let w = 0; w < 4; w += 1) {
      const o = wheelOffsets[w];
      // Local wheel offset rotated by heading into world space.
      const lx = o.x, lz = o.z;
      const cos = Math.cos(veh.heading), sin = Math.sin(veh.heading);
      m4.compose(pv.set(veh.x + cos * lx + sin * lz, 0.36, veh.z - sin * lx + cos * lz), tmpQ, sv.set(1, 1, 1));
      wheels.setMatrixAt(i * 4 + w, m4);
    }
  }

  let shake = 0;
  const api = {
    scene, camera,
    setShake(v) { shake = Math.max(shake, v); },
    // Put the camera straight behind the target with no smoothing lag
    // (screenshot staging: the first painted frame must already be framed).
    snapCamera(target, heading) {
      const camYaw = (heading ?? 0) + Math.PI;
      camState.yaw = 0;
      camState.pos.set(
        target.x + Math.cos(camYaw) * 11,
        4.6,
        target.z - Math.sin(camYaw) * 11,
      );
    },
    update(sim, dt) {
      const dayF = setTimeOfDay(sim.timeOfDay);
      waveTex.offset.x += dt * 0.008;
      waveTex.offset.y += dt * 0.004;

      // Cars: player car first, then traffic/police/parked.
      const list = [];
      if (sim.playerCar) list.push(sim.playerCar);
      for (const c of sim.cars) list.push(c.veh);
      for (let i = 0; i < MAX_CARS; i += 1) {
        if (i < list.length) putCar(i, list[i], list[i].crashed > 0 ? 1 : 0);
        else {
          m4.compose(pv.set(0, -50, 0), q.identity(), zeroScale);
          carBody.setMatrixAt(i, m4);
          carCabin.setMatrixAt(i, m4);
          for (let w = 0; w < 4; w += 1) wheels.setMatrixAt(i * 4 + w, m4);
        }
      }
      carBody.instanceMatrix.needsUpdate = true;
      carCabin.instanceMatrix.needsUpdate = true;
      wheels.instanceMatrix.needsUpdate = true;
      if (carBody.instanceColor) carBody.instanceColor.needsUpdate = true;

      // Police light bars flash red/blue, alternating.
      const flash = Math.floor(performance.now() / 350) % 2 === 0;
      let pi = 0;
      for (const c of sim.cars) {
        if (c.role !== 'police' || pi >= MAX_POLICE) continue;
        const v = c.veh;
        euler.set(0, v.heading, 0);
        tmpQ.setFromEuler(euler);
        const on = flash;
        const off = new THREE.Matrix4().compose(pv.set(0, -50, 0), q.identity(), zeroScale);
        // Light bar split across the roof: red on the left, blue on the right.
        const sinH = Math.sin(v.heading), cosH = Math.cos(v.heading);
        const red = new THREE.Matrix4().compose(
          pv.set(v.x - sinH * 0.5, 1.45, v.z - cosH * 0.5),
          tmpQ, on ? oneScale : zeroScale);
        const blue = new THREE.Matrix4().compose(
          pv.set(v.x + sinH * 0.5, 1.45, v.z + cosH * 0.5),
          tmpQ, on ? zeroScale : oneScale);
        redBar.setMatrixAt(pi, red);
        blueBar.setMatrixAt(pi, blue);
        pi += 1;
      }
      for (; pi < MAX_POLICE; pi += 1) {
        m4.compose(pv.set(0, -50, 0), q.identity(), zeroScale);
        redBar.setMatrixAt(pi, m4);
        blueBar.setMatrixAt(pi, m4);
      }
      redBar.instanceMatrix.needsUpdate = true;
      blueBar.instanceMatrix.needsUpdate = true;

      // Pedestrians.
      for (let i = 0; i < MAX_PEDS; i += 1) {
        const ped = sim.peds[i];
        if (!ped) {
          m4.compose(pv.set(0, -50, 0), q.identity(), zeroScale);
          pedBody.setMatrixAt(i, m4);
          pedHead.setMatrixAt(i, m4);
          continue;
        }
        euler.set(0, ped.heading, 0);
        tmpQ.setFromEuler(euler);
        const bob = ped.state === 'down' ? 0 : Math.abs(Math.sin(ped.bobPhase)) * 0.08;
        const bodyY = ped.state === 'down' ? 0.25 : 0.55 + bob;
        if (ped.state === 'down') euler.set(0, ped.heading, Math.PI / 2);
        tmpQ.setFromEuler(euler);
        m4.compose(pv.set(ped.x, bodyY, ped.z), tmpQ, sv.set(1, 1, 1));
        pedBody.setMatrixAt(i, m4);
        pedBody.setColorAt(i, col.setHex(ped.color));
        const headY = ped.state === 'down' ? 0.3 : 1.32 + bob;
        m4.compose(pv.set(ped.x + (ped.state === 'down' ? 0.7 : 0), headY, ped.z), tmpQ, sv.set(1, 1, 1));
        pedHead.setMatrixAt(i, m4);
      }
      pedBody.instanceMatrix.needsUpdate = true;
      pedHead.instanceMatrix.needsUpdate = true;
      if (pedBody.instanceColor) pedBody.instanceColor.needsUpdate = true;

      // Rook on foot (hidden while driving).
      if (!sim.playerCar) {
        const p = sim.player;
        const moving = Math.hypot(p.vx, p.vz);
        const bob = Math.abs(Math.sin(performance.now() / 130)) * 0.07 * Math.min(1, moving / 4);
        playerBody.position.set(p.x, 0.55 + bob, p.z);
        playerBody.rotation.y = p.heading;
        playerHead.position.set(p.x, 1.32 + bob, p.z);
        playerHead.rotation.y = p.heading;
        playerBody.visible = true;
        playerHead.visible = true;
      } else {
        playerBody.visible = false;
        playerHead.visible = false;
      }

      // Headlights: on at night, only while driving.
      const night = dayF < 0.35;
      if (sim.playerCar && night) {
        const v = sim.playerCar;
        const fx = Math.cos(v.heading), fz = -Math.sin(v.heading);
        headlight.position.set(v.x + fx * 2, 1.1, v.z + fz * 2);
        headlight.target.position.set(v.x + fx * 26, 0.4, v.z + fz * 26);
        headlight.intensity = 60;
      } else {
        headlight.intensity = 0;
      }

      // Chase camera with mouse orbit, wheel zoom and trauma shake.
      const target = sim.playerCar || sim.player;
      const heading = target.heading ?? 0;
      const orbit = sim.cameraOrbit || { dx: 0, dy: 0, wheel: 0 };
      camState.yaw += orbit.dx * 0.005;
      camState.pitch = clamp(camState.pitch + orbit.dy * 0.003, 0.08, 0.9);
      camState.dist = clamp(camState.dist + orbit.wheel * 0.01, 7, 20);
      const camYaw = heading + Math.PI + camState.yaw;
      const speed = Math.abs(sim.playerCar ? sim.playerCar.speed : 0);
      const wantDist = sim.playerCar ? camState.dist + speed * 0.08 : 7.5;
      const wantH = sim.playerCar ? 3.4 + camState.pitch * 4 : 3.2;
      const cx = target.x + Math.cos(camYaw) * wantDist;
      const cz = target.z - Math.sin(camYaw) * wantDist;
      const k = 1 - Math.exp(-dt * 5);
      camState.pos.x += (cx - camState.pos.x) * k;
      camState.pos.y += (wantH - camState.pos.y) * k;
      camState.pos.z += (cz - camState.pos.z) * k;
      shake = Math.max(0, shake - dt * 1.8);
      const sh = shake * shake * 0.9;
      camera.position.set(
        camState.pos.x + (Math.random() - 0.5) * sh,
        camState.pos.y + (Math.random() - 0.5) * sh * 0.6,
        camState.pos.z + (Math.random() - 0.5) * sh,
      );
      camState.look.set(
        target.x + Math.cos(heading) * 5,
        1.4,
        target.z - Math.sin(heading) * 5,
      );
      camera.lookAt(camState.look);
      renderer.render(scene, camera);
    },
  };
  return api;
}
