// Solmar Bay — seeded random numbers (mulberry32). Every deterministic part
// of the city, traffic and missions draws from these, never Math.random, so a
// seed always rebuilds the same bay.
export function createRng(seed) {
  let a = seed >>> 0;
  return {
    next() {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    range(min, max) { return min + this.next() * (max - min); },
    int(min, max) { return Math.floor(this.range(min, max + 1)); },
    pick(list) { return list[Math.floor(this.next() * list.length)]; },
    chance(p) { return this.next() < p; },
  };
}

// Mix a seed with two integer coordinates so per-block rolls are stable
// no matter which order the city is generated in.
export function hashSeed(seed, x, z) {
  let h = (seed ^ Math.imul(x + 1, 374761393) ^ Math.imul(z + 1, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
