// The harpsichords, for the fugue page and the clip page alike: recordings from the Versilian Community
// Sample Library (Versilian Studios and contributors, public domain: https://github.com/sgossner/VCSL), cut
// down for the web by tools/harpsichord/build.py (soundfonts/harpsichords, a folder for each register).
//
// Each register has a recording for every whole tone or so, and beside each the sound
// of that key let go: the jack falling back and the damper landing. What a recording is called is not
// trusted for its pitch: its pitch was measured, and a note is played on the recording nearest it, a little
// faster or slower, so every note is in tune. The keys were not evenly loud as recorded, so each is brought
// to the trend of the five around it. A harpsichord with two registers drawn plays both for every note.

const FOLDER = new URL("./soundfonts/harpsichords/", import.meta.url);

// What the pages offer. `registers`: each folder, and how many keys above the note it sounds (12 for a 4′).
// `gain`: at it the instrument is as strong as the harpsichord the pages had before was at its own (0.55),
// so it sits with the piano and the synthesizer as that did: measured as the energy of every note of all
// 68 fugues, each as long as it is held, in each channel. (Heard in mono these are some 3 dB weaker than
// that one, which was nearly mono itself: they are wide recordings, and their two sides do not add up.)
// The first is the pages' harpsichord; the others are named for what they are.
export const KINDS = {
  harpsichord: { label: "Harpsichord", what: "a Flemish harpsichord with both its registers drawn, 8′ and 4′", registers: [["flemish8", 0], ["flemish4", 12]], gain: 0.264 },
  "harpsichord:french": { label: "French harpsichord", what: "a French harpsichord, the darkest of them", registers: [["french", 0]], gain: 0.348 },
  "harpsichord:italian": { label: "Italian harpsichord", what: "an Italian harpsichord, bright and lean", registers: [["italian", 0]], gain: 0.264 },
  "harpsichord:english": { label: "English harpsichord", what: "an English harpsichord (a Zuckermann kit of the 1970s), the brightest of them", registers: [["english", 0]], gain: 0.345 },
  "harpsichord:lute": { label: "English harpsichord, lute stop", what: "the English harpsichord with its lute stop: drier, its notes soon gone", registers: [["english-lute", 0]], gain: 0.42 },
};
// How long the damper takes to stop a string, in seconds (what is heard after it is the key's own sound).
export const DAMP = 0.045;
// The sound of a key let go follows how far its note has died away, within these limits (dB beside how it
// was recorded): a note let go at once is hardly louder in its key, and one long gone still has its jack.
const BACK = [-18, 3];

const sets = new Map();       // folder -> its index, on the way or there
const bank = new Map();       // "<folder>/<n>" -> { buffer, strike, env, gone, goneAt }
const coming = new Map();     // the same -> a recording on its way

async function register(folder) {
  if (!sets.has(folder)) {
    sets.set(folder, (async () => {
      const ix = await (await fetch(new URL(`${folder}/index.json`, FOLDER))).json();
      ix.notes.forEach((note, i) => {
        const near = ix.notes.slice(Math.max(0, i - 2), i + 3);
        note.even = near.reduce((sum, o) => sum + o.level, 0) / near.length;
        note.key = `${folder}/${i}`;
      });
      return ix;
    })());
    sets.get(folder).catch(() => sets.delete(folder));
  }
  return sets.get(folder);
}

const ready = new Map();      // kind -> its registers' indexes, once read

/** What a harpsichord's registers hold, read once. */
export async function index(kind) {
  if (!ready.has(kind)) ready.set(kind, await Promise.all(KINDS[kind].registers.map(([folder]) => register(folder))));
  return ready.get(kind);
}

/**
 * The recordings a note of `kind` is played on, one for each register: `key` (for `load` and `recording`),
 * the speed that tunes it, the gain that evens it, and `release`, what the index says of its key let go
 * (or nothing). `index(kind)` must have been awaited.
 */
export function picks(kind, midi) {
  return KINDS[kind].registers.map(([, above], r) => {
    const want = midi + above, notes = ready.get(kind)[r].notes;
    const note = notes.reduce((best, o) => (Math.abs(o.pitch - want) < Math.abs(best.pitch - want) ? o : best));
    return { key: note.key, rate: 2 ** ((want - note.pitch) / 12), gain: 10 ** ((note.even - note.level) / 20), release: note.release || null };
  });
}

// Where the pluck is, whatever the decoder put before it: the first sample at 3% of the loudest.
function begins(buffer) {
  const data = buffer.getChannelData(0);
  let top = 0, at = 0;
  for (let i = 0; i < data.length; i++) if (Math.abs(data[i]) > top) top = Math.abs(data[i]);
  while (at < data.length && Math.abs(data[at]) < 0.03 * top) at++;
  return Math.max(0, at / buffer.sampleRate - 0.003);
}

/** Fetch the recordings named (`keys`, from `picks`) that are not yet there; `ctx` decodes them. */
export function load(ctx, keys) {
  return Promise.all([...new Set(keys)].filter((key) => !bank.has(key)).map((key) => {
    if (!coming.has(key)) {
      const get = async (file, must) => {
        const r = await fetch(new URL(file, FOLDER));
        if (!r.ok) { if (must) throw new Error(`a harpsichord note could not be fetched (${r.status})`); return null; }
        return ctx.decodeAudioData(await r.arrayBuffer());
      };
      const [folder, n] = key.split("/"), has = sets.get(folder);
      coming.set(key, (async () => {
        const ix = await has, buffer = await get(`${folder}/${n}.m4a`, true);
        const rec = { buffer, strike: begins(buffer), env: [], gone: null, goneAt: 0 };
        // How loud the note is as it dies away (dB, every 50 ms from the pluck).
        const data = buffer.getChannelData(0), hop = Math.round(0.05 * buffer.sampleRate);
        for (let i = Math.round(rec.strike * buffer.sampleRate); i + hop <= data.length; i += hop) {
          let sum = 0;
          for (let j = i; j < i + hop; j++) sum += data[j] * data[j];
          rec.env.push(10 * Math.log10(sum / hop + 1e-12));
        }
        if (ix.notes[Number(n)].release) {
          rec.gone = await get(`${folder}/${n}r.m4a`, false);
          if (rec.gone) rec.goneAt = begins(rec.gone);
        }
        bank.set(key, rec);
      })().finally(() => coming.delete(key)));
    }
    return coming.get(key);
  }));
}

/** A fetched recording: `buffer` and `strike` (the second in it just before the pluck), and of its key let go, `gone` and `goneAt`. */
export const recording = (key) => bank.get(key);

/**
 * How loud the key's letting-go is beside its note (a gain), for a note that has sounded `held` seconds of
 * its recording: as recorded, less what the note has died since the moment it was let go in the recording
 * (`release.held`), or more if it is let go sooner.
 */
export function back(rec, release, held) {
  const at = (seconds) => rec.env[Math.min(rec.env.length - 1, Math.max(0, Math.round(seconds / 0.05)))] ?? 0;
  return 10 ** (Math.max(BACK[0], Math.min(BACK[1], at(held) - at(release.held))) / 20);
}
