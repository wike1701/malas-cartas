// Efectos de sonido sintetizados con Web Audio (sin archivos). Adaptado de secrethitlet.
// Si el navegador no tiene AudioContext, todo esto no hace nada.
(function (root) {
  'use strict';
  const AC = root.AudioContext || root.webkitAudioContext;
  let ctx = null;
  let master = null;
  let muted = (() => { try { return root.localStorage.getItem('mc-mute') === '1'; } catch (e) { return false; } })();

  const isMuted = () => muted;
  function toggleMute() {
    muted = !muted;
    try { root.localStorage.setItem('mc-mute', muted ? '1' : '0'); } catch (e) {}
    return muted;
  }

  // Llamar desde un gesto del usuario: los navegadores solo dejan sonar audio después de uno.
  function unlock() {
    if (!AC) return;
    try {
      if (!ctx) {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.45;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) { ctx = null; }
  }

  function env(g, t, peak, attack, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  function tone(freq, at, dur, o = {}) {
    const { type = 'sine', gain = 0.3, attack = 0.01, slide, filter } = o;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + dur);
    env(g, t, gain, attack, dur);
    let node = osc;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filter;
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

  const N = { C4: 261.63, Eb4: 311.13, E4: 329.63, G4: 392, A4: 440, C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5 };

  // Roce de una carta al deslizarse sobre el tapete.
  const swish = (at, gain = 0.2) => noise(at, 0.11, { gain, type: 'bandpass', freq: 3200, q: 0.8, attack: 0.02 });

  const SOUNDS = {
    deal(n = 5) { for (let i = 0; i < Math.min(n, 6); i++) swish(i * 0.09, 0.18); },
    play() {
      swish(0, 0.16);
      noise(0.07, 0.06, { gain: 0.35, freq: 900, attack: 0.001 });
      tone(180, 0.07, 0.08, { gain: 0.12, slide: 110 });
    },
    bid() {
      noise(0, 0.05, { gain: 0.3, type: 'bandpass', freq: 2500, q: 2 });
      tone(620, 0, 0.08, { type: 'square', gain: 0.05 });
    },
    turn() {
      tone(N.E5, 0, 0.25, { type: 'triangle', gain: 0.16 });
      tone(N.A4 * 2, 0.14, 0.45, { type: 'triangle', gain: 0.16 });
    },
    trickMine() {
      [N.C5, N.E5, N.G5].forEach((f, i) => tone(f, i * 0.07, 0.5, { gain: 0.15 }));
      [0, 0.06, 0.12].forEach((at) => swish(0.25 + at, 0.12));
    },
    trickOther() {
      tone(N.G4, 0, 0.35, { type: 'triangle', gain: 0.12 });
      [0, 0.06, 0.12].forEach((at) => swish(0.15 + at, 0.1));
    },
    lifeLost() {
      tone(N.E4, 0, 0.3, { type: 'sawtooth', gain: 0.09, filter: 1200 });
      tone(N.C4, 0.2, 0.55, { type: 'sawtooth', gain: 0.11, filter: 900, slide: 200 });
    },
    eliminated() {
      noise(0, 0.4, { gain: 0.6, freq: 1500, attack: 0.001 });
      tone(140, 0, 0.6, { gain: 0.5, slide: 35 });
    },
    join() {
      tone(N.C5, 0, 0.2, { gain: 0.12 });
      tone(N.G5, 0.1, 0.35, { gain: 0.12 });
    },
    victory() {
      [[N.C5, 0, 0.2], [N.E5, 0.18, 0.2], [N.G5, 0.36, 0.2], [N.C6, 0.54, 1.2]].forEach(([f, at, d]) => {
        tone(f, at, d, { type: 'triangle', gain: 0.2 });
        tone(f / 2, at, d, { gain: 0.1 });
      });
    },
    defeat() {
      [[N.G4, 0, 0.45], [N.Eb4, 0.4, 0.45], [N.C4, 0.8, 1.4]].forEach(([f, at, d]) => {
        tone(f, at, d, { type: 'sawtooth', gain: 0.1, filter: 1000, attack: 0.04 });
      });
      tone(65, 0.8, 1.6, { gain: 0.3 });
    },
  };

  // Reproduce un sonido, opcionalmente con retraso en segundos.
  function play(name, delay = 0, arg) {
    if (muted || !ctx || !SOUNDS[name]) return;
    const run = () => { try { if (ctx.state !== 'closed') SOUNDS[name](arg); } catch (e) {} };
    if (delay > 0) setTimeout(run, delay * 1000); else run();
  }

  root.MCSND = { play, unlock, isMuted, toggleMute };
})(typeof window !== 'undefined' ? window : globalThis);
