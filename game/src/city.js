// Solmar Bay — procedural city data (pure, no three.js). A seeded grid city:
// roads on a square lattice, building blocks between them, a beach and sea
// to the west, parks, palms and street lamps. The road graph (nodes + edges)
// is what traffic and police pathfind on — never a navmesh.
import { CITY } from './config.js';
import { createRng, hashSeed } from './rng.js';

const N = CITY.roads;
const P = CITY.pitch;

export function roadCoord(i) { return (i - (N - 1) / 2) * P; }

function nodeId(ix, iz) { return iz * N + ix; }

export function buildCity(seed) {
  const rng = createRng(seed);
  const nodes = [];
  for (let iz = 0; iz < N; iz += 1) {
    for (let ix = 0; ix < N; ix += 1) {
      nodes.push({ id: nodeId(ix, iz), x: roadCoord(ix), z: roadCoord(iz) });
    }
  }
  // Adjacency: each intersection links to its four neighbours.
  const adj = nodes.map(() => []);
  const addEdge = (a, b) => {
    adj[a].push(b); adj[b].push(a);
  };
  for (let iz = 0; iz < N; iz += 1) {
    for (let ix = 0; ix < N; ix += 1) {
      if (ix + 1 < N) addEdge(nodeId(ix, iz), nodeId(ix + 1, iz));
      if (iz + 1 < N) addEdge(nodeId(ix, iz), nodeId(ix, iz + 1));
    }
  }

  // Buildings: one or two per block, taller toward the downtown core.
  const buildings = [];
  const colliders = [];
  const parks = new Set(['2,6', '6,2']);
  const towers = new Set(['3,3', '4,4']); // landmark plots, kept clear
  const palettes = [0xd8c9a8, 0xc9b18c, 0xe8dcc0, 0xb8a88e, 0xd9a441, 0x9fb8c8, 0xe6b8a2, 0xc7d3c0];
  for (let bz = 0; bz < N - 1; bz += 1) {
    for (let bx = 0; bx < N - 1; bx += 1) {
      const cx = (roadCoord(bx) + roadCoord(bx + 1)) / 2;
      const cz = (roadCoord(bz) + roadCoord(bz + 1)) / 2;
      if (parks.has(`${bx},${bz}`)) continue;
      if (towers.has(`${bx},${bz}`)) continue;
      const dist = Math.hypot(cx, cz) / (N * P * 0.5);
      const brng = createRng(hashSeed(seed, bx, bz));
      const count = brng.chance(0.55) ? 2 : 1;
      for (let k = 0; k < count; k += 1) {
        // Keep every footprint inside its block with room to spare: a
        // building that juts into a road pinches the lane and traps cars.
        // Block half-side is 20 m; max extent here is 17 m.
        const w = count === 1 ? brng.range(16, 26) : brng.range(14, 18);
        const d = count === 1 ? brng.range(16, 26) : brng.range(14, 18);
        const ox = count === 1 ? 0 : (k === 0 ? -8 : 8);
        const oz = count === 1 ? 0 : (k === 0 ? -8 : 8);
        const downtown = 1 - Math.min(1, dist);
        const h = Math.round(brng.range(8, 14) + downtown * downtown * brng.range(18, 62));
        const b = { x: cx + ox, z: cz + oz, w, d, h, color: brng.pick(palettes) };
        buildings.push(b);
        colliders.push({ x: b.x, z: b.z, hw: w / 2, hd: d / 2 });
      }
    }
  }
  // Two landmark towers on the marina plaza.
  const towerA = { x: -26, z: -26, w: 26, d: 26, h: 96, color: 0x8fb8d8, landmark: 'Solmar Tower' };
  const towerB = { x: 26, z: 26, w: 22, d: 22, h: 74, color: 0xd9a441, landmark: 'Harbor Exchange' };
  buildings.push(towerA, towerB);
  colliders.push(
    { x: towerA.x, z: towerA.z, hw: 13, hd: 13 },
    { x: towerB.x, z: towerB.z, hw: 11, hd: 11 },
  );

  // Spatial hash over colliders so collision is near-O(1) per query.
  const cell = 52;
  const grid = new Map();
  const keyOf = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  colliders.forEach((c, i) => {
    const x0 = Math.floor((c.x - c.hw) / cell), x1 = Math.floor((c.x + c.hw) / cell);
    const z0 = Math.floor((c.z - c.hd) / cell), z1 = Math.floor((c.z + c.hd) / cell);
    for (let gx = x0; gx <= x1; gx += 1) {
      for (let gz = z0; gz <= z1; gz += 1) {
        const k = `${gx},${gz}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
    }
  });
  function queryColliders(x, z, r) {
    const out = [];
    const seen = new Set();
    const x0 = Math.floor((x - r) / cell), x1 = Math.floor((x + r) / cell);
    const z0 = Math.floor((z - r) / cell), z1 = Math.floor((z + r) / cell);
    for (let gx = x0; gx <= x1; gx += 1) {
      for (let gz = z0; gz <= z1; gz += 1) {
        const list = grid.get(`${gx},${gz}`);
        if (!list) continue;
        for (const i of list) {
          if (!seen.has(i)) { seen.add(i); out.push(colliders[i]); }
        }
      }
    }
    return out;
  }

  // Curbside parking spots along random road edges.
  const parkingSpots = [];
  for (let i = 0; i < 40; i += 1) {
    const a = rng.int(0, nodes.length - 1);
    const nb = adj[a];
    if (!nb.length) continue;
    const b = rng.pick(nb);
    const t = rng.range(0.15, 0.85);
    const ax = nodes[a].x, az = nodes[a].z, bx = nodes[b].x, bz = nodes[b].z;
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const side = rng.chance(0.5) ? 1 : -1;
    // Right-hand side of the travel direction, just off the road.
    const rx = -dz / len * side, rz = dx / len * side;
    parkingSpots.push({
      x: ax + dx * t + rx * (CITY.roadWidth / 2 + 1.6),
      z: az + dz * t + rz * (CITY.roadWidth / 2 + 1.6),
      heading: Math.atan2(-dz, dx),
    });
  }

  // Palms: a row along the beach road and clusters in the parks.
  const palms = [];
  for (let iz = 0; iz < N; iz += 1) {
    const z = roadCoord(iz);
    for (let k = 0; k < 3; k += 1) {
      palms.push({ x: -226 + rng.range(-4, 4), z: z + (k - 1) * 14 + rng.range(-3, 3) });
    }
  }
  for (const [bx, bz] of [[2, 6], [6, 2]]) {
    const cx = (roadCoord(bx) + roadCoord(bx + 1)) / 2;
    const cz = (roadCoord(bz) + roadCoord(bz + 1)) / 2;
    for (let k = 0; k < 6; k += 1) palms.push({ x: cx + rng.range(-16, 16), z: cz + rng.range(-16, 16) });
  }

  // Street lamps at every intersection corner.
  const lamps = [];
  for (const n of nodes) {
    lamps.push({ x: n.x + 7, z: n.z + 7 });
    lamps.push({ x: n.x - 7, z: n.z - 7 });
  }

  const city = {
    seed, nodes, adj, buildings, colliders, queryColliders, parkingSpots, palms, lamps,
    parks: [...parks].map((s) => {
      const [bx, bz] = s.split(',').map(Number);
      return { x: (roadCoord(bx) + roadCoord(bx + 1)) / 2, z: (roadCoord(bz) + roadCoord(bz + 1)) / 2 };
    }),
    extent: (N - 1) * P / 2 + CITY.roadWidth,
    spawn: { x: 52, z: 104, heading: Math.PI / 2 },
    // Marina promenade on the beach, for the opening shot.
    promenade: { x: -214, z: 0 },
  };

  city.nearestNode = (x, z) => {
    let best = 0, bd = Infinity;
    for (const n of nodes) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n.id; }
    }
    return best;
  };
  city.randomNode = (r) => r.int(0, nodes.length - 1);
  // Shortest-ish route on the grid: Manhattan walk, one axis at a time.
  city.route = (from, to) => {
    const path = [from];
    let cur = from;
    const fx = cur % N, fz = Math.floor(cur / N);
    const tx = to % N, tz = Math.floor(to / N);
    let x = fx, z = fz;
    while (x !== tx) { x += Math.sign(tx - x); path.push(nodeId(x, z)); }
    while (z !== tz) { z += Math.sign(tz - z); path.push(nodeId(x, z)); }
    return path;
  };
  return city;
}
