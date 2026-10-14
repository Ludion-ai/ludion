// The film's music and sound, composed in code on the film's clock (src/timeline.mjs). 120 BPM, A minor, bars on odd
// seconds. The idea: the change makes no noise, so the sound goes under water at "Silent." and stops dead at the wrong
// answer; the command is typed into silence; the lesson lands on the drop; the AI's bracket locks on a major chord.
import { CUES, DURATION, KICKS, TYPING, energy, rng, typeTimes } from "../timeline.mjs";
import {
  SR, adsr, automate, bell, bus, drive, env, limit, midi, mixInto, noise, pingpong, place, placeStereo, pluck, reverb,
  saw, sine, svf, svfBus, tapeStop, wav,
} from "./dsp.mjs";

const B = 0.5; // a beat
const n = (s) => Math.ceil(s * SR);

// ---------- instruments ----------
function kick(len = 0.5, f0 = 160, f1 = 45) {
  const N = n(len);
  const out = sine(N, (i) => f1 + (f0 - f1) * Math.exp((-i / SR) * 32));
  env(out, (t) => (t < 0.008 ? 1 : Math.exp(-(t - 0.008) * 6.5)));
  const click = env(svf(noise(n(0.012), 7), "hp", 3000), (t) => Math.exp(-t * 500));
  for (let i = 0; i < click.length; i++) out[i] += click[i] * 0.25;
  return drive(out, 1.6);
}
function clap(seed) {
  const N = n(0.35);
  const src = svf(noise(N, seed), "bp", 1150, 1.1);
  return env(src, (t) => {
    const bursts = [0, 0.011, 0.022].reduce((a, s) => a + (t >= s && t < s + 0.01 ? Math.exp(-(t - s) * 250) : 0), 0);
    return 2.2 * (bursts + (t >= 0.028 ? Math.exp(-(t - 0.028) * 15) : 0));
  });
}
function snare(seed, decay = 16) {
  const N = n(0.3);
  const tone = env(sine(N, (i) => 185 + 60 * Math.exp((-i / SR) * 40)), (t) => Math.exp(-t * 22) * 0.6);
  const nz = env(svf(noise(N, seed), "hp", 1400), (t) => Math.exp(-t * decay));
  for (let i = 0; i < N; i++) tone[i] += nz[i] * 0.7;
  return tone;
}
function hat(seed, open = false) {
  const N = n(open ? 0.4 : 0.06);
  const s = svf(svf(noise(N, seed), "hp", 7200, 0.9), "bp", 10500, 0.6);
  return env(s, (t) => Math.exp(-t * (open ? 9 : 60)) * 1.6);
}
function bassNote(m, len, cutoff = 520) {
  const N = n(len + 0.05);
  const f = midi(m);
  const s = saw(N, f);
  const sub = sine(N, f);
  for (let i = 0; i < N; i++) s[i] = s[i] * 0.6 + sub[i] * 0.55;
  const out = svf(s, "lp", (t) => cutoff * (0.6 + 1.6 * Math.exp(-t * 14)), 1.1);
  return env(out, adsr(0.004, 0.08, 0.75, 0.04, len));
}
/** A wide pad chord: five detuned saws per note, split across the sides. */
function padChord(notes, len, cutoff, seed, attack = 0.35) {
  const N = n(len + 1.2);
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  const r = rng(seed);
  for (const m of notes) {
    for (let v = 0; v < 5; v++) {
      const det = (v - 2) * 0.09 + (r() - 0.5) * 0.02;
      const s = saw(N, midi(m + det), r());
      const side = v % 2 === 0 ? L : R;
      const other = v % 2 === 0 ? R : L;
      for (let i = 0; i < N; i++) {
        side[i] += s[i] * 0.7;
        other[i] += s[i] * 0.3;
      }
    }
  }
  const e = adsr(attack, 0.4, 0.85, 1.0, len);
  const fl = svf(svf(L, "lp", cutoff, 0.8), "hp", 220, 0.7);
  const fr = svf(svf(R, "lp", cutoff, 0.8), "hp", 220, 0.7);
  const k = 1 / (notes.length * 5);
  for (let i = 0; i < N; i++) {
    const g = e(i / SR) * k;
    fl[i] *= g;
    fr[i] *= g;
  }
  return [fl, fr];
}
function impact(seed, len = 2.2, f0 = 70) {
  const N = n(len);
  const boom = env(sine(N, (i) => 28 + (f0 - 28) * Math.exp((-i / SR) * 6)), (t) => Math.exp(-t * 2.4));
  const nz = env(svf(noise(N, seed), "lp", (t) => 200 + 7000 * Math.exp(-t * 5)), (t) => Math.exp(-t * 3.2) * 0.6);
  for (let i = 0; i < N; i++) boom[i] = boom[i] * 1.1 + nz[i];
  return drive(boom, 1.3);
}
function riser(len, seed, f0 = 350, f1 = 9000) {
  const N = n(len);
  const nz = svf(noise(N, seed), "bp", (t) => f0 * Math.pow(f1 / f0, t / len), 2.2);
  const tone = sine(N, (i) => 220 * Math.pow(6, i / N));
  for (let i = 0; i < N; i++) {
    const u = i / N;
    nz[i] = nz[i] * 1.6 * u * u + tone[i] * 0.08 * u * u * u;
  }
  return nz;
}
function keyClick(seed, level = 1) {
  const r = rng(seed);
  const N = n(0.03);
  const s = env(svf(noise(N, seed), "bp", 2400 + r() * 1800, 1.4), (t) => Math.exp(-t * 700));
  const thock = env(sine(N, 150 + r() * 40), (t) => Math.exp(-t * 140) * 0.35);
  for (let i = 0; i < N; i++) s[i] = (s[i] * 1.4 + thock[i]) * level * (0.7 + 0.3 * r());
  return s;
}
/** Bursts of noise and square at random pitches, gated in 64th notes: a digital stutter. */
function glitch(len, seed) {
  const N = n(len);
  const out = new Float32Array(N);
  const r = rng(seed);
  const slice = n(B / 8);
  for (let s = 0; s < N; s += slice) {
    if (r() < 0.35) continue;
    const f = 200 + r() * 1600;
    const nz = r() < 0.5;
    for (let i = 0; i < slice && s + i < N; i++) {
      const t = i / SR;
      const sq = Math.sign(Math.sin(2 * Math.PI * f * t));
      out[s + i] = (nz ? r() * 2 - 1 : sq) * 0.35 * Math.exp(-t * 30);
    }
  }
  return svf(out, "lp", 6000);
}
function tick(f = 2600) {
  const s = bell(f, 0.18, 1.41, 1.6, 26);
  return s;
}

// ---------- harmony (A minor), bars on odd seconds ----------
const CH = {
  Am: [57, 60, 64], F: [53, 57, 60], C: [55, 60, 64], G: [55, 59, 62], E: [56, 59, 64], Dm: [57, 62, 65], Cadd9: [60, 62, 64, 67],
};
const ROOT = { Am: 33, F: 29, C: 36, G: 31, E: 28, Dm: 38, Cadd9: 36 };

export function synthesize(data) {
  const len = DURATION + 0.5;
  const drums = bus(len);
  const bass = bus(len);
  const pads = bus(len);
  const arp = bus(len);
  const fx = bus(len);
  const dry = bus(len); // close, unreverberated sounds: the keys, and the stamp, so the silence after it is silence
  const kicks = [];

  // ----- the bars -----
  const bars = [
    // [start, chord, energy]   energy: 0 none, 1 half, 2 groove, 3 drop
    [-1, "Am", 0],
    [1, "Am", 1],
    [3, "F", 2],
    [5, "C", 2],
    [7, "G", 2],
    [9, "Am", 2],
    [15, "F", 3],
    [17, "G", 3],
    [19, "Am", 2.5],
    [21, "Cadd9", 3],
    [23, "F", 3],
    [25, "G", 3],
  ];

  // Pads: one chord per bar, brighter after the drop.
  bars.forEach(([at, ch, e], i) => {
    const start = Math.max(0, at);
    const dur = 2 - (start - at);
    if (at === 9) {
      // The last bar before the stamp leans on E, the dominant.
      placeStereo(pads, padChord(CH.Am, 1, 1200, 90 + i), 9, 1);
      placeStereo(pads, padChord(CH.E, 1, 1500, 91 + i), 10, 1.05);
      return;
    }
    const cutoff = e >= 3 ? 3400 : e >= 2 ? 1500 : 1000;
    placeStereo(pads, padChord(CH[ch], dur, cutoff, 100 + i, at < 0 ? 0.9 : 0.25), start, e >= 3 ? 1.15 : 1);
  });
  // The final chord, from the mark to the end.
  placeStereo(pads, padChord([48, 55, 60, 62, 64, 67], 3.2, 2800, 777, 0.02), CUES.markClose, 1.3);

  // Drums and bass per beat.
  for (let k = 0; k < 60; k++) {
    const t = 1 + k * B; // beat k of the grid
    if (t >= DURATION) break;
    const [, ch] = [...bars].reverse().find(([at]) => t >= at);
    const e = energy(t);
    const beatInBar = k % 4;
    if (e === 0) continue;
    // Kick: four on the floor, once a bar in half time (the same list the picture pulses to).
    if (KICKS.includes(t)) {
      place(drums, kick(), t, 0.72);
      kicks.push(t);
    }
    // Clap on 2 and 4.
    if (e >= 2 && beatInBar % 2 === 1) place(drums, clap(500 + k), t, 0.5, 0.05);
    // Hats: sixteenths in the montage and after the drop, eighths elsewhere.
    const sub = e >= 3 || (t >= 2 && t < 4) ? 4 : 2;
    for (let s = 0; s < sub; s++) {
      const ht = t + (s * B) / sub;
      const accent = s === 2 || (sub === 2 && s === 1);
      const open = e >= 3 && s === 2 && beatInBar % 2 === 1;
      place(drums, hat(900 + k * 4 + s, open), ht, accent ? 0.5 : 0.3, 0.25);
    }
    // Bass: eighths on the root, octave on the off-beat after the drop.
    if (e >= 2) {
      for (let s = 0; s < 2; s++) {
        const m = ROOT[t >= 10 && t < 11 ? "E" : ch] + (e >= 3 && s === 1 ? 12 : 0);
        place(bass, bassNote(m, B / 2 - 0.02, e >= 3 ? 760 : 520), t + (s * B) / 2, 0.36);
      }
    }
    // Arpeggio: sixteenths of the chord, rising, in the montage and after the drop (and through the reading break).
    const arpOn = (t >= 1.5 && t < 4) || (t >= CUES.drop && t < CUES.markClose - 0.5);
    if (arpOn) {
      const notes = CH[ch].map((m) => m + 12);
      const seq = [notes[0], notes[1], notes[2], notes[0] + 12];
      for (let s = 0; s < 4; s++) {
        const m = seq[(k * 4 + s) % 4];
        place(arp, pluck(midi(m), 0.6, 3000 + k * 4 + s, 0.55, 0.995), t + (s * B) / 4, 0.42, s % 2 ? 0.35 : -0.35);
      }
    }
  }

  // Fill into the stamp: a snare run over the last beat.
  for (let s = 0; s < 8; s++) place(drums, snare(1200 + s), 10.5 + (s * B) / 8, 0.12 + 0.06 * s, 0.1);
  // Roll into the drop (on the effects bus: the band is stopped here): eighths, sixteenths, thirty-seconds, rising.
  for (let t = 13.75; t < 14.95; ) {
    const step = t < 14.25 ? B / 2 : t < 14.6 ? B / 4 : B / 8;
    place(fx, snare(1300 + Math.round(t * 100)), t, 0.1 + 0.45 * ((t - 13.75) / 1.2) ** 2, 0.08);
    t += step;
  }

  // ----- sound effects -----
  // The opening: the surface line draws itself (a rising tone) over a low hit.
  place(fx, impact(1, 1.6, 55), 0, 0.5);
  const draw = env(sine(n(0.6), (i) => 900 + 1700 * (i / n(0.6))), (t) => Math.sin(Math.min(1, t / 0.6) * Math.PI) * 0.12);
  place(fx, draw, 0.0, 1, 0);
  place(fx, riser(1.0, 11, 600, 6000), 0.0, 0.25);
  // "changed." slams in.
  place(fx, impact(2, 1.4, 80), CUES.slam, 0.75);
  place(fx, glitch(0.25, 3), CUES.slam, 0.55, -0.2);
  // One tick per montage cut.
  CUES.montageCuts.forEach((c, i) => place(fx, tick(2200 + i * 160), c, 0.22, i % 2 ? 0.4 : -0.4));
  // "Silent.": a sonar ping in the muffled water.
  place(fx, env(sine(n(1.6), 1318), (t) => Math.exp(-t * 4.5) * 0.4), CUES.muffle + 0.02, 0.5);
  place(fx, env(sine(n(1.6), 1318 * 2.01), (t) => Math.exp(-t * 7) * 0.1), CUES.muffle + 0.02, 0.5);
  // The question, typed (every other key), and a soft tick per answer word.
  const qt = typeTimes(data.question, ...TYPING.question);
  qt.forEach((t, i) => i % 2 === 0 && place(dry, keyClick(4000 + i, 0.5), t, 0.45, 0.1));
  // The stamp: a hit, a stutter, and the music halts.
  place(dry, env(impact(5, 1.2, 62), (t) => Math.max(0, 1 - t / 1.2) ** 2), CUES.stamp, 1.0);
  place(dry, glitch(0.45, 6), CUES.stamp, 0.6, 0.2);
  const stab = drive(svf(saw(n(0.6), midi(40)), "lp", (t) => 2400 * Math.exp(-t * 6) + 200), 3);
  const stab2 = drive(svf(saw(n(0.6), midi(41)), "lp", (t) => 2400 * Math.exp(-t * 6) + 200), 3);
  for (let i = 0; i < stab.length; i++) stab[i] = (stab[i] + stab2[i]) * Math.exp((-i / SR) * 4);
  place(dry, stab, CUES.stamp, 0.3);
  // The command, typed into silence, and its Enter.
  const ct = typeTimes(data.sync.command, ...TYPING.command);
  ct.forEach((t, i) => place(dry, keyClick(5000 + i, 1), t, 0.85, 0.05));
  place(dry, keyClick(6000, 1.6), CUES.enter, 1.1);
  place(dry, env(sine(n(0.08), 120), (t) => Math.exp(-t * 60)), CUES.enter, 0.6);
  // The output arrives: two soft blips.
  place(fx, tick(1800), CUES.output, 0.12);
  place(fx, tick(1500), CUES.output + 0.12, 0.08);
  // Pressure before the drop.
  place(fx, riser(CUES.drop - CUES.enter, 12), CUES.enter, 0.75);
  // The drop.
  place(fx, impact(7, 2.8, 75), CUES.drop, 1.1);
  const crash = env(svf(noise(n(2.5), 8), "hp", 4000), (t) => Math.exp(-t * 1.4) * 0.35);
  place(fx, crash, CUES.drop, 0.6, 0.15);
  // The lesson's parts arrive.
  for (const c of [CUES.lessonDetail, CUES.evidence, CUES.evidence + 0.22, CUES.teacher]) place(fx, tick(3000), c, 0.08, 0.3);
  // "Correct.": the bracket locks (a click) and a bell chord rings.
  place(fx, keyClick(7000, 2.2), CUES.close, 0.9);
  place(fx, env(sine(n(0.1), 95), (t) => Math.exp(-t * 45)), CUES.close, 0.7);
  [72, 76, 79, 84].forEach((m, i) => place(fx, bell(midi(m), 3, 3.5, 3, 1.4), CUES.close + i * 0.025, 0.11, (i - 1.5) * 0.3));
  // The totals count up: one soft tick per step of each bar's growth.
  for (const at of [CUES.barWithout, CUES.barWith]) {
    for (let i = 0; i < 8; i++) place(fx, tick(1400 + i * 120), at + Math.pow(i / 8, 0.6) * 0.5, 0.05, 0.2);
  }
  // A breath before the mark, then the mark closes.
  const swell = riser(0.5, 13, 900, 7000);
  for (let i = 0; i < swell.length; i++) swell[i] *= 0.8;
  place(fx, swell, CUES.markClose - 0.5, 0.5);
  place(fx, impact(9, 3.5, 66), CUES.markClose, 1.15);
  [60, 67, 72, 76, 79].forEach((m, i) => place(fx, bell(midi(m), 4, 3.5, 2.6, 0.9), CUES.markClose + i * 0.03, 0.12, (i - 2) * 0.25));
  // The command appears under the wordmark: a last arpeggio, fading.
  [72, 76, 79, 84, 88].forEach((m, i) => place(arp, pluck(midi(m), 1.6, 8000 + i, 0.5, 0.997), CUES.cta + i * 0.125, 0.28 - i * 0.03, i % 2 ? 0.4 : -0.4));

  // ----- mixing -----
  // For finding a sound by ear-less analysis: LUDION_MUTE=pads,arp silences those stems.
  for (const name of (process.env.LUDION_MUTE ?? "").split(",").filter(Boolean)) {
    const stem = { drums, bass, pads, arp, fx, dry }[name];
    stem.L.fill(0);
    stem.R.fill(0);
  }
  // Side-chain: the bass and pads duck under each kick.
  const duck = (t) => {
    let g = 1;
    for (let i = kicks.length - 1; i >= 0; i--) {
      const d = t - kicks[i];
      if (d < 0) continue;
      g = 1 - 0.55 * Math.exp(-d * 11);
      break;
    }
    return g;
  };
  automate(bass, duck);
  automate(pads, (t) => 0.35 + 0.65 * duck(t));
  pingpong(arp, B * 0.75, 0.38, 0.32, 3500);
  const music = bus(len);
  mixInto(music, drums, 1);
  mixInto(music, bass, 1);
  const wet = bus(len);
  mixInto(wet, pads, 0.9);
  mixInto(wet, arp, 1);
  reverb(wet, { room: 0.86, damp: 0.3, wet: 0.9, dry: 1 });
  mixInto(music, wet, 1);
  // Before the drop: under water at "Silent." (a low-pass on the whole band), dry and thin under the answer, opening
  // toward the stamp; then the band slows to a halt under the stamp and stays silent.
  const pre = bus(len);
  mixInto(pre, music, 1);
  svfBus(pre, "lp", (t) => {
    if (t < CUES.muffle - 0.02) return 18000;
    if (t < 5.9) return 380 + 200 * Math.max(0, 1 - (t - CUES.muffle) / 0.3);
    if (t < 6.0) return 380 + (t - 5.9) * 10 * 6000;
    if (t < CUES.stamp) return 2500 + 15500 * ((t - 6) / 5) ** 2;
    return 18000;
  }, 0.9);
  // Quieter under water, and a little under the answer so the words come first.
  automate(pre, (t) => {
    if (t >= CUES.muffle && t < 6) return 0.45;
    if (t >= 6 && t < CUES.stamp) return 0.7 + 0.3 * ((t - 6) / 5) ** 2;
    return 1;
  });
  tapeStop(pre, CUES.stamp + 0.04, 0.45);
  // From the drop on, the band as it is.
  const from = n(CUES.drop - 0.05);
  for (let i = 0; i < from; i++) {
    music.L[i] = pre.L[i];
    music.R[i] = pre.R[i];
  }
  for (let i = from; i < from + n(0.05); i++) {
    const k = (i - from) / n(0.05);
    music.L[i] *= k;
    music.R[i] *= k;
  }

  const fxWet = bus(len);
  mixInto(fxWet, fx, 1);
  reverb(fxWet, { room: 0.8, damp: 0.35, wet: 0.45, dry: 1 });

  const master = bus(len);
  mixInto(master, music, 0.9);
  mixInto(master, fxWet, 1);
  mixInto(master, dry, 1);
  // Fade the tail to silence by the last frame.
  automate(master, (t) => (t < 28.6 ? 1 : Math.max(0, 1 - (t - 28.6) / 1.35)));
  limit(master, 0.9);
  master.n = n(DURATION);
  master.L = master.L.subarray(0, master.n);
  master.R = master.R.subarray(0, master.n);
  return wav(master);
}
