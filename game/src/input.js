// Solmar Bay — one input abstraction. Keyboard, mouse drag and wheel all
// feed the same intent; the game reads intent, never raw keys.
export function createInput(canvas) {
  const input = {
    keys: new Set(),
    pressed: new Set(),   // edge-triggered, consumed by the game each step
    mouseDown: false,
    orbitDX: 0,           // accumulated mouse-drag yaw since last read
    orbitDY: 0,
    wheel: 0,             // accumulated wheel zoom since last read
  };

  const KEYMAP = {
    KeyW: 'up', ArrowUp: 'up',
    KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right',
    Space: 'handbrake',
    ShiftLeft: 'sprint', ShiftRight: 'sprint',
    KeyE: 'enter', KeyF: 'punch', KeyM: 'missions',
    Escape: 'pause', KeyP: 'pause', KeyR: 'radio', Enter: 'confirm',
  };

  window.addEventListener('keydown', (e) => {
    const action = KEYMAP[e.code];
    if (!action) return;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (!input.keys.has(action)) input.pressed.add(action);
    input.keys.add(action);
  });
  window.addEventListener('keyup', (e) => {
    const action = KEYMAP[e.code];
    if (action) input.keys.delete(action);
  });
  window.addEventListener('blur', () => { input.keys.clear(); });

  canvas.addEventListener('mousedown', (e) => { input.mouseDown = true; });
  window.addEventListener('mouseup', () => { input.mouseDown = false; });
  window.addEventListener('mousemove', (e) => {
    if (!input.mouseDown) return;
    input.orbitDX += e.movementX || 0;
    input.orbitDY += e.movementY || 0;
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    input.wheel += e.deltaY;
  }, { passive: false });

  // Driving: throttle -1..1, steer -1..1. Walking: forward/strafe -1..1.
  input.drive = () => ({
    throttle: (input.keys.has('up') ? 1 : 0) - (input.keys.has('down') ? 1 : 0),
    steer: (input.keys.has('left') ? 1 : 0) - (input.keys.has('right') ? 1 : 0),
    handbrake: input.keys.has('handbrake'),
  });
  input.walk = () => ({
    forward: (input.keys.has('up') ? 1 : 0) - (input.keys.has('down') ? 1 : 0),
    strafe: (input.keys.has('right') ? 1 : 0) - (input.keys.has('left') ? 1 : 0),
    sprint: input.keys.has('sprint'),
  });

  input.wasPressed = (action) => input.pressed.has(action);
  input.consumePressed = (action) => {
    const hit = input.pressed.has(action);
    if (hit) input.pressed.delete(action);
    return hit;
  };
  input.clearPressed = () => input.pressed.clear();
  input.takeOrbit = () => {
    const dx = input.orbitDX, dy = input.orbitDY;
    input.orbitDX = 0; input.orbitDY = 0;
    return { dx, dy };
  };
  input.takeWheel = () => {
    const w = input.wheel;
    input.wheel = 0;
    return w;
  };
  return input;
}
