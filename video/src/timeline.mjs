// The one clock. The picture (src/page/stage.js) and the sound (src/audio/score.mjs) both read their cue times from
// here, so a cut and the sound under it can't drift apart. Times are seconds; the music runs at 120 BPM, so a beat is
// half a second and a frame-accurate cut on a beat is a whole number of frames at 60 fps.

export const FPS = 60;
export const BPM = 120;
export const BEAT = 60 / BPM;
export const DURATION = 30;
/** Bars are two seconds and start on odd seconds: the slam (1.0), the stamp (11.0) and the drop (15.0) are downbeats. */
export const DOWNBEAT = 1.0;

/** Scene boundaries, in seconds. Each scene's own cues are offsets inside it. */
export const SCENES = {
  hook: [0, 2], //      "The software changed."
  montage: [2, 4], //   real silent changes, one per eighth note
  silent: [4, 6], //    "Silent." and the lesson's own words for it
  wrong: [6, 12.5], //  the recorded answer without Ludion, and the stamp
  sync: [12.5, 15], //  npx ludion-ai sync, typed into silence
  lesson: [15, 18.5], // the drop: the lesson the assistant read
  right: [18.5, 23], // the recorded answer with sync; the bracket closes
  proof: [23, 26], //   the measured B-question totals
  end: [26, 30], //     the mark, the wordmark, the command
};

/** Moments the sound has to hit exactly. */
export const CUES = {
  open: 0,
  slam: 1.0,
  // Six changes an eighth note each, then the one this film follows, held for a beat.
  montageCuts: Array.from({ length: 7 }, (_, i) => 2 + i * 0.25),
  muffle: 4.0,
  silentLine: 4.5,
  panelIn: 6.0,
  answerStart: 7.6,
  answerEnd: 10.6,
  stamp: 11.0,
  enter: 13.5,
  output: 13.65,
  drop: 15.0,
  lessonDetail: 15.5,
  evidence: 16.0,
  teacher: 16.5,
  rightPanel: 18.5,
  rightAnswerStart: 18.85,
  rightAnswerEnd: 20.6,
  close: 21.0, //         the AI's half of the mark locks, on a downbeat

  proofIn: 23.0,
  barWithout: 23.4,
  barWith: 24.0,
  markClose: 26.0, //     the two halves meet
  wordmark: 26.3,
  tagline: 26.9,
  cta: 27.4,
};

/** How hard the band plays at a time: 0 silent, 1 half time, 2 groove, 3 after the drop. */
export function energy(t) {
  if (t < 1 || (t >= CUES.stamp && t < CUES.drop) || t >= CUES.markClose - 0.5) return 0;
  if (t < 2) return 1;
  if (t >= 18.5 && t < 20.5) return 1; // the reader reads the right answer
  return t >= CUES.drop ? 3 : 2;
}

/** Every kick drum, in seconds: the sound plays them and the water's light pulses with them. */
export const KICKS = Array.from({ length: 60 }, (_, k) => DOWNBEAT + k * BEAT).filter((t) => {
  const e = energy(t);
  return t < DURATION && (e >= 2 || (e === 1 && t < 2 && (t - DOWNBEAT) % 2 === 0));
});

/** A small seeded random generator (mulberry32): the same seed gives the same frame on every machine. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * When each character of typed text appears, from `start` to `end`: a seeded human unevenness, and a short pause
 * after spaces. The audio uses the same times for its key clicks.
 */
export function typeTimes(text, start, end, seed) {
  const r = rng(seed);
  const gaps = [...text].map((ch) => 0.55 + 0.9 * r() + (ch === " " ? 0.6 : 0));
  gaps.pop();
  const total = gaps.reduce((a, b) => a + b, 0) || 1;
  const out = [start];
  for (const g of gaps) out.push(out[out.length - 1] + ((end - start) * g) / total);
  return out;
}

/** Typing windows, shared by picture and sound. */
export const TYPING = {
  question: [6.25, 7.4, 7],
  command: [12.75, 13.35, 11],
};

/** When each word of a streamed answer appears, spread evenly over [start, end]. */
export function streamTimes(words, start, end) {
  const n = Math.max(1, words.length - 1);
  return words.map((_, i) => start + ((end - start) * i) / n);
}
