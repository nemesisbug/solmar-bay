// Solmar Bay — all sound is synthesized with WebAudio. No audio files:
// an engine drone that follows speed, a two-tone siren, a laid-back
// coastal music loop (pad chords + bass + hat), and one-shot effects.
export function createAudio() {
  const audio = {
    ctx: null, master: null, musicGain: null, engineOsc: null, engineGain: null,
    sirenOsc: null, sirenGain: null, sirenTimer: 0, sirenHigh: false,
    muted: false, musicOn: false, musicTimer: 0, musicStep: 0,
    radioStation: 0,
  };

  // Must be called from a user gesture at least once.
  audio.ensure = () => {
    if (audio.ctx) {
      if (audio.ctx.state === 'suspended') audio.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio.ctx = new AC();
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = 0.5;
    audio.master.connect(audio.ctx.destination);
    // Engine: a sawtooth through a low-pass, pitch follows speed.
    audio.engineOsc = audio.ctx.createOscillator();
    audio.engineOsc.type = 'sawtooth';
    audio.engineOsc.frequency.value = 55;
    const engineFilter = audio.ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 420;
    audio.engineGain = audio.ctx.createGain();
    audio.engineGain.gain.value = 0;
    audio.engineOsc.connect(engineFilter);
    engineFilter.connect(audio.engineGain);
    audio.engineGain.connect(audio.master);
    audio.engineOsc.start();
    // Siren: a square wave that flips between two tones.
    audio.sirenOsc = audio.ctx.createOscillator();
    audio.sirenOsc.type = 'square';
    audio.sirenOsc.frequency.value = 780;
    audio.sirenGain = audio.ctx.createGain();
    audio.sirenGain.gain.value = 0;
    audio.sirenOsc.connect(audio.sirenGain);
    audio.sirenGain.connect(audio.master);
    audio.sirenOsc.start();
    // Music bus.
    audio.musicGain = audio.ctx.createGain();
    audio.musicGain.gain.value = 0.16;
    audio.musicGain.connect(audio.master);
  };

  audio.setEngine = (speedKmh, driving) => {
    if (!audio.ctx) return;
    const target = driving ? 0.05 + Math.min(0.09, Math.abs(speedKmh) / 1600) : 0;
    audio.engineGain.gain.setTargetAtTime(target, audio.ctx.currentTime, 0.1);
    audio.engineOsc.frequency.setTargetAtTime(48 + Math.abs(speedKmh) * 1.9, audio.ctx.currentTime, 0.08);
  };

  audio.setSiren = (on) => {
    if (!audio.ctx) return;
    audio.sirenGain.gain.setTargetAtTime(on ? 0.035 : 0, audio.ctx.currentTime, 0.15);
  };

  audio.update = (dt) => {
    if (!audio.ctx) return;
    if (audio.sirenGain.gain.value > 0.005) {
      audio.sirenTimer -= dt;
      if (audio.sirenTimer <= 0) {
        audio.sirenTimer = 0.42;
        audio.sirenHigh = !audio.sirenHigh;
        audio.sirenOsc.frequency.setTargetAtTime(audio.sirenHigh ? 780 : 620, audio.ctx.currentTime, 0.05);
      }
    }
    if (audio.musicOn) audio.musicTick(dt);
  };

  // Music: Am – F – C – G pad, a bass root each bar, a soft hat tick.
  // Stations only change the tempo/feel, all from the same synth.
  const CHORDS = [
    [220.0, 261.6, 329.6], [174.6, 220.0, 261.6],
    [261.6, 329.6, 392.0], [196.0, 246.9, 293.7],
  ];
  const TEMPOS = [96, 122, 76];
  audio.musicTick = (dt) => {
    audio.musicTimer -= dt;
    if (audio.musicTimer > 0) return;
    const bpm = TEMPOS[audio.radioStation % TEMPOS.length];
    const beat = 60 / bpm;
    audio.musicTimer = beat / 2;
    const step = audio.musicStep;
    audio.musicStep += 1;
    const bar = Math.floor(step / 8) % 4;
    const chord = CHORDS[bar];
    if (step % 8 === 0) {
      for (const freq of chord) audio.tone(freq, beat * 7.5, 'sine', 0.05, audio.musicGain);
      audio.tone(chord[0] / 2, beat * 7, 'triangle', 0.09, audio.musicGain);
    }
    if (step % 2 === 0) audio.noise(0.03, 0.02, audio.musicGain); // hat tick
    if (step % 4 === 2) audio.tone(chord[1] / 2, beat * 1.5, 'triangle', 0.06, audio.musicGain);
  };

  audio.tone = (freq, dur, type, vol, dest) => {
    if (!audio.ctx) return;
    const t0 = audio.ctx.currentTime;
    const osc = audio.ctx.createOscillator();
    const g = audio.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(dest || audio.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  };

  audio.noise = (dur, vol, dest) => {
    if (!audio.ctx) return;
    const t0 = audio.ctx.currentTime;
    const len = Math.max(1, Math.floor(audio.ctx.sampleRate * dur));
    const buf = audio.ctx.createBuffer(1, len, audio.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = audio.ctx.createBufferSource();
    src.buffer = buf;
    const g = audio.ctx.createGain();
    g.gain.value = vol;
    src.connect(g);
    g.connect(dest || audio.master);
    src.start(t0);
  };

  audio.sfx = (name) => {
    if (!audio.ctx || audio.muted) return;
    switch (name) {
      case 'crash': audio.noise(0.25, 0.35); audio.tone(70, 0.3, 'sawtooth', 0.2); break;
      case 'pickup': audio.tone(660, 0.12, 'sine', 0.2); audio.tone(990, 0.18, 'sine', 0.2); break;
      case 'mission': [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => audio.tone(f, 0.35, 'triangle', 0.2), i * 110)); break;
      case 'fail': audio.tone(220, 0.4, 'sawtooth', 0.15); audio.tone(180, 0.5, 'sawtooth', 0.15); break;
      case 'door': audio.noise(0.08, 0.15); audio.tone(180, 0.08, 'square', 0.08); break;
      case 'punch': audio.noise(0.1, 0.25); break;
      case 'wasted': [392, 330, 262, 196].forEach((f, i) => setTimeout(() => audio.tone(f, 0.5, 'sawtooth', 0.18), i * 220)); break;
      case 'busted': [330, 262, 196, 165].forEach((f, i) => setTimeout(() => audio.tone(f, 0.5, 'square', 0.14), i * 220)); break;
      case 'click': audio.tone(880, 0.06, 'sine', 0.12); break;
      default: break;
    }
  };

  audio.setMusic = (on) => { audio.musicOn = on; };
  audio.nextStation = () => {
    audio.radioStation = (audio.radioStation + 1) % 3;
    return ['BAY FM — Sunset Drive', 'BAY FM — Night Cruise', 'BAY FM — Slow Tide'][audio.radioStation];
  };
  audio.setMuted = (m) => {
    audio.muted = m;
    if (audio.master) audio.master.gain.value = m ? 0 : 0.5;
  };

  return audio;
}
