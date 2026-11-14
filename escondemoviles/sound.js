// Sonidos sintetizados con Web Audio (sin archivos), basados en los de Malas Cartas.
// Los "llamadas" son los sonidos que hace un móvil escondido: cortos, agudos y fuertes para oírlos
// desde lejos y saber de dónde vienen. Si el navegador no tiene AudioContext, nada de esto suena.
(function (root) {
  'use strict';
  const AC = root.AudioContext || root.webkitAudioContext;
  let ctx = null;
  let master = null;
  let muted = (() => { try { return root.localStorage.getItem('em-mute') === '1'; } catch (e) { return false; } })();

  const isMuted = () => muted;
  function toggleMute() {
    muted = !muted;
    try { root.localStorage.setItem('em-mute', muted ? '1' : '0'); } catch (e) { /* nada */ }
    return muted;
  }

  // Llamar desde un gesto del usuario: los navegadores solo dejan sonar audio después de uno.
  function unlock() {
    if (!AC) return;
    try {
      // iPhone: que suene aunque el interruptor de silencio esté puesto (Safari 16.4+).
      if (root.navigator && root.navigator.audioSession) root.navigator.audioSession.type = 'playback';
      if (!ctx) {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.9;
        const comp = ctx.createDynamicsCompressor(); // más volumen sin distorsionar
        master.connect(comp).connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) { ctx = null; }
  }
  const ready = () => !!ctx && ctx.state === 'running';

  function env(g, t, peak, attack, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  function tone(freq, at, dur, o = {}) {
    const { type = 'sine', gain = 0.3, attack = 0.01, slide, filter, bp } = o;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + dur);
    env(g, t, gain, attack, dur);
    let node = osc;
    if (filter || bp) {
      const f = ctx.createBiquadFilter();
      f.type = bp ? 'bandpass' : 'lowpass';
      f.frequency.value = bp || filter;
      if (bp) f.Q.value = 3;
      osc.connect(f);
      node = f;
    }
    node.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  let noiseBuf = null;
  function noise(at, dur, o = {}) {
    const { gain = 0.3, type = 'lowpass', freq = 1000, q = 1, attack = 0.003 } = o;
    const t = ctx.currentTime + at;
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    env(g, t, gain, attack, dur);
    src.connect(f).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  const N = { C4: 261.63, E4: 329.63, G4: 392, A4: 440, C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5, E6: 1318.5 };

  // Llamadas de los móviles escondidos (los ids son los de EM.SOUNDS).
  const CALLS = {
    pio() {
      [0, 0.18, 0.36].forEach(at => tone(2200, at, 0.12, { gain: 0.5, slide: 3600, attack: 0.005 }));
    },
    bip() {
      [0, 0.15, 0.3].forEach(at => tone(1900, at, 0.09, { type: 'square', gain: 0.25, attack: 0.003 }));
    },
    campana() {
      [[1318, 0.5], [3290, 0.18], [2100, 0.12]].forEach(([f, gn]) => tone(f, 0, 1.1, { gain: gn, attack: 0.002 }));
      [[1318, 0.4], [3290, 0.14]].forEach(([f, gn]) => tone(f, 0.45, 0.9, { gain: gn, attack: 0.002 }));
    },
    rana() {
      [0, 0.32].forEach(at => {
        for (let k = 0; k < 6; k++) tone(520, at + k * 0.035, 0.03, { type: 'sawtooth', gain: 0.35, bp: 1100, attack: 0.002 });
      });
    },
    silbido() {
      tone(1300, 0, 0.22, { gain: 0.5, slide: 2900, attack: 0.02 });
      tone(2600, 0.3, 0.45, { gain: 0.5, slide: 1100, attack: 0.02 });
    },
    grillo() {
      [0, 0.3, 0.6].forEach(at => {
        for (let k = 0; k < 4; k++) tone(4300, at + k * 0.04, 0.025, { gain: 0.4, attack: 0.002 });
      });
    },
    pato() {
      [0, 0.28].forEach(at => tone(900, at, 0.2, { type: 'sawtooth', gain: 0.4, slide: 620, bp: 1400, attack: 0.01 }));
    },
    sirena() {
      [0, 0.2, 0.4, 0.6].forEach((at, k) => tone(k % 2 ? 1350 : 950, at, 0.18, { type: 'square', gain: 0.18, attack: 0.005 }));
    },
  };

  const SOUNDS = {
    join() {
      tone(N.C5, 0, 0.2, { gain: 0.15 });
      tone(N.G5, 0.1, 0.35, { gain: 0.15 });
    },
    tick() { tone(1500, 0, 0.06, { type: 'square', gain: 0.08 }); },
    go() {
      [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone(f, i * 0.09, 0.4, { type: 'triangle', gain: 0.22 }));
    },
    found() {
      [[N.G5, 0], [N.C6, 0.1], [N.E6, 0.2]].forEach(([f, at]) => tone(f, at, 0.45, { type: 'triangle', gain: 0.25 }));
      noise(0, 0.25, { gain: 0.15, type: 'highpass', freq: 5000 });
    },
    buzzer() {
      tone(180, 0, 0.9, { type: 'sawtooth', gain: 0.25, filter: 900 });
      tone(186, 0, 0.9, { type: 'sawtooth', gain: 0.2, filter: 900 });
    },
    victory() {
      [[N.C5, 0, 0.2], [N.E5, 0.18, 0.2], [N.G5, 0.36, 0.2], [N.C6, 0.54, 1.2]].forEach(([f, at, d]) => {
        tone(f, at, d, { type: 'triangle', gain: 0.25 });
        tone(f / 2, at, d, { gain: 0.12 });
      });
    },
    tap() { tone(900, 0, 0.06, { type: 'triangle', gain: 0.15 }); },
  };

  // Sonido de efecto (respeta el silencio).
  function play(name, delay = 0) {
    if (muted || !ctx || !SOUNDS[name]) return;
    const run = () => { try { if (ctx.state !== 'closed') SOUNDS[name](); } catch (e) { /* nada */ } };
    if (delay > 0) setTimeout(run, delay * 1000); else run();
  }

  // Llamada de un móvil escondido: suena siempre, aunque se haya silenciado, porque es el juego.
  function call(id) {
    if (!ctx || !CALLS[id]) return false;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* nada */ } }
    try { CALLS[id](); } catch (e) { return false; }
    return true;
  }

  root.EMSND = { play, call, unlock, ready, isMuted, toggleMute };
})(typeof window !== 'undefined' ? window : globalThis);
