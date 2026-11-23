// The piano, for the fugue page and the clip page alike: the Salamander Grand Piano (Alexander Holm's
// recordings of a Yamaha C5, CC BY 3.0, retuned by Markus Fiedler), cut down for the web by
// tools/salamander/build.py to six loudnesses of every third key from C1 to C7 (soundfonts/salamander).
//
// A softer note is a recording of a softer blow, so its colour is its own; a key between two recorded ones
// is the nearer one played a little faster or slower. Three things are in the playing rather than in the
// recordings, and both pages take them from here so that they play alike:
//   - no two strikes alike: each note a little louder or softer, brighter or darker, by chance (the same
//     chance every time the note is played, so that a clip and the page agree);
//   - notes struck together are not quite together: the highest first, the softer later;
//   - the other strings ring in sympathy, as if the pedal were held a little (`strings`, for a convolver).

const FOLDER = new URL("./soundfonts/salamander/", import.meta.url);

// At this gain the piano's middle loudness is as strong as the sampled piano the pages had before was at its
// own (0.9; measured over the 0.3 s after the strike, C2 to C6), so it sits with the other instruments as that did.
export const GAIN = 0.193;
// How strongly the strings answer: with this on what the convolver gives back, the halo is about 18 dB
// under the piano.
export const HALO = 0.012;

let ix = null;
const bank = new Map();       // "<key>v<layer>" -> { buffer, long }
const coming = new Map();     // the same, with "s" or "l" -> a recording on its way

/** What the set holds (soundfonts/salamander/index.json), read once. */
export async function index() {
  if (!ix) {
    const got = await (await fetch(new URL("index.json", FOLDER))).json();
    const keys = Object.keys(got.notes).map(Number).sort((a, b) => a - b), mid = keys.map((c) => got.notes[c][10].level);
    // The keys as recorded are not evenly loud (the A below middle C is 4.5 dB under middle C), so each is
    // brought to the trend of the five around it.
    got.even = new Map(keys.map((c, i) => { const near = mid.slice(Math.max(0, i - 2), i + 3); return [c, near.reduce((a, b) => a + b, 0) / near.length]; }));
    got.low = keys[0]; got.high = keys.at(-1);
    ix = got;
  }
  return ix;
}

/**
 * The recording for a note `db` louder or softer than the middle loudness: the nearest recorded key, the
 * layer that is by nature nearest that loudness, the gain that brings it exactly there, and the speed that
 * tunes it. With `loaded` set, only a layer that has been fetched is chosen (the nearest there is), or
 * nothing if the key has none yet. `index()` must have been awaited.
 */
export function pick(midi, db, loaded = false) {
  const c = Math.min(ix.high, Math.max(ix.low, ix.low + 3 * Math.round((midi - ix.low) / 3))), key = ix.notes[c], base = key[10].level;
  let v = null;
  for (const w of ix.layers) {
    if (loaded && !bank.has(`${c}v${w}`)) continue;
    if (v === null || Math.abs(key[w].level - base - db) < Math.abs(key[v].level - base - db)) v = w;
  }
  if (v === null) return null;
  return { key: `${c}v${v}`, gain: 10 ** ((ix.even.get(c) + db - key[v].level) / 20), rate: 2 ** ((midi - c + key[v].tune / 100) / 12) };
}

/** A fetched recording: an AudioBuffer, with `strike`, the second in it just before the hammer lands. */
export const recording = (key) => bank.get(key)?.buffer;

/**
 * Fetch the recordings a piece needs: `needs` maps each ("<key>v<layer>") to how many seconds of it the
 * longest note on it takes. Most notes are short, and get the 4-second file; a longer one gets the whole.
 * `decoder` is any audio context (its rate is the rate of the buffers).
 */
export async function load(decoder, needs) {
  await index();
  await Promise.all([...needs].map(async ([key, seconds]) => {
    const long = seconds > ix.short - 0.5, have = bank.get(key);
    if (have && (have.long || !long)) return;
    const name = `${key}${long ? "" : "s"}`;
    if (!coming.has(name)) {
      coming.set(name, (async () => {
        const r = await fetch(new URL(`${name}.m4a`, FOLDER));
        if (!r.ok) throw new Error(`the piano's ${name} could not be fetched (${r.status})`);
        const buffer = await decoder.decodeAudioData(await r.arrayBuffer());
        // Where the strike is, whatever the decoder put before it: the first sample at 3% of the loudest in
        // the first half second (the files begin 3 ms before it).
        const a = buffer.getChannelData(0), b = buffer.getChannelData(buffer.numberOfChannels > 1 ? 1 : 0);
        const n = Math.min(a.length, Math.round(0.5 * buffer.sampleRate));
        let peak = 0, at = 0;
        for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(a[i]), Math.abs(b[i]));
        while (at < n && Math.max(Math.abs(a[at]), Math.abs(b[at])) < 0.03 * peak) at++;
        buffer.strike = Math.max(0, at / buffer.sampleRate - 0.003);
        const now = bank.get(key);
        if (!now || (long && !now.long)) bank.set(key, { buffer, long });
      })().finally(() => coming.delete(name)));
    }
    await coming.get(name).catch(() => {});     // a note that cannot be fetched is not played; the rest are
  }));
}

/** Those of `needs` (as for `load`) that are not fetched yet, or fetched too short. */
export function lacking(needs) {
  const out = new Map();
  for (const [key, seconds] of needs) {
    const have = bank.get(key);
    if (!have || (seconds > ix.short - 0.5 && !have.long)) out.set(key, seconds);
  }
  return out;
}

// The same chance for the same note every time: a number from 0 to 1 from the note and a salt.
function chance(v, on, midi, salt) {
  let h = Math.imul(Math.round(on * 960) + 1, 2654435761) ^ Math.imul(v + 1, 40503) ^ Math.imul(midi + 7, 2246822519) ^ Math.imul(salt, 3266489917);
  h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13; h = Math.imul(h, 3266489917); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const bell = (v, on, midi, salt) => Math.sqrt(-2 * Math.log(1 - chance(v, on, midi, salt))) * Math.cos(2 * Math.PI * chance(v, on, midi, salt + 1));

export const id = (v, on, midi) => `${v}:${on}:${midi}`;

/**
 * How the piano's notes are struck: `struck` lists them ({ v, on, midi, db, aside }: voice, moment in
 * crotchets, pitch, how much louder than the middle loudness the playing wants it, and whether it is an
 * ornament's side note). For each (`id`): `db`, with the chance of the strike added (about 0.6 dB either
 * way); `shelf`, how much brighter or darker than its recording (dB above 1.5 kHz, about 1.2 either way);
 * and `lead`, how many seconds late it comes: of notes struck together, the highest is first and the others
 * 5 to 15 ms after it, and a softer note later still (7 ms for each dB under the loudest, at most 20), as a
 * softly thrown hammer takes longer to reach the string.
 */
export function touches(struck) {
  const out = new Map(), together = new Map();
  for (const s of struck) {
    const key = id(s.v, s.on, s.midi);
    out.set(key, { db: s.db + 0.6 * bell(s.v, s.on, s.midi, 1), shelf: 1.2 * bell(s.v, s.on, s.midi, 3), lead: 0 });
    if (s.aside) continue;
    const moment = Math.round(s.on * 960);
    (together.get(moment) || together.set(moment, []).get(moment)).push({ ...s, key });
  }
  for (const group of together.values()) {
    if (group.length < 2) continue;
    const loudest = Math.max(...group.map((g) => g.db)), highest = Math.max(...group.map((g) => g.midi));
    for (const g of group) {
      out.get(g.key).lead = (Math.min(20, 7 * (loudest - g.db)) + (g.midi === highest ? 0 : 5 + 10 * chance(g.v, g.on, g.midi, 5))) / 1000;
    }
  }
  return out;
}

// How long a piano string rings before it is 60 dB down, roughly, by pitch.
const RINGS = [[21, 25], [36, 20], [48, 15], [60, 11], [72, 7], [84, 4], [96, 1.8], [108, 1.0]];
function ring(m) {
  if (m <= RINGS[0][0]) return RINGS[0][1];
  for (let i = 1; i < RINGS.length; i++) {
    if (m > RINGS[i][0]) continue;
    const [a, x] = RINGS[i - 1], [b, y] = RINGS[i], w = (m - a) / (b - a);
    return Math.exp(Math.log(x) * (1 - w) + Math.log(y) * w);
  }
  return RINGS.at(-1)[1];
}

const halos = new Map();      // rate -> the strings, for that rate

/**
 * The strings as a sounding board, for a convolver (with `normalize` off): each of the 88 with its first six
 * partials, ringing in sympathy, each dying at its own pitch's rate (at most 3.5 s here). Scaled so that
 * what comes back is as strong, in all, as what went in; `HALO` then says how much of it is heard.
 */
export function strings(rate, seconds = 4) {
  if (halos.has(rate)) return halos.get(rate);
  const length = Math.ceil(seconds * rate), ir = new AudioBuffer({ numberOfChannels: 2, length, sampleRate: rate });
  let seed = 97531;
  const u = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let m = 21; m <= 108; m++) {
      const f0 = 440 * 2 ** ((m - 69) / 12);
      for (let k = 1; k <= 6; k++) {
        const f = f0 * k;
        if (f > 8000) break;
        const life = Math.min(3.5, ring(69 + 12 * Math.log2(f / 440)));
        const fall = Math.exp(-6.9 / life / rate), w = (2 * Math.PI * f) / rate, phase = 2 * Math.PI * u();
        let re = Math.cos(phase) / k, im = Math.sin(phase) / k;
        const cr = Math.cos(w) * fall, ci = Math.sin(w) * fall;
        for (let i = 0; i < length; i++) { d[i] += re; const next = re * cr - im * ci; im = re * ci + im * cr; re = next; }
      }
    }
    const tail = Math.round(0.3 * rate);
    for (let i = 0; i < tail; i++) d[length - tail + i] *= 1 - i / tail;
    let power = 0;
    for (let i = 0; i < length; i++) power += d[i] * d[i];
    const scale = 1 / Math.sqrt(power);
    for (let i = 0; i < length; i++) d[i] *= scale;
  }
  halos.set(rate, ir);
  return ir;
}
