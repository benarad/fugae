// A reading of the fugue: how the plain notes are shaped into a performance.
// The analysis already knows most of what a player goes by (which voice has the
// subject, where a statement begins and ends, where the cadences fall, where
// the bar lines are), so the shaping is worked out from it by rule. There are
// three dials, each from 0 to 1, and at 0 its part of the reading is absent:
//
//   expression  how loud each note is and how long it is held
//   rubato      how the tempo bends
//   room        how far apart the voices sit, and how much of a room is heard
//
// This file is beside the pages, not in clip/, because the fugue's page shapes its playing by it too.
//
// Nothing here makes a sound. `pacing` gives the clock its bend, and `reading`
// gives the sound (sound.js) what to do with each note and each voice.
//
// A fugue may instead be shaped after a performer (`python -m fugae shape`, which
// writes styles/): her timing habits, her touch, her loudness, and her phrasing of
// the subject where she recorded it, at a strength from 0 (as written) to 2 (twice
// her measure). `after` gives the sound what that makes of each note, and the clock
// takes its timing from the shaping's map (`shapedTime`). The room is the same dial
// either way.

const lerp = (a, b, x) => a + (b - a) * x;
const ease = (x) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };

/** A random number from 0 to 1 that is always the same for the same `seed`. */
function chance(seed) {
  let x = (seed + 0x6d2b79f5) | 0;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}

/** The length of a beat, in quarter notes: a dotted note in the compound meters, the whole bar in 3/8. */
function beatOf(meter) {
  const [count, unit] = (meter || "4/4").split("/").map(Number), one = 4 / unit;
  if (count % 3 === 0 && count > 3) return 3 * one;
  if (count === 3 && unit >= 8) return 3 * one;
  return one;
}

/**
 * How the tempo bends over the clip: `pace(q)` is how many times its plain length a beat lasts at `q`.
 * The music eases into each cadence and picks up again after it, broadens through its last bar and
 * holds the close, and takes a short breath before a statement that enters on its own.
 */
export function pacing(piece, score, range, rubato) {
  if (!rubato) return null;
  const bar = piece.measures[0].length, inside = (q) => q > range.from + 1e-6 && q < range.to - 1e-6;
  const bends = [];          // each slows from `from` to `peak` by `depth`, and is back in tempo by `to`
  const ends = range.to >= piece.end - 1e-6;
  const close = ends ? Math.max(...score.notes.filter((n) => !n.beside).map((n) => n.on)) : Infinity;   // the last note struck
  if (ends) bends.push({ from: close - Math.min(bar, 4), peak: close, to: Infinity, depth: 0.5 * rubato });
  for (const c of piece.cadences || []) {
    if (!inside(c.start) || c.start > close - bar) continue;
    bends.push({ from: c.start - Math.min(2, bar / 2), peak: c.start, to: c.start + 0.75, depth: 0.16 * rubato });
  }
  const entries = score.marks.filter((m) => m.kind === "entry");
  for (const m of entries) {
    if (!inside(m.start) || m.start > close - bar || m.entry.exposition) continue;
    if (entries.some((x) => x !== m && x.start < m.start && x.end > m.start + 1e-6)) continue;      // not in a stretto
    bends.push({ from: m.start - 0.5, peak: m.start - 0.02, to: m.start, depth: 0.22 * rubato });
  }
  return (q) => {
    let slower = 0;
    for (const b of bends) {
      if (q <= b.from || q >= b.to) continue;
      slower += b.depth * (q <= b.peak ? ease((q - b.from) / (b.peak - b.from)) : b.to === Infinity ? 1 : 1 - ease((q - b.peak) / (b.to - b.peak)));
    }
    return 1 + slower;
  };
}

/**
 * What the sound does with each note and each voice.
 *   touch   for each note: `gain` (how loud, as a factor), `hold` (how much of its length it sounds),
 *           `nudge` (seconds early or late, a few thousandths, so that no two notes are struck as one)
 *   voices  for each voice: `pan` (-1 left to 1 right) and `veiled`, the stretches (in quarter notes) where it
 *           accompanies a theme in another voice and sounds a little duller for it
 *   wet     how much of the room is mixed in
 * `insts` are the instruments, one for each voice: their plain `hold`, and their `touch` (how far the
 * loudness answers the player, which is fully for a piano and barely for a harpsichord).
 */
export function reading(piece, score, range, { expression = 0, room = 0 }, insts) {
  const e = expression, instOf = (v) => insts[v] || insts[0], feelOf = (v) => e * (instOf(v).touch ?? 1);
  const count = piece.voices.length;
  const lines = piece.voices.map((_, v) => score.notes.filter((n) => n.v === v && !n.beside));
  const entries = score.marks.filter((m) => m.kind === "entry");
  const busy = (q, but) => entries.some((m) => m.voice !== but && m.start <= q + 1e-6 && q < m.end - 1e-6);
  const beat = beatOf(piece.meter);
  const middle = lines.map((line) => (line.length ? line.reduce((sum, n) => sum + n.midi[0], 0) / line.length : 60));
  const partAt = (q) => piece.sections.find((x) => x.start <= q + 1e-6 && q < x.end) || null;

  // Where each note stands in a statement of a theme, if it is in one: 0 at its start, 1 at its end.
  const along = new Map(), opens = new Set();
  for (const m of score.marks) {
    if (m.kind === "entry" && m.notes.length) opens.add(m.notes[0]);
    for (const n of m.notes) if (m.kind === "entry" || !along.has(n)) along.set(n, [(n.on - m.start) / Math.max(1e-6, m.end - m.start), m.kind]);
  }

  const touch = new Map();
  score.notes.forEach((n, i) => {
    // ---- how loud, in decibels above or below plain
    let db = 0;
    const theme = n.cls && !n.cls.startsWith("cs");
    if (theme) db += 3.5;                                         // the voice with the subject is brought out
    else if (busy(n.on, n.v)) db -= n.cls ? 1 : n.frag ? 2 : 3.2; // and the others give way to it
    else if (n.cls) db += 0.5;
    const place = along.get(n);
    if (place) {                                                  // a statement rises to its middle and tapers
      const [x, kind] = place;
      db += (kind === "entry" ? 1.6 : 0.9) * (Math.sin(Math.PI * Math.min(1, x * 1.15)) - 0.6 * x);
    }
    db += Math.max(-1.2, Math.min(1.2, 0.07 * (n.midi[0] - middle[n.v])));      // a line's high notes carry a little further
    const bar = piece.measures.find((m) => m.start <= n.on + 1e-6 && n.on < m.start + m.length - 1e-6);
    if (bar) {
      const into = n.on - bar.start, off = Math.abs(into / beat - Math.round(into / beat)) * beat;
      if (into < 1e-6) db += 0.9; else if (off < 1e-6) db += 0.35; else if (n.end - n.on <= 0.26) db -= 0.4;
    }
    const part = partAt(n.on);
    if (part) db += part.kind === "episode" ? -1 : part.kind === "final" ? 1.5 : part.label.startsWith("Stretto") ? 0.8 : 0;
    if (n.end - n.on >= 2) db += 0.8;                             // a long note has to last
    db = Math.max(-7, Math.min(5, db)) * feelOf(n.v);

    // ---- how long it is held: steps are joined, leaps and repeated notes parted, and a voice lifts before it enters
    const line = lines[n.v], at = n.beside ? -1 : line.indexOf(n), next = at >= 0 ? line[at + 1] : null;
    const plain = instOf(n.v).hold;
    let hold = plain;
    if (next && next.on - n.end < 0.01) {
      const leap = Math.abs(next.midi[0] - n.midi[0]);
      let rule = leap === 0 ? 0.78 : leap <= 2 ? Math.max(plain, 0.995) : leap <= 4 ? 0.9 : 0.74;
      if (n.end - n.on >= 1 && leap > 2) rule = Math.max(rule, 0.86);
      if (opens.has(next)) rule = Math.min(rule, 0.72);
      hold = lerp(plain, rule, e);
    }
    touch.set(n, { gain: 10 ** (db / 20), hold, nudge: opens.has(n) ? 0 : (chance(i * 7919 + n.midi[0]) - 0.5) * 0.012 * e });
  });

  // ---- the voices: spread from the low ones on the left to the high on the right, as at a keyboard
  const wide = 0.6 * room;
  const voices = piece.voices.map((_, v) => {
    const veiled = [];
    if (e) {
      // While another voice has a theme and this one has none, it is veiled.
      const cuts = [...new Set(entries.flatMap((m) => [m.start, m.end]))].sort((a, b) => a - b);
      for (let i = 0; i + 1 < cuts.length; i++) {
        const q = (cuts[i] + cuts[i + 1]) / 2;
        const own = entries.some((m) => m.voice === v && m.start <= q && q < m.end);
        if (!own && busy(q, v)) {
          const last = veiled[veiled.length - 1];
          if (last && Math.abs(last[1] - cuts[i]) < 1e-6) last[1] = cuts[i + 1]; else veiled.push([cuts[i], cuts[i + 1]]);
        }
      }
    }
    return { pan: count > 1 ? lerp(wide, -wide, v / (count - 1)) : 0, veiled, veil: lerp(16000, 5200, 0.7 * feelOf(v)) };
  });
  return { touch, voices, wet: 0.45 * room, plain: !e && !room };
}

/**
 * The shaping after a performer, as the sound takes it: for each note how loud (her loudness, scaled by how
 * far the voice's instrument answers the player) and how much of it is held (her phrasing of the subject and
 * her touch), at `strength`. The voices' places and the room are the room dial's, as in `reading`.
 */
export function after(piece, score, range, shaping, strength, room, insts) {
  const base = reading(piece, score, range, { expression: 0, room }, insts);
  const holds = new Map((shaping.hold || []).map(([v, on, h]) => [`${v}:${on}`, h]));
  const lifts = new Map((shaping.level || []).map(([v, on, db]) => [`${v}:${on}`, db]));
  // The rise and fall of loudness over the fugue, where the shaping has it (as on the fugue's page: one
  // measured in a recording is never played more than as measured).
  const d = shaping.dynamics, most = d?.from === "recording" ? Math.min(1, strength) : strength;
  const swell = (on) => {
    if (!d) return 0;
    const x = Math.max(0, Math.min(d.db.length - 1, (on - d.start) / d.step)), i = Math.floor(x);
    return (d.db[i] + (d.db[Math.min(d.db.length - 1, i + 1)] - d.db[i]) * (x - i)) * most;
  };
  const touch = new Map();
  for (const n of score.notes) {
    const inst = insts[n.v] || insts[0], key = `${n.v}:${n.on}`, held = holds.get(key);
    touch.set(n, {
      gain: 10 ** ((((lifts.get(key) || 0) * strength + swell(n.on)) * (inst.touch ?? 1)) / 20),
      hold: held === undefined ? inst.hold : Math.max(0.3, inst.hold + (held - inst.hold) * strength),
      nudge: 0,
    });
  }
  return { ...base, touch };
}

/**
 * Her timing, as a map for the clock (stage.js `traced`): moments of the score in quarter notes, and the seconds
 * at which they are played at `bpm`. Each gap after a moment at which notes begin is taken longer or shorter
 * than written by her habit there (a logarithm), times `strength`.
 */
export function shapedTime(piece, shaping, strength, bpm) {
  const stretch = shaping.stretch, beat = 60 / bpm;
  const xs = [...stretch.map((p) => p[0]), piece.end + 1], ys = [xs[0] * beat];
  for (let k = 0; k < stretch.length; k++) ys.push(ys[k] + (xs[k + 1] - xs[k]) * beat * Math.exp(strength * stretch[k][1]));
  // Before her first moment, at the written tempo.
  if (xs[0] > 0) { xs.unshift(0); ys.unshift(0); }
  return { xs, ys };
}

// ------------------------------------------------------------------ the fugue as it is read

const FORMS = {
  inversion: ["inverted", "inv."], augmentation: ["augmented", "aug."], diminution: ["diminished", "dim."],
  "inverted diminution": ["inverted and diminished", "inv. dim."],
  "inverted augmentation": ["inverted and augmented", "inv. aug."],
};

/**
 * The fugue as the clips and the readings use it: notes in order of time, each knowing its theme (and, as `src`,
 * the note of the analysis it is), and the statements of the themes.
 */
export function read(piece) {
  // `beside`: a note written into a voice beside its own line (a chord, a part that divides for a bar).
  const notes = piece.notes
    .map((n) => ({ v: n.v, on: n.on, end: n.on + n.dur, midi: n.midi, cls: null, frag: null, beside: Boolean(n.beside), src: n,
                   orn: n.orn, aux: n.aux, stacc: Boolean(n.stacc) }))
    .sort((a, b) => a.on - b.on || a.v - b.v);
  const byVoice = piece.voices.map((_, v) => notes.filter((n) => n.v === v));

  // `share`: how much of its theme a statement has, as the share of the theme's notes that are there.
  const count = (x) => (Array.isArray(x) ? x.length : x) || 0;
  const lengths = new Map([[1, count(piece.subject && piece.subject.notes)], ...(piece.later_subjects || []).map((s) => [s.number, count(s.notes)])]);
  const marks = [];
  for (const e of piece.entries) {
    const later = (e.theme || 1) > 1;        // a subject introduced after the exposition
    const name = later ? `Subject ${e.theme}` : e.role === "answer" ? "Answer" : "Subject";
    const [how, brief] = FORMS[e.form] || ["", ""];
    marks.push({
      kind: "entry", cls: later ? `s${e.theme}` : e.role, voice: e.voice, start: e.start, end: e.end, entry: e,
      share: e.complete ? 1 : Math.min(1, e.notes / (lengths.get(e.theme || 1) || e.notes || 1)),
      name: how ? `${name}, ${how}` : name,
      short: (later ? `S${e.theme}` : e.role === "answer" ? "A" : "S") + (brief ? ` ${brief}` : ""),
      key: e.key || "",
    });
  }
  const only = piece.countersubjects.length === 1;
  for (const cs of piece.countersubjects) {
    for (const o of cs.occurrences) {
      marks.push({
        kind: "cs", cls: `cs${cs.number}`, voice: o.voice, start: o.start, end: o.end,
        share: o.score,
        name: only ? "Countersubject" : `Countersubject ${cs.number}`, short: only ? "CS" : `CS ${cs.number}`, key: "",
      });
    }
  }
  marks.sort((a, b) => a.start - b.start);

  const within = (v, start, end) => byVoice[v].filter((n) => n.on >= start - 1e-6 && n.on < end - 1e-6);
  for (const m of marks) {
    m.notes = within(m.voice, m.start, m.end);
    for (const n of m.notes) if (!n.cls || m.kind === "entry") n.cls = m.cls;
  }
  // In an episode, a figure taken from a theme keeps a trace of the theme's color.
  for (const f of piece.fragments || []) {
    for (const n of within(f.voice, f.start, f.end)) if (!n.cls) n.frag = f.source;
  }

  const ranges = byVoice.map((line) => {
    const all = line.flatMap((n) => n.midi);
    return all.length ? { lo: Math.min(...all), hi: Math.max(...all) } : { lo: 60, hi: 60 };
  });
  return { piece, notes, marks, ranges, longest: Math.max(...notes.map((n) => n.end - n.on)) };
}
