// Solmar Bay — shared constants. One place for every tuning number so the
// sim, the renderer and the HUD all read the same values.
export const STEP = 1 / 60;
export const SAVE_KEY = 'solmar-bay-save-v1';

// City geometry: a grid of roads, blocks between them, sea to the west.
export const CITY = {
  roads: 9,            // roads per axis
  pitch: 52,           // metres between road centrelines
  roadWidth: 12,
  block: 40,           // building block side
  seaX: -268,          // water starts west of here
  sandX: -238,         // sand strip starts here
};

// Vehicle profiles: arcade handling tuned per class.
export const VEHICLES = {
  sedan:   { name: 'Marlin Sedan',   topSpeed: 34, accel: 15, brake: 30, grip: 8.5, steer: 0.55, color: 0x3f6fb5, mass: 1.0 },
  taxi:    { name: 'Bay Cab',        topSpeed: 32, accel: 14, brake: 30, grip: 8.0, steer: 0.55, color: 0xf2b705, mass: 1.0 },
  sports:  { name: 'Vortex GT',      topSpeed: 46, accel: 22, brake: 34, grip: 10.5, steer: 0.62, color: 0xc22430, mass: 0.9 },
  van:     { name: 'Harbor Van',     topSpeed: 28, accel: 11, brake: 26, grip: 7.0, steer: 0.45, color: 0x7a8894, mass: 1.4 },
  police:  { name: 'SBPD Cruiser',   topSpeed: 40, accel: 19, brake: 34, grip: 9.5, steer: 0.60, color: 0x1d2f45, mass: 1.1 },
};

export const PLAYER = {
  walkSpeed: 5.2,
  runSpeed: 8.6,
  radius: 0.55,
  maxHealth: 100,
};

export const WANTED = {
  // heat 0..100 maps to stars; crime adds heat, quiet time cools it.
  stealCar: 18,
  hitPed: 30,
  hitPolice: 25,
  punch: 8,
  ram: 6,
  coolDelay: 9,      // seconds of no crime before heat starts falling
  coolRate: 4,       // heat per second while cooling
  bustedHold: 2.2,   // seconds a cruiser must sit on a slow player to bust them
};

export const TRAFFIC_COUNT = 16;
export const PED_COUNT = 26;
export const PARKED_COUNT = 12;

// Day length in real seconds for a full 24 h cycle.
export const DAY_SECONDS = 480;
