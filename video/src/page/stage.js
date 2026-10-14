// The film, as a function of time. render(t) sets every element from t alone (no wall clock, no CSS transitions),
// so frame n is the same picture on every run. render.mjs calls it once per frame and captures the result.
import { CUES, KICKS, SCENES, TYPING, rng, streamTimes, typeTimes } from "/timeline.mjs";
import data from "/data.mjs";
import { createWater } from "./water.js";

const fmt = new URLSearchParams(location.search).get("fmt") || "16x9";
const stage = document.getElementById("stage");
stage.className = `fmt-${fmt}`;
const cam = document.getElementById("cam");
const flash = document.getElementById("flash");
const W = stage.clientWidth;
const H = stage.clientHeight;
const tall = fmt === "9x16";
const square = fmt === "1x1";

// ---------- small tools ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lin = (t, a, b) => clamp((t - a) / (b - a));
const mix = (a, b, x) => a + (b - a) * x;
const E = {
  outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inExpo: (x) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
  inOutExpo: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
  outCubic: (x) => 1 - Math.pow(1 - x, 3),
  inCubic: (x) => x * x * x,
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outBack: (x, s = 1.7) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2),
  outQuint: (x) => 1 - Math.pow(1 - x, 5),
};
const inScene = (t, name, pre = 0, post = 0) => t >= SCENES[name][0] - pre && t < SCENES[name][1] + post;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const codeHtml = (s) => esc(s).replace(/`([^`]*)`/g, "<code>$1</code>");
function el(tag, cls, html, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}
const vis = (e, on) => {
  const v = on ? "visible" : "hidden";
  if (e.style.visibility !== v) e.style.visibility = v;
};
/** Split text into words; a `code span` with spaces stays one word. */
function words(text) {
  const out = [];
  let cur = "";
  let code = false;
  for (const ch of text) {
    if (ch === "`") code = !code;
    if (ch === " " && !code) {
      if (cur) out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
/** A decaying shake from seeded noise: [dx, dy] in px. */
function shake(t, at, amp, dur = 0.35) {
  if (t < at || t > at + dur) return [0, 0];
  const k = 1 - (t - at) / dur;
  const r = rng(Math.floor(t * 60) * 13 + Math.floor(at * 100));
  return [(r() - 0.5) * 2 * amp * k * k, (r() - 0.5) * 2 * amp * k * k];
}

// The mark's own geometry (BrandMark.astro): 「 is the person, 」 the AI, in an 80-unit box.
const MARK_L = '<svg viewBox="8 8 80 80"><path fill="#f5f5f5" d="M8 8H56V24H24V72H8Z"/></svg>';
const MARK_R = '<svg viewBox="8 8 80 80"><path fill="#E5412A" d="M88 88H40V72H72V24H88Z"/></svg>';
const CHECK = '<svg viewBox="0 0 16 16"><path d="M2.8 8.6l3.3 3.3 7.1-7.6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"/></svg>';
const CROSS = '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2.2" stroke-linecap="square"/></svg>';

// ---------- build ----------
const scene = (id) => Object.assign(el("section", "scene", null, cam), { id });

// Hook: "The software changed." rising out of the surface line.
const hook = scene("s-hook");
const hookRows = tall ? [["The"], ["software"], ["changed."]] : square ? [["The", "software"], ["changed."]] : [["The", "software", "changed."]];
const surfaceY = H * parseFloat(getComputedStyle(stage).getPropertyValue("--surface"));
const hookBlock = el("h1", "rows", null, hook);
const hookWords = [];
for (const r of hookRows) {
  const row = el("div", "row", null, hookBlock);
  for (const w of r) hookWords.push(el("span", "w", esc(w), row));
}
const hookLine = el("div", "surface-line", null, hook);

// Montage: a wall of every silent change behind, one change at a time in front.
const montage = scene("s-montage");
const wall = el("div", "wall", null, montage);
const wallLines = [...data.wall, ...data.wall, ...data.wall];
for (const line of wallLines) el("p", null, esc(line), wall);
el("div", "halo", null, montage);
const cut = el("div", "cut", null, montage);
const cutPkg = el("div", "pkg", null, cut);
const cutHead = el("div", "head", null, cut);
const cutChip = el("div", "chip silent-chip", "Silent", cut);
const montageFoot = el("div", "foot", esc(data.montageTeacher), montage);

// Silent.
const silent = scene("s-silent");
const silentBig = el("div", "big", "Silent.", silent);
const silentText = data.lesson.silent.replace(/^Silent: /, "");
const silentLine = el("div", "line", esc(silentText[0].toUpperCase() + silentText.slice(1)), silent);

// Question and answer panels.
function panel(id, { kicker, answer, note, stamp, strike }) {
  const s = scene(id);
  s.classList.add("panel");
  const box = el("div", "box", null, s);
  const head = el("div", "head", null, box);
  el("span", "chip", esc(kicker), head);
  el("span", null, esc(`Claude Code · ${data.model} · ${data.installed} installed`), head);
  const q = el("div", "q", null, box);
  el("span", "p", "&gt;", q);
  const qChars = [...data.question].map((ch) => el("span", null, esc(ch), q));
  const qCaret = el("span", "caret", null, q);
  const a = el("div", "a", null, box);
  const ws = words(answer);
  const aWords = [];
  ws.forEach((w, i) => {
    aWords.push(el("span", "w", codeHtml(w), a));
    if (i < ws.length - 1) a.appendChild(document.createTextNode(" "));
  });
  const aCaret = el("span", "caret", null, a);
  const strikes = [];
  if (strike) {
    // The phrase, found by its words in the recorded answer.
    const sw = words(strike);
    const from = ws.findIndex((_, i) => sw.every((x, j) => ws[i + j] === x));
    if (from < 0) throw new Error(`strike phrase not in answer: ${strike}`);
    strikes.push({ from, to: from + sw.length - 1, bars: [] });
  }
  const st = el("div", "stamp", esc(stamp), box);
  const n = el("div", "note", esc(note), box);
  return { s, box, head, q, qChars, qCaret, a, aWords, aCaret, strikes, stamp: st, note: n };
}
const wrong = panel("s-wrong", {
  kicker: "Without Ludion",
  answer: data.without.excerpt,
  note: `Recorded answer, graded ${data.without.grade}. FreshBench ${data.bench.date}, one trial per condition.`,
  stamp: "Confidently wrong.",
  strike: "don't inherit anything from your root config by default.",
});
const right = panel("s-right", {
  kicker: "With ludion sync",
  answer: data.with.excerpt,
  note: `Recorded answer, graded ${data.with.grade}. Same model, same question, after ${data.sync.command}.`,
  stamp: "Correct.",
});

// Sync: the command, typed into silence.
const sync = scene("s-sync");
const term = el("div", "term", null, sync);
const cmd = el("div", "cmd", null, term);
el("span", "p", "$", cmd);
const cmdChars = [...data.sync.command].map((ch) => el("span", null, esc(ch), cmd));
const cmdCaret = el("span", "caret", null, cmd);
const out = el("div", "out", null, term);
const outLines = data.sync.output.map((l) => el("p", null, esc(l), out));

// The lesson, as sync wrote it.
const lesson = scene("s-lesson");
const lessonHalo = el("div", "halo", null, lesson);
const card = el("div", "card", null, lesson);
const kick = el("div", "kick", null, card);
el("span", "chip solid", "Silent", kick);
el("span", null, ".ludion/lessons.md", kick);
const lPkg = el("div", "pkg", esc(data.lesson.pkg), card);
const lClaim = el("div", "claim", codeHtml(data.lesson.head), card);
const lDetail = el("div", "detail", esc(data.lesson.detail), card);
const ev = el("div", "ev", null, card);
const runs = data.lesson.tests.map((r, i) => {
  const run = el("span", "run", `${esc(data.lesson.packageName)} <b>${esc(r.version)}</b> ${r.expect === "fail" ? CROSS : CHECK} ${r.expect === "fail" ? "must fail" : "must pass"}`, ev);
  const arrow = i < data.lesson.tests.length - 1 ? el("span", "arrow", "→", ev) : null;
  return { run, arrow };
});
const teacherText = data.lesson.teacher;
const tSplit = teacherText.indexOf("verified");
const lTeacher = el("div", "teacher", `${esc(teacherText.slice(0, tSplit))}<span class="seal">${esc(teacherText.slice(tSplit).replace(/\.$/, ""))}</span>.`, card);

// The measured totals.
const proof = scene("s-proof");
const chart = el("div", "chart", null, proof);
const proofTitle = el("h3", null, esc(`${data.bench.total} questions on vitest, wrangler and agents changes.`), chart);
const bars = el("div", "bars", null, chart);
function bar(label, n, dim) {
  const b = el("div", `bar${dim ? " dim" : ""}`, null, bars);
  el("div", "label", esc(label), b);
  const track = el("div", "track", null, b);
  const fill = el("div", "fill", null, track);
  const num = el("div", "num", null, b);
  return { b, fill, num, n };
}
const barWithout = bar("without sync", data.bench.without, true);
const barWith = bar("with ludion sync", data.bench.with, false);
const proofNote = el("div", "foot", esc(`FreshBench B questions, ${data.bench.date}: Claude Code (${data.model}) with its default tools, in projects with the new versions installed. One trial per condition.`), proof);

// End: the mark closes, the wordmark, the line from the site, the command.
const end = scene("s-end");
const lockup = el("div", "lockup", null, end);
const markSlot = el("div", "markslot", null, lockup);
const wordmark = el("div", "wordmark", data.wordmark, lockup);
const tag = el("div", "tag", esc(data.tagline), end);
const cta = el("div", "cta", null, end);
const ctaCmd = el("span", "cmd", `<span class="p">$</span>${esc(data.sync.command)}`, cta);
const ctaUrl = el("span", "url", "ludion.ai", cta);

// The two halves of the mark, on their own layer above the scenes.
const bl = el("div", "bracket l", MARK_L, cam);
const br = el("div", "bracket r", MARK_R, cam);

// ---------- layout that depends on measured text ----------
let geo = null;
function measure() {
  // Hook rows sit on the surface line.
  hookBlock.style.top = `${surfaceY - hookBlock.offsetHeight + hookBlock.offsetHeight * 0.06}px`;
  hookLine.style.top = `${surfaceY}px`;
  // Centre the vertical blocks.
  for (const [e, y] of [[card, 0.5], [term, 0.46], [chart, 0.5]]) e.style.marginTop = `${-e.offsetHeight * y}px`;
  // Where each answer word ends, for the caret.
  for (const p of [wrong, right]) {
    Object.assign(p.aCaret.style, { position: "absolute", left: "0", top: "0", height: `${p.aWords[0].offsetHeight * 0.76}px`, width: "0.5em" });
    p.wordBox = p.aWords.map((w) => ({ x: w.offsetLeft + w.offsetWidth, y: w.offsetTop + w.offsetHeight * 0.12, h: w.offsetHeight }));
  }
  // Strike bars: one per line the phrase covers.
  for (const p of [wrong]) {
    for (const s of p.strikes) {
      const lines = new Map();
      for (let i = s.from; i <= s.to; i++) {
        const w = p.aWords[i];
        const key = w.offsetTop;
        const cur = lines.get(key) ?? { left: Infinity, right: -Infinity, top: key, h: w.offsetHeight };
        cur.left = Math.min(cur.left, w.offsetLeft);
        cur.right = Math.max(cur.right, w.offsetLeft + w.offsetWidth);
        lines.set(key, cur);
      }
      for (const l of lines.values()) {
        const b = el("div", "strike", null, p.a);
        Object.assign(b.style, { left: `${l.left}px`, top: `${l.top + l.h * 0.56}px`, width: `${l.right - l.left}px` });
        s.bars.push(b);
      }
    }
  }
  // Stamps: bottom right of the box, where 」 closes; "Correct." sits beside the bracket.
  const corner = parseFloat(getComputedStyle(stage).getPropertyValue("--corner"));
  for (const p of [wrong, right]) {
    const bw = p.box.clientWidth;
    const bh = p.box.clientHeight;
    if (tall) p.stamp.style.width = `${bw - corner * 1.25}px`;
    const sw = p.stamp.offsetWidth;
    p.stamp.style.left = `${Math.max(0, bw - sw - corner * 1.25)}px`;
    p.stamp.style.top = `${bh - p.stamp.offsetHeight * 0.95}px`;
  }
  const box = wrong.box.getBoundingClientRect();
  const slot = markSlot.getBoundingClientRect();
  geo = {
    corner,
    tl: [box.left, box.top],
    brPos: [box.right - corner, box.bottom - corner],
    slot: [slot.left, slot.top, slot.width],
    lockupW: lockup.offsetWidth,
  };
}

/** 0..1, a short flare after each kick drum. */
function pulse(t, rate = 9) {
  let last = -1;
  for (const k of KICKS) if (k <= t) last = k;
  return last < 0 ? 0 : Math.exp(-(t - last) * rate);
}

// ---------- the water ----------
const draw = createWater(document.getElementById("water"));
function water(t) {
  const p = { time: t * 0.62, surface: surfaceY, light: 0, line: 0, above: 1, swell: 1, flood: 0, focus: 0.7, focusY: 0.5, glitch: 0, scale: 1 };
  if (t < SCENES.hook[1]) {
    p.above = 0;
    p.light = 0.55 * E.outCubic(lin(t, 0.15, 1.2));
    p.line = 0.0;
    p.focusY = surfaceY / H;
    p.hit = [W / 2 + (tall || square ? 0 : W * 0.2), surfaceY, t - CUES.slam];
    // The surface falls away at the end of the hook, so the montage is under water.
    p.surface = surfaceY - H * 1.2 * E.inExpo(lin(t, 1.6, 2.0));
    p.light += 0.2 * lin(t, 1.6, 2.0);
  } else if (t < SCENES.montage[1]) {
    const i = Math.max(0, CUES.montageCuts.findLastIndex((c) => t >= c));
    const since = t - CUES.montageCuts[i];
    p.light = 0.14 + 0.36 * Math.exp(-since * 14) + 0.1 * pulse(t);
    p.time = t * 0.62 + i * 0.9; // each cut shows a different patch of water
    p.scale = 0.9 + 0.08 * (i % 3);
  } else if (t < SCENES.silent[1]) {
    // A single ring, with the sonar ping: the only thing that moves.
    p.light = 0.09 + 0.04 * lin(t, 4.0, 6.0);
    p.swell = 0;
    p.time = t * 0.25;
    p.hit = [W / 2, H * 0.42, t - CUES.muffle];
  } else if (t < SCENES.wrong[1]) {
    p.light = 0.08 + 0.05 * Math.exp(-(t - SCENES.wrong[0]) * 4);
    p.focusY = 0.45;
    p.glitch = t >= CUES.stamp ? Math.exp(-(t - CUES.stamp) * 5) + 0.6 * lin(t, 12.1, 12.5) : 0;
    p.light *= t >= CUES.stamp ? 0.5 : 1;
  } else if (t < SCENES.sync[1]) {
    // The water rises under the command until it floods at the drop.
    const k = E.inCubic(lin(t, CUES.enter, CUES.drop));
    p.above = 0;
    p.surface = mix(H * 1.08, -H * 0.05, k);
    p.light = 0.08 + 0.6 * k;
    p.line = 0.9 * lin(t, CUES.enter, CUES.enter + 0.3);
    p.focusY = 0.5;
    p.swell = 1 + 3 * k;
  } else if (t < SCENES.lesson[1]) {
    const since = t - CUES.drop;
    p.flood = 0.75 * Math.exp(-since * 5);
    p.light = 0.3 + 0.85 * Math.exp(-since * 2.2) + 0.12 * pulse(t);
    p.hit = [W / 2, H / 2, since];
    p.focusY = 0.5;
    p.scale = 1.15;
  } else if (t < SCENES.right[1]) {
    p.light = 0.1 + 0.15 * Math.exp(-(t - SCENES.right[0]) * 3) + 0.08 * pulse(t);
    if (t >= CUES.close && geo) {
      p.hit = [geo.brPos[0] + geo.corner / 2, geo.brPos[1] + geo.corner / 2, t - CUES.close];
      p.light += 0.35 * Math.exp(-(t - CUES.close) * 2.5);
    }
  } else if (t < SCENES.proof[1]) {
    p.light = 0.12 + 0.1 * pulse(t);
  } else {
    // The site's own picture: water under a rule, the lockup on it.
    const since = t - CUES.markClose;
    p.above = 0;
    p.surface = mix(-H * 0.05, H * (tall ? 0.52 : 0.56), E.outExpo(lin(t, 26.0, 26.9)));
    p.light = 0.18 + 0.45 * E.outCubic(lin(t, 26.2, 27.4));
    p.line = 0.85 * lin(t, 26.3, 26.8);
    p.focusY = tall ? 0.62 : 0.7;
    p.hit = geo ? [geo.slot[0] + geo.slot[2] / 2, p.surface, since] : undefined;
    p.flood = 0.3 * Math.exp(-Math.max(0, since) * 6);
  }
  draw(p);
}

// ---------- scenes ----------
const qTimes = typeTimes(data.question, ...TYPING.question);
const cmdTimes = typeTimes(data.sync.command, ...TYPING.command);
const wrongTimes = streamTimes(wrong.aWords, CUES.answerStart, CUES.answerEnd);
const rightTimes = streamTimes(right.aWords, CUES.rightAnswerStart, CUES.rightAnswerEnd);

function renderHook(t) {
  const on = inScene(t, "hook");
  vis(hook, on);
  if (!on) return;
  hookLine.style.transform = `scaleX(${E.outExpo(lin(t, 0.0, 0.55))})`;
  hookLine.style.opacity = 1 - lin(t, 1.7, 1.95);
  const starts = tall ? [0.2, 0.42, CUES.slam] : square ? [0.2, 0.42, CUES.slam] : [0.2, 0.42, CUES.slam];
  hookWords.forEach((w, i) => {
    const s = starts[i];
    let y;
    let sc = 1;
    if (i === hookWords.length - 1) {
      // "changed." slams in on the beat.
      const k = lin(t, s, s + 0.16);
      y = (1 - E.outExpo(k)) * 105;
      sc = 1 + 0.12 * (1 - E.outQuint(lin(t, s, s + 0.4))) * (t >= s ? 1 : 0);
    } else y = (1 - E.outExpo(lin(t, s, s + 0.55))) * 105;
    // All of it sinks back under the line at the end.
    y += 110 * E.inExpo(lin(t, 1.62, 1.98));
    w.style.transform = `translateY(${y}%) scale(${sc})`;
  });
}

function renderMontage(t) {
  const on = inScene(t, "montage");
  vis(montage, on);
  if (!on) return;
  const i = Math.max(0, CUES.montageCuts.findLastIndex((c) => t >= c));
  const item = data.montage[i];
  if (cut.dataset.i !== String(i)) {
    cut.dataset.i = String(i);
    cutPkg.textContent = item.pkg;
    cutHead.innerHTML = codeHtml(item.head);
  }
  const since = t - CUES.montageCuts[i];
  const last = i === data.montage.length - 1;
  const sc = 1 + 0.07 * Math.exp(-since * 16);
  cut.style.transform = `translateY(-50%) scale(${sc})`;
  cut.style.opacity = 1 - E.inExpo(lin(t, 3.93, 4.0));
  cutChip.style.opacity = last ? E.outCubic(lin(t, CUES.montageCuts[i] + 0.12, CUES.montageCuts[i] + 0.25)) : 0;
  // The wall runs up, and jumps on every cut.
  const lh = 46;
  const y = -((t - 2) * 260 + i * lh * 5) - lh * 10;
  wall.style.transform = `translateY(${y}px)`;
  wall.style.opacity = 0.9 - 0.5 * lin(t, 3.6, 4.0);
  montageFoot.style.opacity = E.outCubic(lin(t, 2.05, 2.3));
}

function renderSilent(t) {
  const on = inScene(t, "silent");
  vis(silent, on);
  if (!on) return;
  const k = lin(t, 4.0, 6.0);
  const out = E.inExpo(lin(t, 5.7, 6.0));
  silentBig.style.letterSpacing = `${mix(0.0, -0.05, E.outCubic(k))}em`;
  silentBig.style.opacity = 1 - out;
  silentBig.style.transform = `translateY(-50%) translateY(${-out * 40}px)`;
  silentBig.style.filter = out > 0 ? `blur(${out * 18}px)` : "none";
  const l = E.outExpo(lin(t, CUES.silentLine, CUES.silentLine + 0.6));
  silentLine.style.opacity = l * (1 - out);
  silentLine.style.transform = `translateY(${(1 - l) * 24 - out * 40}px)`;
}

function renderPanel(t, p, o) {
  const on = t >= o.from && t < o.to;
  vis(p.s, on);
  if (!on) return;
  const enter = E.outExpo(lin(t, o.from, o.from + 0.5));
  p.box.style.transform = `translateY(${(1 - enter) * 120}px)`;
  p.box.style.opacity = enter * (1 - (o.fadeOut ? lin(t, o.fadeOut[0], o.fadeOut[1]) : 0));
  p.head.style.opacity = E.outCubic(lin(t, o.from + 0.05, o.from + 0.35));
  // Question.
  p.qChars.forEach((c, i) => {
    if (o.typed) c.style.display = t >= qTimes[i] ? "" : "none";
    else c.style.opacity = E.outCubic(lin(t, o.from + 0.1, o.from + 0.3));
  });
  const typing = o.typed && t < qTimes[qTimes.length - 1] + 0.15;
  p.qCaret.style.opacity = typing ? 1 : 0;
  // Answer, word by word.
  p.aWords.forEach((w, i) => {
    const k = E.outCubic(lin(t, o.times[i], o.times[i] + 0.12));
    w.style.opacity = k * (o.dimAt && t >= o.dimAt ? mix(1, 0.32, E.outCubic(lin(t, o.dimAt, o.dimAt + 0.35))) : 1);
    w.style.transform = `translateY(${(1 - k) * 0.25}em)`;
  });
  // The caret follows the last word shown.
  const streaming = t >= o.times[0] - 0.3 && t < o.times[o.times.length - 1] + 0.6;
  const shownIdx = o.times.findLastIndex((x) => t >= x);
  const at = shownIdx >= 0 ? p.wordBox[shownIdx] : { x: 0, y: p.wordBox[0].y, h: p.wordBox[0].h };
  p.aCaret.style.transform = `translate(${at.x + (shownIdx >= 0 ? 8 : 0)}px, ${at.y}px)`;
  p.aCaret.style.opacity = streaming && (t < o.times[0] || Math.floor(t * 4) % 2 === 0) ? 1 : 0;
  // Strike the false phrase.
  for (const s of p.strikes) {
    s.bars.forEach((b, j) => {
      const k = E.inOutCubic(lin(t, o.dimAt + j * 0.12, o.dimAt + 0.22 + j * 0.12));
      b.style.transform = `scaleX(${k})`;
      b.style.opacity = k > 0 ? 1 : 0;
    });
  }
  // The stamp.
  const sk = lin(t, o.stampAt, o.stampAt + 0.18);
  p.stamp.style.opacity = sk > 0 ? 1 : 0;
  p.stamp.style.transform = `translateY(${(1 - E.outExpo(sk)) * 40}%) scale(${1 + 0.18 * (1 - E.outQuint(lin(t, o.stampAt, o.stampAt + 0.45)))})`;
  p.stamp.style.transformOrigin = "100% 100%";
  p.note.style.opacity = E.outCubic(lin(t, o.noteAt, o.noteAt + 0.4));
}

function renderSync(t) {
  const on = inScene(t, "sync");
  vis(sync, on);
  if (!on) return;
  cmdChars.forEach((c, i) => (c.style.display = t >= cmdTimes[i] ? "" : "none"));
  const blink = Math.floor((t - 12.5) * 3.2) % 2 === 0;
  cmdCaret.style.opacity = t < CUES.enter ? (t < cmdTimes[0] ? (blink ? 1 : 0) : 1) : 0;
  const lift = E.outExpo(lin(t, CUES.enter, CUES.enter + 0.3));
  term.style.transform = `translateY(${-lift * 60}px)`;
  outLines.forEach((l, i) => {
    const k = E.outCubic(lin(t, CUES.output + i * 0.12, CUES.output + i * 0.12 + 0.2));
    l.style.opacity = k;
    l.style.transform = `translateY(${(1 - k) * 12}px)`;
  });
  // Pressure: everything leans in toward the drop.
  const push = E.inExpo(lin(t, 13.8, 15.0));
  sync.style.transform = `scale(${1 + 0.1 * push})`;
  sync.style.opacity = 1 - E.inExpo(lin(t, 14.85, 15.0));
}

function renderLesson(t) {
  const on = inScene(t, "lesson");
  vis(lesson, on);
  if (!on) return;
  const rise = (a, d = 0.5) => {
    const k = E.outExpo(lin(t, a, a + d));
    return { o: k, y: (1 - k) * 60 };
  };
  const parts = [
    [kick, CUES.drop],
    [lPkg, CUES.drop + 0.04],
    [lClaim, CUES.drop + 0.08],
    [lDetail, CUES.lessonDetail],
    [ev, CUES.evidence],
    [lTeacher, CUES.teacher],
  ];
  for (const [e, a] of parts) {
    const r = rise(a);
    e.style.opacity = r.o;
    e.style.transform = `translateY(${r.y}px)`;
  }
  // The claim develops under the light, left to right.
  const sweep = E.outCubic(lin(t, CUES.drop, CUES.drop + 0.7)) * 130 - 15;
  const mask = `linear-gradient(90deg, #000 ${sweep}%, transparent ${sweep + 15}%)`;
  lClaim.style.maskImage = mask;
  lPkg.style.maskImage = mask;
  runs.forEach(({ run, arrow }, i) => {
    const k = E.outBack(lin(t, CUES.evidence + i * 0.22, CUES.evidence + i * 0.22 + 0.3));
    run.style.transform = `scale(${0.85 + 0.15 * k})`;
    run.style.opacity = clamp(k * 1.5);
    if (arrow) arrow.style.opacity = lin(t, CUES.evidence + 0.15, CUES.evidence + 0.3);
  });
  const outK = E.inExpo(lin(t, 18.15, 18.5));
  card.style.transform = `translateY(${-outK * H * 0.25}px)`;
  card.style.opacity = 1 - outK;
  lessonHalo.style.opacity = E.outCubic(lin(t, CUES.drop, CUES.drop + 0.4)) * (1 - outK);
}

function renderProof(t) {
  const on = inScene(t, "proof");
  vis(proof, on);
  if (!on) return;
  const k = E.outExpo(lin(t, CUES.proofIn, CUES.proofIn + 0.5));
  proofTitle.style.opacity = k;
  proofTitle.style.transform = `translateY(${(1 - k) * 30}px)`;
  for (const [b, at] of [[barWithout, CUES.barWithout], [barWith, CUES.barWith]]) {
    const g = E.outCubic(lin(t, at, at + 0.55));
    b.b.style.opacity = E.outCubic(lin(t, at - 0.15, at + 0.1));
    b.fill.style.transform = `scaleX(${(g * b.n) / data.bench.total})`;
    const shown = Math.round(g * b.n);
    b.num.innerHTML = `${shown}<small>/${data.bench.total}</small>`;
    b.num.style.opacity = shown > 0 ? 1 : 0;
  }
  proofNote.style.opacity = E.outCubic(lin(t, CUES.barWith + 0.3, CUES.barWith + 0.7));
  const outK = E.outCubic(lin(t, 25.35, 25.65));
  chart.style.opacity = 1 - outK;
  chart.style.transform = `scale(${1 - 0.06 * outK})`;
  proofNote.style.opacity = Math.min(proofNote.style.opacity, 1 - outK);
}

function renderEnd(t) {
  const on = t >= SCENES.end[0];
  vis(end, on);
  if (!on) return;
  const w = E.outExpo(lin(t, CUES.wordmark, CUES.wordmark + 0.6));
  wordmark.style.clipPath = `inset(-10% ${(1 - w) * 100}% -10% 0)`;
  wordmark.style.transform = `translateX(${(1 - w) * -30}px)`;
  const g = E.outExpo(lin(t, CUES.tagline, CUES.tagline + 0.6));
  tag.style.opacity = g;
  tag.style.transform = `translateY(${(1 - g) * 24}px)`;
  const c = E.outExpo(lin(t, CUES.cta, CUES.cta + 0.6));
  cta.style.opacity = c;
  cta.style.transform = `translateY(${(1 - c) * 24}px)`;
}

// The brackets: 「 frames both answers and the totals; 」 fails to land on the wrong answer, locks on the right one,
// and the two meet as the mark.
function renderBrackets(t) {
  if (!geo) return;
  const c = geo.corner;
  let L = null;
  let R = null;
  const enterL = (from) => E.outExpo(lin(t, from, from + 0.4));
  if (t >= SCENES.wrong[0] && t < 12.5) {
    const k = enterL(SCENES.wrong[0]);
    const out = E.inExpo(lin(t, 12.1, 12.45));
    L = { x: geo.tl[0] - (1 - k) * 60, y: geo.tl[1] - (1 - k) * 60, s: 1, o: k * (1 - out) };
    if (t >= CUES.stamp - 0.08) {
      // The AI's half arrives at the wrong place, flickers, and falls away.
      const a = t - (CUES.stamp - 0.08);
      const r = rng(Math.floor(t * 30) + 5);
      const fall = Math.max(0, a - 0.45);
      R = {
        x: geo.brPos[0] - c * 0.55 + (r() - 0.5) * 30 * Math.exp(-a * 3),
        y: geo.brPos[1] - c * 0.35 + 900 * fall * fall,
        s: 1,
        rot: -9 + 40 * fall,
        o: (a < 0.45 ? (r() > 0.25 ? 1 : 0.25) : 1) * (1 - lin(fall, 0.5, 0.8)),
      };
    }
  } else if (t >= SCENES.right[0] && t < CUES.markClose) {
    const k = enterL(SCENES.right[0]);
    L = { x: geo.tl[0] - (1 - k) * 60, y: geo.tl[1] - (1 - k) * 60, s: 1, o: k };
    if (t >= CUES.close - 0.35) {
      const a = E.outBack(lin(t, CUES.close - 0.35, CUES.close), 1.2);
      R = { x: mix(W + c, geo.brPos[0], a), y: mix(H + c, geo.brPos[1], a), s: 1, o: 1 };
    }
    // The mark: both halves fly into the lockup and meet.
    if (t >= CUES.markClose - 0.45) {
      const m = E.inOutExpo(lin(t, CUES.markClose - 0.45, CUES.markClose));
      const s = geo.slot[2] / c;
      L = { x: mix(L.x, geo.slot[0], m), y: mix(L.y, geo.slot[1], m), s: mix(1, s, m), o: 1 };
      R = { x: mix(R.x, geo.slot[0], m), y: mix(R.y, geo.slot[1], m), s: mix(1, s, m), o: 1 };
    }
  } else if (t >= CUES.markClose) {
    const s = geo.slot[2] / c;
    L = { x: geo.slot[0], y: geo.slot[1], s, o: 1 };
    R = { ...L };
  }
  for (const [e, v] of [[bl, L], [br, R]]) {
    vis(e, !!v && v.o > 0.001);
    if (!v) continue;
    e.style.opacity = v.o;
    e.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.s})${v.rot ? ` rotate(${v.rot}deg)` : ""}`;
    e.style.transformOrigin = v.rot ? "50% 50%" : "0 0";
  }
}

// ---------- the frame ----------
const tearNoise = document.getElementById("tear-noise");
const tearMap = document.getElementById("tear-map");
const whipBlur = document.getElementById("whip-blur");

function camera(t) {
  // A slow push-in through every scene, reset at each cut, so nothing is ever still.
  const sc = Object.values(SCENES).find(([a, b]) => t >= a && t < b) ?? SCENES.end;
  let s = 1 + 0.025 * E.outCubic(lin(t, sc[0], sc[1]));
  if (inScene(t, "silent")) s = 1 + 0.045 * lin(t, 4, 6);
  if (inScene(t, "lesson")) s = 1.05 - 0.035 * E.outCubic(lin(t, 15, 18.5));
  if (inScene(t, "right") || inScene(t, "proof")) s = 1; // the frame of brackets must hold still to close
  if (t >= SCENES.end[0]) s = 1 + 0.02 * E.outCubic(lin(t, SCENES.end[0] + 0.4, SCENES.end[1]));
  const shakes = [
    shake(t, CUES.slam, 10),
    shake(t, CUES.stamp, 16, 0.4),
    shake(t, CUES.drop, 22, 0.5),
    shake(t, CUES.close, 6, 0.25),
    shake(t, CUES.markClose, 9, 0.3),
  ];
  const dx = shakes.reduce((a, b) => a + b[0], 0);
  const dy = shakes.reduce((a, b) => a + b[1], 0);
  cam.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
  // Tearing on the slam, the stamp, and out of the wrong answer.
  let tear = 0;
  if (t >= CUES.slam && t < CUES.slam + 0.22) tear = 26 * (1 - (t - CUES.slam) / 0.22);
  if (t >= CUES.stamp && t < CUES.stamp + 0.4) tear = 60 * (1 - (t - CUES.stamp) / 0.4);
  if (t >= 12.15 && t < 12.5) tear = 140 * lin(t, 12.15, 12.5);
  if (t >= CUES.drop && t < CUES.drop + 0.2) tear = 40 * (1 - (t - CUES.drop) / 0.2);
  if (tear > 0.5) {
    tearNoise.setAttribute("seed", String(Math.floor(t * 60) % 97));
    tearNoise.setAttribute("baseFrequency", `0.0001 ${0.03 + 0.05 * rng(Math.floor(t * 60))()}`);
    tearMap.setAttribute("scale", tear.toFixed(1));
    cam.style.filter = "url(#tear)";
  } else cam.style.filter = "none";
  // Flashes: each montage cut, the drop, the mark.
  let f = 0;
  for (const c of CUES.montageCuts) if (t >= c && t < c + 0.1) f = Math.max(f, 0.14 * (1 - (t - c) / 0.1));
  if (t >= CUES.drop) f = Math.max(f, 0.85 * Math.exp(-(t - CUES.drop) * 9));
  if (t >= CUES.markClose) f = Math.max(f, 0.3 * Math.exp(-(t - CUES.markClose) * 10));
  flash.style.opacity = f;
}

function render(t) {
  water(t);
  renderHook(t);
  renderMontage(t);
  renderSilent(t);
  renderPanel(t, wrong, {
    from: SCENES.wrong[0], to: SCENES.wrong[1], typed: true, times: wrongTimes,
    dimAt: CUES.stamp, stampAt: CUES.stamp, noteAt: CUES.answerStart, fadeOut: [12.1, 12.5],
  });
  renderSync(t);
  renderLesson(t);
  renderPanel(t, right, {
    from: SCENES.right[0], to: SCENES.right[1], typed: false, times: rightTimes,
    dimAt: null, stampAt: CUES.close + 0.05, noteAt: CUES.rightAnswerStart, fadeOut: [22.7, 23.0],
  });
  renderProof(t);
  renderEnd(t);
  renderBrackets(t);
  camera(t);
}

window.film = {
  ready: document.fonts.ready.then(() => {
    measure();
    render(0);
  }),
  render(t) {
    render(t);
    // Two animation frames: the DOM and the WebGL canvas are both painted before the capture.
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  },
};
