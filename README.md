# solmar-bay

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/nemesisbug/solmar-bay/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/nemesisbug/solmar-bay/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

SOLMAR BAY — a sun-soaked open-world crime game in the browser. Play Lena "Rook" Marlowe, an ex-getaway driver pulled back for one last score: drive a living coastal city, outrun the police across five story missions, and build your wanted level from one star to five.

## Run it

```sh
node serve.ts   # then open http://localhost:8080
```

---

<sub>Entered on [make.fun](https://make.fun/?ref={referral_code}&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>

---

## Play

- **Drive / walk:** WASD or arrows. **E** enter or exit a car. **Space** handbrake.
  **Shift** sprint on foot. **F** punch. **M** mission list. **Esc** pause.
  Mouse drag orbits the camera, wheel zooms.
- **Five missions:** First Shift (taxi tutorial), Borrowed Wheels (steal a car,
  lose the tail), The Drop (timed delivery), Heat Wave (survive a 3-star
  chase), The Last Score (bank heist + beach getaway).
- **Wanted system:** crimes raise heat — 1 to 5 stars. Police pursue on the
  road graph, ram when they have a clear line, and bust you if they hold you
  still. Lose them by breaking line of sight and staying clean.
- **The city:** a seeded procedural grid — downtown towers, the marina, the
  beach, traffic, pedestrians, palms and lamps, with a full day→night cycle.
- **Sound:** engine, sirens and a three-station radio, all synthesized with
  WebAudio — no audio files. Progress saves to localStorage.

## Build

`game/` is static files (Three.js vendored under `game/vendor/`). The sim
runs at a fixed 60 Hz with a strict sim/render split: `game/src/city.js`,
`traffic.js`, `vehicles.js`, `pedestrians.js`, `missions.js`, `audio.js`,
`input.js`, `hud.js`, `render.js`, `shots.js`, `main.js` — one system per file.
`main.ts` bundles `game/` + `screenshots/` into the make.fun dossier.

Deterministic screenshot hooks: `?shot=chase|street|mission|night&seed=1`.
