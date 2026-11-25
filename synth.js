// A synthesizer, in the manner of the early electronic Bach records: each voice
// of the fugue is one line on a patch of its own, so the voices are told apart
// by the color of their sound as well as by where they lie. A patch is the old
// recipe: a few plain waves, a filter that opens as the note is struck and
// closes a little as it is held, and a loudness that rises quickly and falls
// away when the note is let go. Nothing is recorded; the page makes all of it.
// A fugue's page plays it as the music goes (app.js), and the clip page plays
// a whole clip into memory with it (clip/sound.js).
//
// A louder note is also a brighter one here (its filter opens further), which
// the sampled instruments cannot do, so a reading of the fugue (reading.js) is
// heard in the color of the sound and not only in its level. And on the
// patches that hold their notes, a held note has a vibrato, as a player's
// would: each note its own, so that no two swing alike.
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
// rise instead of starting open, as a brass player's tone does. `sway`: how far, in cents either way, a
// held note's vibrato swings at most (a note held two seconds or more, played plainly; see `voice`). The
// plucked patches have none: their notes die away before a vibrato could come in.
const PATCHES = {
  // ---- the first set: one color of the old synthesizer for each voice
  reed: { waves: [["pulse25", 0, 1]], open: [700, 3.2], strike: 2.4, ring: 2.0, rise: 0.012, fall: 0.22, rest: 0.8, sway: 12.6 },
  strings: { waves: [["sawtooth", -8, 0.6], ["sawtooth", 8, 0.6]], open: [600, 3.0], strike: 1.6, ring: 0.8, rise: 0.035, fall: 0.3, rest: 0.85, sway: 9 },
  hollow: { waves: [["square", 0, 1]], open: [500, 2.6], strike: 2.0, ring: 1.2, rise: 0.02, fall: 0.25, rest: 0.82, sway: 7.2 },
  brass: { waves: [["sawtooth", 0, 1]], open: [450, 2.4], strike: 2.6, ring: 1.6, rise: 0.045, fall: 0.3, rest: 0.8, swell: true, sway: 9 },
  bass: { waves: [["sawtooth", 0, 1], ["square", -1200, 0.45]], open: [320, 3.4], strike: 3.0, ring: 2.6, rise: 0.006, fall: 0.16, rest: 0.7, sway: 5.4 },

  // ---- a brass choir: every voice a saw whose tone swells open, bright at the top and round below
  trumpet: { waves: [["sawtooth", 0, 1], ["sawtooth", 6, 0.5]], open: [900, 4.2], strike: 1.9, ring: 1.4, rise: 0.028, fall: 0.25, rest: 0.86, swell: true, sway: 10.8 },
  cornet: { waves: [["sawtooth", 0, 1]], open: [700, 3.3], strike: 2.0, ring: 1.2, rise: 0.032, fall: 0.28, rest: 0.86, swell: true, sway: 9 },
  horn: { waves: [["sawtooth", 0, 1], ["triangle", 0, 0.5]], open: [420, 2.1], strike: 2.2, ring: 1.0, rise: 0.05, fall: 0.3, rest: 0.86, swell: true, sway: 7.2 },
  trombone: { waves: [["sawtooth", 0, 1], ["square", 0, 0.3]], open: [380, 2.6], strike: 2.4, ring: 1.2, rise: 0.04, fall: 0.3, rest: 0.84, swell: true, sway: 7.2 },
  tuba: { waves: [["sawtooth", 0, 1], ["square", -1200, 0.35]], open: [260, 2.8], strike: 2.2, ring: 1.0, rise: 0.035, fall: 0.3, rest: 0.84, swell: true, sway: 5.4 },

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

// Each voice's vibratos are drawn from a sequence of its own, the same each time the sound is made: a clip
// sounds the same each time it is made, and no two voices swing in step.
const seeded = (seed) => { let s = seed | 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; }; };
const counted = new WeakMap();       // context -> how many voices have been made in it

/**
 * A voice of the synthesizer: one patch, sounding into `out`. As on the instruments this imitates, the
 * voice has a single filter, which every note it plays opens afresh; the notes themselves are plain
 * waves, each with its own rise and fall. What comes back is the voice's way of playing a note: from
 * `when` until it is let go at `off`, `loud` the level it is sounded at (as a factor), and `touch` how hard
 * it is played (1 is plain, as the reading has it). A note played harder is brighter, and one played more
 * softly is duller; a plain note has the color the patch was made with. (The color is not taken from the
 * level, which also holds the page's own setting of the synthesizer and of the voice in the mix.)
 *
 * A note held for 0.4 seconds or more, on a patch with a `sway`, has a vibrato. It comes in a little after
 * the note begins and grows over half a second; its speed (4.8 to 6.2 swings a second, wavering a little),
 * where in its swing it begins, and its depth are the note's own, the depth greater the longer and the harder
 * the note is played. It moves the loudness and the color a little as well as the pitch.
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
  const index = counted.get(ctx) || 0;
  counted.set(ctx, index + 1);
  const random = seeded(9871 + 7919 * index);

  const play = (midi, when, off, loud, touch = 1) => {
    const pitch = 440 * 2 ** ((midi - 69) / 12), level = loud * trim;
    const color = Math.min(1.1, Math.max(0.3, 0.55 * touch ** 1.6));
    const held = Math.min(12000, (patch.open[0] + patch.open[1] * pitch) * color);
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

    const tones = [];
    for (const [shape, cents, share] of patch.waves) {
      const wave = ctx.createOscillator(), part = ctx.createGain();
      if (shape.startsWith("pulse")) wave.setPeriodicWave(pulse(ctx, Number(shape.slice(5)))); else wave.type = shape;
      wave.frequency.value = pitch;
      wave.detune.value = cents;
      part.gain.value = share;
      wave.connect(part).connect(amp);
      wave.start(when); wave.stop(ends);
      tones.push(wave);
      waves.push(wave);
    }

    // The vibrato: `swing` goes from nothing to its full swing and back as the note is held and let go, and
    // from it the pitch, the loudness and the color.
    const dur = off - when;
    if (patch.sway && dur >= 0.4) {
      const rate = 4.8 + 1.4 * random(), phase = random();
      const lfo = ctx.createOscillator(), waver = ctx.createOscillator(), wavering = ctx.createGain(), swing = ctx.createGain();
      lfo.frequency.value = rate;
      waver.frequency.value = 0.3 + 0.4 * random();
      wavering.gain.value = 0.35;
      waver.connect(wavering).connect(lfo.frequency);
      const begin = when + Math.min(0.28, dur * 0.3), full = Math.min(begin + 0.55, when + dur * 0.8);
      swing.gain.value = 0;              // nothing yet: its oscillator starts a little before the note does
      swing.gain.setValueAtTime(0, begin);
      swing.gain.linearRampToValueAtTime(1, full);
      swing.gain.setTargetAtTime(0, off, RELEASE / 3);
      lfo.connect(swing);
      const longer = Math.min(1, (dur - 0.4) / 1.6), harder = Math.min(1.2, Math.max(0.85, touch ** 0.5));
      const cents = ctx.createGain();
      cents.gain.value = patch.sway * (0.75 + 0.5 * longer) * harder;
      swing.connect(cents);
      for (const wave of tones) cents.connect(wave.detune);
      const louder = ctx.createGain();
      louder.gain.value = level * 0.035;
      swing.connect(louder).connect(amp.gain);
      const brighter = ctx.createGain();
      brighter.gain.value = held * 0.04;
      swing.connect(brighter).connect(filter.frequency);
      const start = Math.max(0, when - phase / rate);      // begun earlier, so as to be at that point in its swing
      lfo.start(start); waver.start(start);
      lfo.stop(ends); waver.stop(ends);
      waves.push(lfo, waver);
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
