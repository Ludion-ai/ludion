// A small synthesizer: oscillators, filters, envelopes, a reverb and a delay, all computed sample by sample in plain
// JavaScript. Nothing here plays or loads recorded sound; every sample of the film's audio is made by these functions.
import { rng } from "../timeline.mjs";

export const SR = 48000;
const TAU = Math.PI * 2;

/** A stereo bus: two Float32Arrays. */
export function bus(seconds) {
  const n = Math.ceil(seconds * SR);
  return { L: new Float32Array(n), R: new Float32Array(n), n };
}

/** Add a mono signal into a bus at `at` seconds, with gain and pan (-1 left .. 1 right, equal power). */
export function place(b, sig, at, gain = 1, pan = 0) {
  const o = Math.round(at * SR);
  const a = ((pan + 1) * Math.PI) / 4;
  const gl = Math.cos(a) * gain * Math.SQRT2;
  const gr = Math.sin(a) * gain * Math.SQRT2;
  for (let i = 0; i < sig.length; i++) {
    const j = o + i;
    if (j < 0 || j >= b.n) continue;
    b.L[j] += sig[i] * gl;
    b.R[j] += sig[i] * gr;
  }
}

/** Add a stereo pair into a bus. */
export function placeStereo(b, [l, r], at, gain = 1) {
  const o = Math.round(at * SR);
  for (let i = 0; i < l.length; i++) {
    const j = o + i;
    if (j < 0 || j >= b.n) continue;
    b.L[j] += l[i] * gain;
    b.R[j] += r[i] * gain;
  }
}

export function mixInto(dst, src, gain = 1) {
  for (let i = 0; i < dst.n; i++) {
    dst.L[i] += src.L[i] * gain;
    dst.R[i] += src.R[i] * gain;
  }
}

export const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** Band-limited sawtooth step (polyBLEP). */
function blep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/** A saw at frequency f (Hz, or a function of sample index), `n` samples, starting phase `ph`. */
export function saw(n, f, ph = 0) {
  const out = new Float32Array(n);
  let p = ph;
  for (let i = 0; i < n; i++) {
    const fi = typeof f === "function" ? f(i) : f;
    const dt = fi / SR;
    out[i] = 2 * p - 1 - blep(p, dt);
    p += dt;
    if (p >= 1) p -= 1;
  }
  return out;
}

export function sine(n, f, ph = 0) {
  const out = new Float32Array(n);
  let p = ph;
  for (let i = 0; i < n; i++) {
    const fi = typeof f === "function" ? f(i) : f;
    out[i] = Math.sin(TAU * p);
    p += fi / SR;
    if (p >= 1) p -= 1;
  }
  return out;
}

export function noise(n, seed) {
  const r = rng(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = r() * 2 - 1;
  return out;
}

/** Multiply by an envelope given as a function of seconds. */
export function env(sig, fn) {
  for (let i = 0; i < sig.length; i++) sig[i] *= fn(i / SR);
  return sig;
}

export const adsr = (a, d, s, r, len) => (t) => {
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  if (t < len) return s;
  return Math.max(0, s * (1 - (t - len) / r));
};

/**
 * Topology-preserving state variable filter (Zavalishin): stable under fast cutoff changes.
 * mode: "lp" | "hp" | "bp". cutoff in Hz, or a function of seconds. q around 0.5..10.
 */
export function svf(sig, mode, cutoff, q = 0.707) {
  const out = new Float32Array(sig.length);
  let ic1 = 0;
  let ic2 = 0;
  const k = 1 / q;
  let g = 0;
  let a1 = 0;
  let a2 = 0;
  let a3 = 0;
  for (let i = 0; i < sig.length; i++) {
    if (i % 16 === 0 || i === 0) {
      const fc = Math.min(SR * 0.45, Math.max(10, typeof cutoff === "function" ? cutoff(i / SR) : cutoff));
      g = Math.tan((Math.PI * fc) / SR);
      a1 = 1 / (1 + g * (g + k));
      a2 = g * a1;
      a3 = g * a2;
    }
    const v0 = sig[i];
    const v3 = v0 - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    out[i] = mode === "lp" ? v2 : mode === "bp" ? v1 : v0 - k * v1 - v2;
  }
  return out;
}

/** The same filter over a whole stereo bus, in place. */
export function svfBus(b, mode, cutoff, q) {
  b.L.set(svf(b.L, mode, cutoff, q));
  b.R.set(svf(b.R, mode, cutoff, q));
}

/** Soft saturation. */
export function drive(sig, amount) {
  const norm = Math.tanh(amount);
  for (let i = 0; i < sig.length; i++) sig[i] = Math.tanh(sig[i] * amount) / norm;
  return sig;
}

/** Karplus-Strong plucked string. */
export function pluck(f, seconds, seed, damp = 0.5, decay = 0.996) {
  const n = Math.ceil(seconds * SR);
  const out = new Float32Array(n);
  const len = Math.max(2, Math.round(SR / f));
  const line = noise(len, seed);
  // A softer excitation: low-pass the noise burst once.
  for (let i = 1; i < len; i++) line[i] = line[i] * (1 - damp) + line[i - 1] * damp;
  let idx = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const cur = line[idx];
    const avg = decay * (0.5 * (cur + prev));
    prev = cur;
    line[idx] = avg;
    out[i] = cur;
    idx = (idx + 1) % len;
  }
  return out;
}

/** Two-operator FM bell. */
export function bell(f, seconds, ratio = 3.5, index = 4, decay = 2.2) {
  const n = Math.ceil(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const ix = index * Math.exp(-t * 3.5);
    out[i] = Math.sin(TAU * f * t + ix * Math.sin(TAU * f * ratio * t)) * Math.exp(-t * decay);
  }
  return out;
}

/** Freeverb: eight combs and four all-passes per side, with the right side's lengths offset for width. */
export function reverb(b, { room = 0.84, damp = 0.25, wet = 0.3, dry = 1, width = 1 } = {}) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((x) => Math.round((x * SR) / 44100));
  const alls = [556, 441, 341, 225].map((x) => Math.round((x * SR) / 44100));
  const run = (input, spread) => {
    const out = new Float32Array(input.length);
    const cs = combs.map((l) => ({ buf: new Float32Array(l + spread), i: 0, store: 0 }));
    const as = alls.map((l) => ({ buf: new Float32Array(l + spread), i: 0 }));
    for (let n = 0; n < input.length; n++) {
      const x = input[n] * 0.015;
      let y = 0;
      for (const c of cs) {
        const o = c.buf[c.i];
        c.store = o * (1 - damp) + c.store * damp;
        c.buf[c.i] = x + c.store * room;
        if (++c.i >= c.buf.length) c.i = 0;
        y += o;
      }
      for (const a of as) {
        const bo = a.buf[a.i];
        const v = -y + bo;
        a.buf[a.i] = y + bo * 0.5;
        if (++a.i >= a.buf.length) a.i = 0;
        y = v;
      }
      out[n] = y;
    }
    return out;
  };
  const wl = run(b.L, 0);
  const wr = run(b.R, 23);
  const w1 = wet * (width / 2 + 0.5);
  const w2 = (wet * (1 - width)) / 2;
  for (let i = 0; i < b.n; i++) {
    const l = b.L[i];
    const r = b.R[i];
    b.L[i] = l * dry + wl[i] * w1 + wr[i] * w2;
    b.R[i] = r * dry + wr[i] * w1 + wl[i] * w2;
  }
}

/** Stereo ping-pong delay, in place. */
export function pingpong(b, seconds, feedback = 0.4, wet = 0.3, tone = 4000) {
  const d = Math.round(seconds * SR);
  const bl = new Float32Array(d);
  const brr = new Float32Array(d);
  let i = 0;
  let lpL = 0;
  let lpR = 0;
  const a = Math.exp((-2 * Math.PI * tone) / SR);
  for (let n = 0; n < b.n; n++) {
    const outL = bl[i];
    const outR = brr[i];
    lpL = outL * (1 - a) + lpL * a;
    lpR = outR * (1 - a) + lpR * a;
    bl[i] = b.L[n] + lpR * feedback;
    brr[i] = lpL * feedback;
    b.L[n] += outL * wet;
    b.R[n] += outR * wet;
    if (++i >= d) i = 0;
  }
}

/** Gain over time on a bus, in place. */
export function automate(b, fn) {
  for (let i = 0; i < b.n; i++) {
    const g = fn(i / SR);
    b.L[i] *= g;
    b.R[i] *= g;
  }
}

/**
 * Tape stop: from `at`, the bus slows to a halt over `dur` seconds (pitch falls with speed), then stays silent.
 */
export function tapeStop(b, at, dur) {
  const s = Math.round(at * SR);
  const e = Math.min(b.n, Math.round((at + dur) * SR));
  const L = b.L.slice();
  const R = b.R.slice();
  let pos = s;
  for (let i = s; i < b.n; i++) {
    if (i < e) {
      const u = (i - s) / (e - s);
      const speed = Math.pow(1 - u, 1.6);
      const p0 = Math.floor(pos);
      const fr = pos - p0;
      b.L[i] = (L[p0] * (1 - fr) + L[p0 + 1] * fr) * (1 - u * u);
      b.R[i] = (R[p0] * (1 - fr) + R[p0 + 1] * fr) * (1 - u * u);
      pos += speed;
    } else {
      b.L[i] = 0;
      b.R[i] = 0;
    }
  }
}

/** A simple look-ahead peak limiter on the master, in place. */
export function limit(b, ceiling = 0.89, release = 0.08) {
  const look = Math.round(0.004 * SR);
  const rel = Math.exp(-1 / (release * SR));
  let g = 1;
  const peak = new Float32Array(b.n);
  for (let i = 0; i < b.n; i++) peak[i] = Math.max(Math.abs(b.L[i]), Math.abs(b.R[i]));
  // Running maximum over the look-ahead window.
  const ahead = new Float32Array(b.n);
  for (let i = 0; i < b.n; i++) {
    let m = 0;
    for (let j = i; j < Math.min(b.n, i + look); j += 4) m = Math.max(m, peak[j]);
    ahead[i] = m;
  }
  for (let i = 0; i < b.n; i++) {
    const want = ahead[i] > ceiling ? ceiling / ahead[i] : 1;
    g = want < g ? want : want - (want - g) * rel;
    b.L[i] *= g;
    b.R[i] *= g;
  }
}

/** 32-bit float stereo WAV. */
export function wav(b) {
  const n = b.n;
  const buf = Buffer.alloc(44 + n * 8);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 8, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20); // IEEE float
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 8, 28);
  buf.writeUInt16LE(8, 32);
  buf.writeUInt16LE(32, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 8, 40);
  for (let i = 0; i < n; i++) {
    buf.writeFloatLE(b.L[i], 44 + i * 8);
    buf.writeFloatLE(b.R[i], 48 + i * 8);
  }
  return buf;
}
