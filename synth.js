// A synthesizer, in the manner of the early electronic Bach records: each voice
// of the fugue is one line on a patch of its own, so the voices are told apart
// by the colour of their sound as well as by where they lie. A patch is the old
// recipe: a few plain waves, a filter that opens as the note is struck and
// closes a little as it is held, and a loudness that rises quickly and falls
// away when the note is let go. Nothing is recorded; the page makes all of it.
// A fugue's page plays it as the music goes (app.js), and the clip page plays
// a whole clip into memory with it (clip/sound.js).
//
// A louder note is also a brighter one here (its filter opens further), which
// the sampled instruments cannot do, so a reading of the fugue (reading.js) is
// heard in the colour of the sound and not only in its level.
//
// There are three arrangements: sets of patches, one for each voice. Two more were tried and dropped (organ
// stops built from pure tones, and the bare pulse waves of a 1980s game console): in both the bass barely
// registered and the top voice was bright enough to drown the others. An arrangement has to keep the bass
// distinct and the top from dominating.

// The patches. `waves`: each wave (a saw, a square, a triangle, a sine, or a pulse so many hundredths of
// the cycle wide), how many cents it is tuned off the note, and its share of the sound.
// `open`: the filter's cutoff while the note is held, as so many hertz plus so many times the note's own
// pitch; `strike`: how many times further it is open at the moment the note begins; `ring`: its resonance.
// `rise`, `fall`: seconds for the loudness to arrive and to settle to `rest` of its height (a `rest` near
// nothing is a plucked sound, which dies away while the note is held). `swell`: the filter opens over the
// rise instead of starting open, as a brass player's tone does. `sway`: cents of vibrato that come in on
// a long note.
const PATCHES = {
  // ---- the first set: one colour of the old synthesizer for each voice
  reed: { waves: [["pulse25", 0, 1]], open: [700, 3.2], strike: 2.4, ring: 2.0, rise: 0.012, fall: 0.22, rest: 0.8, sway: 7 },
  strings: { waves: [["sawtooth", -8, 0.6], ["sawtooth", 8, 0.6]], open: [600, 3.0], strike: 1.6, ring: 0.8, rise: 0.035, fall: 0.3, rest: 0.85, sway: 5 },
  hollow: { waves: [["square", 0, 1]], open: [500, 2.6], strike: 2.0, ring: 1.2, rise: 0.02, fall: 0.25, rest: 0.82 },
  brass: { waves: [["sawtooth", 0, 1]], open: [450, 2.4], strike: 2.6, ring: 1.6, rise: 0.045, fall: 0.3, rest: 0.8, swell: true },
  bass: { waves: [["sawtooth", 0, 1], ["square", -1200, 0.45]], open: [320, 3.4], strike: 3.0, ring: 2.6, rise: 0.006, fall: 0.16, rest: 0.7 },

  // ---- a brass choir: every voice a saw whose tone swells open, bright at the top and round below
  trumpet: { waves: [["sawtooth", 0, 1], ["sawtooth", 6, 0.5]], open: [900, 4.2], strike: 1.9, ring: 1.4, rise: 0.028, fall: 0.25, rest: 0.86, swell: true, sway: 6 },
  cornet: { waves: [["sawtooth", 0, 1]], open: [700, 3.3], strike: 2.0, ring: 1.2, rise: 0.032, fall: 0.28, rest: 0.86, swell: true, sway: 5 },
  horn: { waves: [["sawtooth", 0, 1], ["triangle", 0, 0.5]], open: [420, 2.1], strike: 2.2, ring: 1.0, rise: 0.05, fall: 0.3, rest: 0.86, swell: true },
  trombone: { waves: [["sawtooth", 0, 1], ["square", 0, 0.3]], open: [380, 2.6], strike: 2.4, ring: 1.2, rise: 0.04, fall: 0.3, rest: 0.84, swell: true },
  tuba: { waves: [["sawtooth", 0, 1], ["square", -1200, 0.35]], open: [260, 2.8], strike: 2.2, ring: 1.0, rise: 0.035, fall: 0.3, rest: 0.84, swell: true },

  // ---- plucked: struck bright and dying away, like a harpsichord made of glass
  quill: { waves: [["pulse12", 0, 1], ["sawtooth", 1200, 0.2]], open: [500, 2.4], strike: 4.5, ring: 2.4, rise: 0.002, fall: 1.1, rest: 0.08 },
  glass: { waves: [["pulse25", 0, 1], ["sine", 1200, 0.35]], open: [450, 2.2], strike: 4.0, ring: 2.0, rise: 0.002, fall: 1.2, rest: 0.08 },
  lute: { waves: [["sawtooth", 0, 0.8], ["triangle", 0, 0.7]], open: [380, 2.0], strike: 4.0, ring: 1.8, rise: 0.003, fall: 1.3, rest: 0.1 },
  harp: { waves: [["triangle", 0, 1], ["pulse25", 0, 0.35]], open: [360, 2.2], strike: 3.6, ring: 1.6, rise: 0.003, fall: 1.4, rest: 0.1 },
  thumb: { waves: [["sawtooth", 0, 1], ["square", -1200, 0.4]], open: [240, 2.6], strike: 4.5, ring: 2.2, rise: 0.003, fall: 1.5, rest: 0.12 },
};

// What each patch is called where one is chosen for a voice, in the order of the three sets.
export const NAMES = {
  reed: "Reed", strings: "Strings", hollow: "Hollow", brass: "Brass", bass: "Bass",
  trumpet: "Trumpet", cornet: "Cornet", horn: "Horn", trombone: "Trombone", tuba: "Tuba",
  quill: "Quill", glass: "Glass", lute: "Lute", harp: "Harp", thumb: "Thumb bass",
};

// The arrangements: which patch each voice has, from the top voice down, for a fugue in so many voices.
export const ARRANGEMENTS = {
  classic: { label: "Classic", cast: { 1: ["reed"], 2: ["reed", "bass"], 3: ["reed", "hollow", "bass"],
    4: ["reed", "hollow", "brass", "bass"], 5: ["reed", "strings", "hollow", "brass", "bass"] } },
  brass: { label: "Brass choir", cast: { 1: ["trumpet"], 2: ["trumpet", "tuba"], 3: ["trumpet", "horn", "tuba"],
    4: ["trumpet", "horn", "trombone", "tuba"], 5: ["trumpet", "cornet", "horn", "trombone", "tuba"] } },
  plucked: { label: "Plucked", cast: { 1: ["quill"], 2: ["quill", "thumb"], 3: ["quill", "lute", "thumb"],
    4: ["quill", "glass", "lute", "thumb"], 5: ["quill", "glass", "lute", "harp", "thumb"] } },
};

// Measured: how much each patch has to be turned up or down for a note in its usual register, over the
// first half second, to be as strong as the others'. A bass patch is then given 2 dB more, since the ear
// is less keen so low down. (The first five are as they were when there was one arrangement.)
export const LEVELS = {
  reed: 1, strings: 1.16, hollow: 0.62, brass: 1.04, bass: 1.15,
  trumpet: 0.9, cornet: 1.01, horn: 0.68, trombone: 0.7, tuba: 1.11,
  quill: 2.03, glass: 1.22, lute: 0.9, harp: 1.09, thumb: 1.34,
};

/** The patches for a fugue in `count` voices, from the top voice down, in one of the arrangements. */
export function cast(count, arrangement = "classic") {
  return castNames(count, arrangement).map(patch);
}

/** The same, as the patches' names. */
export function castNames(count, arrangement = "classic") {
  const names = (ARRANGEMENTS[arrangement] || ARRANGEMENTS.classic).cast[Math.min(5, Math.max(1, count))];
  return Array.from({ length: count }, (_, v) => names[Math.min(v, names.length - 1)]);
}

/** One patch, by its name. */
export const patch = (name) => ({ name, ...PATCHES[name] });

const RELEASE = 0.09;        // seconds for a note to die away once it is let go
const shapes = new WeakMap();
/** A pulse wave so many hundredths of the cycle wide: the narrower, the more nasal. */
function pulse(ctx, hundredths) {
  if (!shapes.has(ctx)) shapes.set(ctx, new Map());
  const made = shapes.get(ctx);
  if (!made.has(hundredths)) {
    // The cosine series of a pulse of that width, about its middle.
    const count = 64, real = new Float32Array(count), imag = new Float32Array(count);
    for (let k = 1; k < count; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * hundredths / 100);
    made.set(hundredths, ctx.createPeriodicWave(real, imag));
  }
  return made.get(hundredths);
}

/**
 * A voice of the synthesizer: one patch, sounding into `out`. As on the instruments this imitates, the
 * voice has a single filter, which every note it plays opens afresh; the notes themselves are plain
 * waves, each with its own rise and fall. What comes back is the voice's way of playing a note: from
 * `when` until it is let go at `off`, `loud` as a factor (1 is plain). A louder note is brighter too.
 *
 * Playing a note gives back `end`, when it has died away, and `stop(now)`, which hushes it at once,
 * for a page that plays as the music goes and must fall silent when it is paused. The voice's own
 * `quiet(now)` forgets what it had been told to do to its filter for notes still to come.
 */
export function voice(ctx, patch, out) {
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = patch.ring;
  filter.frequency.value = 2000;
  filter.connect(out);
  const trim = LEVELS[patch.name] ?? 1;

  const play = (midi, when, off, loud) => {
    const pitch = 440 * 2 ** ((midi - 69) / 12), level = loud * trim;
    const colour = Math.min(1.8, Math.max(0.55, loud ** 1.6));
    const held = Math.min(12000, (patch.open[0] + patch.open[1] * pitch) * colour);
    const struck = Math.min(14000, held * patch.strike);
    const ends = off + RELEASE * 5;

    if (patch.swell) {
      filter.frequency.setValueAtTime(held * 0.7, when);
      filter.frequency.linearRampToValueAtTime(struck, when + patch.rise);
    } else filter.frequency.setValueAtTime(struck, when);
    filter.frequency.setTargetAtTime(held, when + patch.rise, patch.fall / 2);

    const amp = ctx.createGain(), waves = [];
    amp.gain.value = 0;
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(level, when + patch.rise);
    amp.gain.setTargetAtTime(level * patch.rest, when + patch.rise, patch.fall / 3);
    amp.gain.setTargetAtTime(0, Math.max(off, when + patch.rise), RELEASE / 3);
    amp.connect(filter);

    // On a long note a slow vibrato comes in, as a player's would.
    let sway = null;
    if (patch.sway && off - when > 0.85) {
      const slow = ctx.createOscillator();
      sway = ctx.createGain();
      slow.frequency.value = 5.6;
      sway.gain.setValueAtTime(0, when + 0.3);
      sway.gain.linearRampToValueAtTime(patch.sway, when + 0.75);
      slow.connect(sway);
      slow.start(when); slow.stop(ends);
      waves.push(slow);
    }
    for (const [shape, cents, share] of patch.waves) {
      const wave = ctx.createOscillator(), part = ctx.createGain();
      if (shape.startsWith("pulse")) wave.setPeriodicWave(pulse(ctx, Number(shape.slice(5)))); else wave.type = shape;
      wave.frequency.value = pitch;
      wave.detune.value = cents;
      if (sway) sway.connect(wave.detune);
      part.gain.value = share;
      wave.connect(part).connect(amp);
      wave.start(when); wave.stop(ends);
      waves.push(wave);
    }
    return {
      end: ends,
      stop(now) {
        amp.gain.cancelScheduledValues(now);
        amp.gain.setTargetAtTime(0, now, 0.012);
        for (const wave of waves) { try { wave.stop(now + 0.08); } catch { /* already stopped */ } }
      },
    };
  };
  play.quiet = (now) => filter.frequency.cancelScheduledValues(now);
  return play;
}
