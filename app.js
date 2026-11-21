/* Fugae browser view: score, structure timeline and playback for one analysed fugue.
 *
 * Data comes from `python -m fugae build`, which writes data/<id>.musicxml and
 * data/<id>.json. All musical time below is in quarter notes from the start.
 */

const PIECE = new URLSearchParams(location.search).get("piece");   // none: go to the list of pieces
const SVG_NS = "http://www.w3.org/2000/svg";
const SIZES = { small: 32, medium: 40, large: 50 };   // Verovio rendering scale, per cent
let scoreSize = "medium";

const INSTRUMENTS = {
  piano: { file: "soundfonts/acoustic_grand_piano-mp3.js", gain: 0.9, hold: 0.98, release: 0.14 },
  harpsichord: { file: "soundfonts/harpsichord-mp3.js", gain: 0.55, hold: 0.94, release: 0.05 },
};

// Verovio compiles in the background; hook its ready signal before anything else runs.
const verovioReady = new Promise((ready) => { verovio.module.onRuntimeInitialized = ready; });

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

let piece;          // analysis JSON
let marks = [];     // every coloured thing: entries and countersubject occurrences
let toolkit;        // Verovio
let scoreNotes = []; // notes in the rendered score: {id, el, on, off, staff, system}
let currentSystem = null;
let layoutMode = "open";    // "open": a staff for each voice; "keyboard": two staves, as in a keyboard edition
let colourMode = "voice";   // in the keyboard layout the notes are coloured by "voice" or by "theme"

// ------------------------------------------------------------------ data

function barOf(q) {
  let bar = piece.measures[0];
  for (const m of piece.measures) { if (m.start <= q + 1e-6) bar = m; else break; }
  return bar.number;
}

function barRange(start, end) {
  const a = barOf(start), b = barOf(end - 0.01);
  return a === b ? `bar ${a}` : `bars ${a}–${b}`;
}

function buildMarks() {
  const out = [];
  for (const e of piece.entries) {
    const later = (e.theme || 1) > 1; // a subject introduced after the exposition
    const role = later ? `Subject ${e.theme}` : e.role === "answer" ? "Answer" : "Subject";
    const kind = !later && e.role === "answer" ? (e.tonal ? " (tonal)" : " (real)") : "";
    const form = e.form === "direct" ? "" : `, by ${e.form}`;
    const tag = { inversion: " inv.", augmentation: " aug.", diminution: " dim.", "inverted diminution": " inv. dim." }[e.form] || "";
    const voice = piece.voices[e.voice];
    const changed = (e.altered || []).length;
    out.push({
      entry: e,
      cls: later ? `s${e.theme}` : e.role,
      short: (later ? `S${e.theme}` : e.role === "answer" ? "A" : "S") + tag,
      voice: e.voice, start: e.start, end: e.end,
      title: `${role}${kind}${e.key ? ` in ${e.key}` : ""}${form}`,
      detail: `${voice}, ${barRange(e.start, e.end)}`
        + (e.late ? ` · the ${voice.toLowerCase()}'s first entry` : "")
        + (e.ornamented ? " · ornamented: notes are added between the theme's own" : e.varied ? " · opening or rhythm varied" : "")
        + (e.partial ? " · breaks off as another voice takes over" : e.complete ? "" : " · incomplete")
        + (changed ? ` · ${changed === 1 ? "the ringed note is" : `the ${changed} ringed notes are`} a step `
          + `${e.altered_by < 0 ? "lower" : "higher"} than the rest of the answer` : ""),
      chip: `${role}${e.tonal ? " (tonal)" : ""}${tag}${e.ornamented ? " (ornamented)" : e.varied ? " (varied)" : ""}${e.key ? ` · ${e.key}` : ""}`,
    });
  }
  for (const cs of piece.countersubjects) {
    for (const o of cs.occurrences) {
      const note = o.shared ? " · shared between two voices"
        : o.score < 1 ? ` · ${Math.round(o.score * 100)}% of the line` : "";
      out.push({
        cls: `cs${cs.number}`, short: `CS${cs.number}`, voice: o.voice, start: o.start, end: o.end,
        title: `Countersubject ${cs.number}` + (cs.late ? " (introduced after the exposition)" : ""),
        detail: `${piece.voices[o.voice]}, ${barRange(o.start, o.end)}${note}`,
        chip: `Countersubject ${cs.number}`,
      });
    }
  }
  const themes = { subject: ["S", "the subject"] };
  for (const s of piece.later_subjects || []) themes[`s${s.number}`] = [`S${s.number}`, `subject ${s.number}`];
  for (const cs of piece.countersubjects) themes[`cs${cs.number}`] = [`CS${cs.number}`, `countersubject ${cs.number}`];
  for (const f of piece.fragments) {
    const [short, name] = themes[f.source];
    out.push({
      frag: true, cls: f.source, short: "", voice: f.voice, start: f.start, end: f.end,
      title: `Fragment: ${f.text}`,
      detail: `${piece.voices[f.voice]}, ${barRange(f.start, f.end)} · notes ${f.first}–${f.last} of ${name}`
        + (f.exact ? "" : " · one leap altered"),
      chip: `${short} ${f.first}–${f.last}${f.inverted ? " inv." : ""}`,
    });
  }
  out.forEach((m, i) => { m.index = i; });
  return out;
}

// Sections in the order they are heard, with the codetta slotted into the exposition.
function passages() {
  const codettas = piece.spans.filter((s) => s.kind === "codetta")
    .map((s) => ({ ...s, label: "Codetta (inside the exposition)" }));
  return [...piece.sections, ...codettas].sort((a, b) => a.start - b.start);
}

// Bars a section occupies. A section runs up to the next entry, which usually begins
// just after a downbeat, so the last bar is the one a beat before its end.
function passageBars(s) {
  return barRange(s.start, Math.max(s.start + 0.02, s.end - 1));
}

function passageDetail(s) {
  return passageBars(s) + (s.leads ? ` · ${s.leads}` : "") + (s.summary ? ` · ${s.summary}` : "");
}

function sectionAt(q) {
  return piece.sections.find((s) => q >= s.start - 1e-6 && q < s.end - 1e-6) || piece.sections.at(-1);
}

// --------------------------------------------------------------- tooltip

const tip = $("tip");
let pinned = null;          // the glossary term whose explanation was opened by a click

function unpin() {
  if (pinned) pinned.setAttribute("aria-expanded", "false");
  pinned = null;
}

// Explain a glossary term in a box anchored under the term itself.
function explain(term) {
  tip.replaceChildren(el("b", null, term.textContent), el("span", null, term.dataset.meaning));
  tip.hidden = false;
  const box = term.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  let x = Math.min(box.left, innerWidth - w - 4), y = box.bottom + 6;
  if (y + h > innerHeight - 4) y = box.top - h - 6;
  tip.style.left = `${Math.max(4, x)}px`;
  tip.style.top = `${Math.max(4, y)}px`;
}

function closeExplanation() {
  if (!pinned) return;
  unpin();
  tip.hidden = true;
}
document.addEventListener("pointerdown", (ev) => { if (!ev.target.closest?.(".term")) closeExplanation(); });
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeExplanation(); });
addEventListener("scroll", closeExplanation, { passive: true });
addEventListener("resize", closeExplanation);

// A screen that is touched, not pointed at. There a tip opens on a tap, sits above
// the finger, and stays until the next touch (or a few seconds), since nothing "leaves".
const touchScreen = matchMedia("(hover: none)");
let tipTimer = 0;

function showTip(event, title, detail) {
  unpin();
  tip.replaceChildren(el("b", null, title), el("span", null, detail || ""));
  tip.hidden = false;
  const pad = 12, w = tip.offsetWidth, h = tip.offsetHeight;
  let x = event.clientX + pad, y = event.clientY + pad;
  if (touchScreen.matches) {
    x = event.clientX - w / 2;
    y = event.clientY - h - 18;
    if (y < 4) y = event.clientY + 24;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(hideTip, 6000);
  } else {
    if (x + w > innerWidth - 4) x = event.clientX - w - pad;
    if (y + h > innerHeight - 4) y = event.clientY - h - pad;
  }
  tip.style.left = `${Math.max(4, Math.min(x, innerWidth - w - 4))}px`;
  tip.style.top = `${Math.max(4, y)}px`;
}
function hideTip() { tip.hidden = true; }
document.addEventListener("pointerdown", (ev) => { if (ev.pointerType === "touch" && !pinned) hideTip(); });

function setHot(index, on) {
  document.querySelectorAll(`[data-mark="${index}"]`).forEach((n) => n.classList.toggle("hot", on));
}

function wireMark(node, mark) {
  node.dataset.mark = mark.index;
  node.addEventListener("mousemove", (ev) => showTip(ev, mark.title, mark.detail));
  node.addEventListener("mouseenter", () => setHot(mark.index, true));
  node.addEventListener("mouseleave", () => { setHot(mark.index, false); hideTip(); });
  node.addEventListener("click", (ev) => { ev.stopPropagation(); seek(mark.start); });
}

// -------------------------------------------------------------- timeline

const pct = (q) => `${(100 * q) / piece.end}%`;

function place(node, start, end) {
  node.style.left = pct(start);
  node.style.width = pct(end - start);
  return node;
}

function trackSeek(track) {
  track.addEventListener("click", (ev) => {
    const box = track.getBoundingClientRect();
    seek(Math.max(0, Math.min(piece.end, ((ev.clientX - box.left) / box.width) * piece.end)));
  });
}

// What a block in the form row may say, longest first. The longest that fits is shown
// (see fitFormLabels); a block too narrow for any of them says nothing, and its colour
// and outline still tell an entry from an episode.
function formWordings(s, inside) {
  const head = s.label.split(":")[0];
  if (s.kind === "link") return [];
  if (s.kind === "episode") { const n = head.replace("Episode ", ""); return [head, `Ep. ${n}`, n]; }
  if (s.kind === "exposition") return [head, "Exp."];
  if (s.kind === "final") return ["Final entry", "Final"];
  if (s.kind !== "entries") return [head];
  if (/^(Stretto|Combination)/.test(s.label)) return [head, `${head.slice(0, 3)}.`];
  const long = inside.map((e) => (e.key ? e.key.replace("major", "maj").replace("minor", "min") : `S${e.theme}`));
  const short = inside.map((e) => (e.key ? e.key.replace(" major", "").replace(" minor", "m") : `S${e.theme}`));
  return [...new Set([long.join(", "), short.join(", "), short.length > 1 ? `${short[0]}…` : short[0]])];
}

function fitFormLabels() {
  for (const block of document.querySelectorAll(".block.section[data-wordings]")) {
    block.textContent = "";
    for (const wording of JSON.parse(block.dataset.wordings)) {
      block.textContent = wording;
      if (block.scrollWidth <= block.clientWidth) break;
      block.textContent = "";
    }
  }
}

// What depends on the timeline's width, set again whenever that changes.
let timelineScrolls = false;
function refitTimeline() {
  const tl = $("timeline");
  timelineScrolls = tl.scrollWidth > tl.clientWidth + 1;
  fitFormLabels();
  thinAxis();
}

// Bar numbers every five bars, or fewer where the timeline is too narrow to hold them
// (a long fugue on a phone): they are thinned until they stand clear of each other.
function thinAxis() {
  const axis = document.querySelector(".tl-track.axis");
  if (!axis || !axis.clientWidth) return;
  const each = axis.clientWidth / piece.measures.length;      // pixels to a bar
  const step = [5, 10, 20, 25, 50, 100].find((n) => n * each >= 26) || 100;
  for (const label of axis.querySelectorAll(".tick-label")) {
    const bar = Number(label.dataset.bar);
    label.hidden = bar % step !== 0 && !(bar === 1 && step * each >= 26);
  }
}

function buildTimeline() {
  const tl = $("timeline");
  tl.replaceChildren();
  tl.style.setProperty("--beats", String(Math.round(piece.end)));

  // Form: the sections, and the codetta inside the exposition.
  tl.append(el("span", "tl-label", "Form"));
  const form = el("div", "tl-track");
  for (const s of piece.sections) {
    const inside = piece.entries.filter((e) => e.start >= s.start - 1e-6 && e.start < s.end);
    const block = place(el("div", `block section ${s.kind}`), s.start, s.end);
    block.dataset.wordings = JSON.stringify(formWordings(s, inside));
    block.dataset.start = s.start;
    block.addEventListener("mousemove", (ev) => showTip(ev, s.label, passageDetail(s)));
    block.addEventListener("mouseleave", hideTip);
    form.append(block);
  }
  for (const s of piece.spans.filter((x) => x.kind === "codetta")) {
    const block = place(el("div", "block codetta"), s.start, s.end);
    block.addEventListener("mousemove", (ev) => showTip(ev, "Codetta: a link between entries inside the exposition", passageDetail(s)));
    block.addEventListener("mouseleave", hideTip);
    form.append(block);
  }
  trackSeek(form);
  tl.append(form);

  // One row per voice.
  piece.voices.forEach((name, v) => {
    const label = el("span", "tl-label");
    const toggle = el("button", `voice-toggle v${v}`, name);
    toggle.type = "button";
    toggle.setAttribute("aria-pressed", "true");
    toggle.title = `Mute or unmute the ${name.toLowerCase()}`;
    // In the keyboard layout, pointing at a voice fades the others in the score.
    // (Not on a touch screen, where a tap would leave the fading stuck on.)
    toggle.addEventListener("mouseenter", () => { if (!touchScreen.matches) $("score").classList.add("solo", `solo-v${v}`); });
    toggle.addEventListener("mouseleave", () => $("score").classList.remove("solo", `solo-v${v}`));
    toggle.addEventListener("click", () => {
      const on = toggle.getAttribute("aria-pressed") !== "true";
      toggle.setAttribute("aria-pressed", String(on));
      setVoice(v, on);
    });
    label.append(toggle);
    const track = el("div", "tl-track voice");
    for (const m of marks.filter((x) => x.voice === v)) {
      const block = place(el("div", `block ${m.cls}${m.frag ? " frag" : ""}`, m.short), m.start, m.end);
      wireMark(block, m);
      track.append(block);
    }
    for (const s of piece.spans.filter((x) => x.kind === "pedal" && x.voice === v)) {
      const bar = place(el("div", "pedal"), s.start, s.end);
      bar.addEventListener("mousemove", (ev) => showTip(ev, s.label, barRange(s.start, s.end)));
      bar.addEventListener("mouseleave", hideTip);
      track.append(bar);
    }
    trackSeek(track);
    tl.append(label, track);
  });

  buildKeyPath(tl);

  // Bar axis.
  tl.append(el("span", "tl-label", "Bar"));
  const axis = el("div", "tl-track axis");
  for (const m of piece.measures) {
    const major = m.number === 1 || m.number % 5 === 0;
    const tick = el("div", major ? "tick major" : "tick");
    tick.style.left = pct(m.start);
    axis.append(tick);
    if (major) {
      const text = el("span", m.number === 1 ? "tick-label first" : "tick-label", String(m.number));
      text.style.left = pct(m.start);
      text.dataset.bar = m.number;
      axis.append(text);
    }
  }
  for (const c of piece.cadences || []) {
    const mark = el("div", "cadence-mark");
    mark.style.left = pct(c.start);
    mark.addEventListener("mousemove", (ev) => showTip(ev, `Perfect cadence in ${c.key}`, `bar ${c.measure}`));
    mark.addEventListener("mouseleave", hideTip);
    mark.addEventListener("click", (ev) => { ev.stopPropagation(); seek(c.start); });
    axis.append(mark);
  }
  tl.append(axis);

  const overlay = el("div", "tl-overlay");
  const head = el("div", "playhead");
  head.id = "playhead";
  overlay.append(head);
  tl.append(overlay);

  // Legend: only the roles that occur.
  const legend = $("legend");
  legend.replaceChildren();
  const names = { subject: "Subject", answer: "Answer" };
  for (const s of piece.later_subjects || []) names[`s${s.number}`] = `Subject ${s.number}`;
  for (const cs of piece.countersubjects) names[`cs${cs.number}`] = `Countersubject ${cs.number}`;
  for (const [cls, name] of Object.entries(names)) {
    if (!marks.some((m) => m.cls === cls)) continue;
    const item = el("span");
    item.append(el("i", cls), name);
    legend.append(item);
  }
  if (piece.fragments.length) {
    const item = el("span");
    item.append(el("i", "frag-key"), "Outline: a fragment of that theme");
    legend.append(item);
  }
  if (piece.spans.some((s) => s.kind === "pedal")) {
    const item = el("span");
    item.append(el("i", "pedal-key"), "Pedal point");
    legend.append(item);
  }
  if ((piece.cadences || []).length) {
    const item = el("span");
    item.append(el("i", "cadence-key"), "Perfect cadence");
    legend.append(item);
  }
  if (piece.entries.some((e) => (e.altered || []).length)) {
    const item = el("span");
    item.append(el("i", "ring-key"), "Ring: where a tonal answer is adjusted");
    legend.append(item);
  }
  if (tl.querySelector(".tl-track.keys")) {
    // The key path can be put away: it takes room that a small screen may want for the score.
    let shown = true;
    try { shown = localStorage.getItem("fugae-keys") !== "off"; } catch { /* no storage: shown */ }
    const toggle = el("button", "voice-toggle", "Keys");
    toggle.type = "button";
    toggle.title = "Show or hide the key path: each statement on the line of its key. The home key and "
      + "its five nearest neighbours always have the same six lines, the sharper pair above and the flatter below";
    const set = (on) => {
      toggle.setAttribute("aria-pressed", String(on));
      tl.classList.toggle("no-keys", !on);
    };
    toggle.addEventListener("click", () => {
      shown = !shown;
      set(shown);
      try { localStorage.setItem("fugae-keys", shown ? "on" : "off"); } catch { /* not remembered */ }
    });
    set(shown);
    legend.append(toggle);
  }
  refitTimeline();
}

// ------------------------------------------------------------------ keys

const KEY_ROW = 12;   // height of one key's line in the key path, in pixels
const KEY_GAP = 6;    // between the six near keys and any farther ones

// A key from its name: its signature in sharps (flats negative), its tonic and its mode.
function keyOf(name) {
  const m = /^([A-G])([♯♭]*) (major|minor)$/.exec(name || "");
  if (!m) return null;
  const alter = m[2].split("♯").length - m[2].split("♭").length;
  const place = "FCGDAEB".indexOf(m[1]) - 1 + 7 * alter;        // on the line of fifths, C = 0
  const minor = m[3] === "minor";
  return { name, minor, sharps: place - (minor ? 3 : 0), tonic: (((place * 7) % 12) + 12) % 12 };
}

// What a key is to the home key, in the words a harmony book would use.
function relationTo(home, key) {
  if (key.name === home.name) return "the home key";
  const up = (key.tonic - home.tonic + 12) % 12;
  const kind = key.minor ? "minor" : "major";
  if (up === 0) return `the tonic ${kind}`;
  if (up === 7) return key.minor === home.minor ? "the dominant" : `the dominant ${kind}`;
  if (up === 5) return key.minor === home.minor ? "the subdominant" : `the subdominant ${kind}`;
  if (!home.minor && key.minor) {
    if (up === 9) return "the relative minor";
    if (up === 2) return "the supertonic minor (relative minor of the subdominant)";
    if (up === 4) return "the mediant minor (relative minor of the dominant)";
  }
  if (home.minor && !key.minor) {
    if (up === 3) return "the relative major";
    if (up === 10) return "the relative major of the dominant";
    if (up === 8) return "the relative major of the subdominant";
  }
  const steps = Math.abs(key.sharps - home.sharps);
  return `a distant key (${steps} ${key.sharps > home.sharps ? "sharps sharper" : "flats flatter"})`;
}

// The key at a signature (sharps, flats negative), major or minor.
function keyAt(sharps, minor) {
  const place = sharps + (minor ? 3 : 0);                       // its tonic on the line of fifths
  const alter = Math.floor((place + 1) / 7);
  const letter = "FCGDAEB"[(((place + 1) % 7) + 7) % 7];
  return keyOf(`${letter}${(alter > 0 ? "♯" : "♭").repeat(Math.abs(alter))} ${minor ? "minor" : "major"}`);
}

// The key path. Six lines are always there and always in the same places: the home
// key's signature in the middle, one sharper above it and one flatter below, each as
// a major key over its relative minor. Those six are the home key and its five
// nearest neighbours, so the same plan draws the same shape in every fugue. A key
// farther off gets a line of its own beyond a small gap. Each statement is drawn on
// the line of its key. Only the statements have keys; the dotted lines between them
// show the order, not the route.
function buildKeyPath(tl) {
  const home = keyOf(piece.key);
  const stated = piece.entries
    .filter((e) => (e.theme || 1) === 1 && !e.partial && keyOf(e.key))
    .sort((a, b) => a.start - b.start || a.voice - b.voice);
  if (!home || new Set(stated.map((e) => e.key)).size < 2) return;
  const id = (k) => `${k.sharps}:${k.minor}`;
  const used = new Map(stated.map((e) => keyOf(e.key)).map((k) => [id(k), k]));
  const near = [1, 0, -1].flatMap((d) => [keyAt(home.sharps + d, false), keyAt(home.sharps + d, true)]);
  const far = [...used.values()].filter((k) => Math.abs(k.sharps - home.sharps) > 1)
    .sort((a, b) => b.sharps - a.sharps || a.minor - b.minor);
  const groups = [far.filter((k) => k.sharps > home.sharps), near, far.filter((k) => k.sharps < home.sharps)]
    .filter((g) => g.length);
  const keys = [], top = new Map();
  let height = 0;
  groups.forEach((group, g) => {
    if (g) height += KEY_GAP;
    for (const k of group) {
      top.set(id(k), height);
      keys.push(k);
      height += KEY_ROW;
    }
  });
  const middle = (name) => top.get(id(keyOf(name))) + KEY_ROW / 2;

  const labels = el("div", "tl-label keys-labels");
  labels.style.height = `${height}px`;
  for (const k of keys) {
    const text = el("span", k.name === home.name ? "home" : used.has(id(k)) ? null : "unused",
      k.name.replace("major", "maj").replace("minor", "min"));
    text.style.top = `${top.get(id(k))}px`;
    text.title = `${k.name}: ${relationTo(home, k)}${used.has(id(k)) ? "" : " (the subject is not stated in it)"}`;
    labels.append(text);
  }

  const track = el("div", "tl-track keys");
  track.style.height = `${height}px`;
  const ruled = el("div", "key-home");
  ruled.style.top = `${middle(home.name)}px`;
  track.append(ruled);

  const lines = svgEl("svg", { class: "key-lines", viewBox: `0 0 ${piece.end} ${height}`, preserveAspectRatio: "none" });
  stated.forEach((e, i) => {
    const before = stated[i - 1];
    if (before && e.start >= before.end - 1e-6) {
      lines.append(svgEl("line", { x1: before.end, y1: middle(before.key), x2: e.start, y2: middle(e.key) }));
    }
  });
  track.append(lines);

  for (const e of stated) {
    const mark = place(el("div", `key-mark ${e.role === "answer" ? "answer" : "subject"}`), e.start, e.end);
    mark.style.top = `${top.get(id(keyOf(e.key))) + 2}px`;
    const what = `${e.role === "answer" ? "Answer" : "Subject"} in ${e.key}`;
    const where = `${relationTo(home, keyOf(e.key))} · ${piece.voices[e.voice]}, bar ${barOf(e.start)}`;
    mark.addEventListener("mousemove", (ev) => showTip(ev, what, where));
    mark.addEventListener("mouseleave", hideTip);
    track.append(mark);
  }
  trackSeek(track);
  tl.append(labels, track);
}

function buildTables() {
  const row = (cells, q, tag = "td") => {
    const tr = el("tr");
    cells.forEach((c) => tr.append(el(tag, null, c)));
    if (q != null) tr.addEventListener("click", () => seek(q));
    return tr;
  };
  const fill = (table, caption, head, rows) => {
    table.replaceChildren(el("caption", null, caption));
    const thead = el("thead"), tbody = el("tbody");
    thead.append(row(head, null, "th"));
    rows.forEach((r) => tbody.append(r));
    table.append(thead, tbody);
  };
  const pieces = [
    ...piece.entries.map((e) => ({
      q: e.start, voice: e.voice,
      what: ((e.theme || 1) > 1 ? `Subject ${e.theme}` : e.role === "answer" ? `Answer${e.tonal ? " (tonal)" : ""}` : "Subject")
        + (e.key ? ` in ${e.key}` : ""),
    })),
    ...piece.countersubjects.flatMap((cs) => cs.occurrences.map((o) => ({
      q: o.start, voice: o.voice,
      what: `Countersubject ${cs.number}` + (o.shared ? " (shared)" : o.score < 1 ? ` (${Math.round(o.score * 100)}%)` : ""),
    }))),
  ].sort((a, b) => a.q - b.q || a.voice - b.voice);
  fill($("entries-table"), "Thematic statements", ["Bar", "Voice", "Statement"],
    pieces.map((p) => row([String(barOf(p.q)), piece.voices[p.voice], p.what], p.q)));
  fill($("sections-table"), "Sections", ["Bars", "Section", "Made of"],
    passages().map((s) => row([passageBars(s).replace(/^bars? /, ""), s.label,
      [s.leads ? `${s.leads}.` : "", s.summary || ""].filter(Boolean).join(" ")], s.start)));
  const cadences = piece.cadences || [];
  $("cadences-table").hidden = !cadences.length;
  fill($("cadences-table"), "Perfect cadences", ["Bar", "Key", "Where"],
    cadences.map((c) => row([String(c.measure), c.key, sectionAt(Math.max(0, c.start - 0.01)).label.split(":")[0]], c.start)));
}

// ----------------------------------------------------------------- score

// How much of the top of the screen stays covered while the page scrolls: the whole
// deck on a wide screen, only the playing controls on a phone (see the style sheet).
function stuckHeight() {
  return panelHeight() || $("deck").offsetHeight || $("controls").offsetHeight;
}

// The narrowest the score is engraved. A narrower screen shows that engraving
// scaled down: about one bar to the line on a phone held upright.
const NARROWEST = 440;

function renderScore(load) {
  const host = $("score");
  const keyboard = layoutMode === "keyboard";
  const width = Math.max(NARROWEST, host.clientWidth);
  const scale = SIZES[scoreSize];
  toolkit.setOptions({
    scale,
    pageWidth: Math.round((width * 100) / scale),
    pageHeight: 60000,
    adjustPageHeight: true,
    breaks: "auto",
    header: "none",
    footer: "none",
    svgViewBox: true,
    pageMarginTop: 120,
    pageMarginBottom: 60,
    pageMarginLeft: 60,
    pageMarginRight: 60,
    // The open score needs room over every staff for the names of the themes; the
    // keyboard layout has only the section names over each system.
    spacingStaff: keyboard ? 12 : 20,
    spacingSystem: keyboard ? 16 : 30,
  });
  if (load) toolkit.loadData(keyboard ? piece.keyboardXml : piece.xml);
  else toolkit.redoLayout();

  let svg = "";
  for (let p = 1; p <= toolkit.getPageCount(); p++) svg += toolkit.renderToSVG(p);
  host.innerHTML = svg;
  host.classList.toggle("keyboard", keyboard);
  host.classList.toggle("colour-voice", keyboard && colourMode === "voice");
  host.classList.toggle("colour-theme", keyboard && colourMode === "theme");
  $("timeline").classList.toggle("voice-colours", keyboard && colourMode === "voice");

  toolkit.renderToMIDI();
  indexNotes(toolkit.renderToTimemap());
  if (scoreNotes.length) {
    // Length of one CSS pixel in the score's own units.
    const unit = 1 / scoreNotes[0].el.getScreenCTM().a;
    if (keyboard) {
      tagKeyboardNotes();      // the boxes and brackets assume a staff for each voice
    } else {
      drawMarks(unit);
      drawSequences(unit);
    }
    drawAltered(unit);
    drawSectionTags(unit);
    drawCadences(unit);
  }
  currentSystem = null;
  paint(position());
}

function indexNotes(timemap) {
  const times = new Map();
  for (const ev of timemap) {
    for (const id of ev.on || []) times.set(id, { on: ev.qstamp, off: ev.qstamp });
    for (const id of ev.off || []) { const t = times.get(id); if (t) t.off = ev.qstamp; }
  }
  scoreNotes = [];
  for (const [id, t] of times) {
    const node = document.getElementById(id);
    if (!node || !node.classList.contains("note")) continue;
    const staff = node.closest("g.staff");
    const measure = staff && staff.parentNode;
    if (!measure) continue;
    const staves = Array.from(measure.children).filter((c) => c.classList.contains("staff"));
    scoreNotes.push({ id, el: node, on: t.on, off: t.off, staff: staves.indexOf(staff), staffEl: staff, system: node.closest("g.system") });
    node.addEventListener("click", () => seek(t.on));
  }
  scoreNotes.sort((a, b) => a.on - b.on);
}

// In the keyboard layout two or three voices share a staff, so each note is given
// its voice (and its theme, if it belongs to a statement) as classes, and the
// stylesheet colours it. The voice is written into the score itself: every note
// and printed rest has an id that begins with it ("v1n204", "v0r17").
function tagKeyboardNotes() {
  const voiceOf = (node) => { const m = /^v(\d+)[nr]/.exec(node.id || ""); return m ? Number(m[1]) : null; };
  const themes = marks.filter((m) => !m.frag);
  const started = new Map(scoreNotes.map((n) => [n.el, n]));
  for (const node of document.querySelectorAll("#score g.note, #score g.rest")) {
    const voice = voiceOf(node);
    if (voice == null) continue;
    node.classList.add("voiced", `v${voice}`);
    const note = started.get(node);
    if (!note) continue;
    note.voice = voice;
    const mark = themes.find((m) => m.voice === voice && note.on >= m.start - 1e-6 && note.on < m.end - 1e-6);
    if (mark) { node.classList.add("themed", mark.cls); note.theme = mark.cls; }
  }
  // A beam takes the colour of its notes when they agree.
  for (const beam of document.querySelectorAll("#score g.beam")) {
    const inside = [...beam.querySelectorAll("g.note")];
    const voices = new Set(inside.map(voiceOf));
    const roles = new Set(inside.map((x) => (started.get(x) || {}).theme || null));
    if (voices.size === 1 && !voices.has(null)) beam.classList.add("voiced", `v${[...voices][0]}`);
    if (roles.size === 1 && !roles.has(null)) beam.classList.add("themed", [...roles][0]);
  }
  // Where two voices have the same note on the same staff, one head is printed for
  // both and only one colour shows. The voice underneath gets a ring in its own colour.
  for (const staff of document.querySelectorAll("#score g.staff")) {
    const heads = [...staff.querySelectorAll("g.note")].map((node) => {
      const box = (node.querySelector("g.notehead") || node).getBBox();
      return { node, box, voice: voiceOf(node) };
    }).filter((h) => h.box.width && h.voice != null);
    for (let i = 0; i < heads.length; i++) {
      for (let j = i + 1; j < heads.length; j++) {
        const a = heads[i], b = heads[j];
        if (a.voice === b.voice) continue;
        const across = Math.min(a.box.x + a.box.width, b.box.x + b.box.width) - Math.max(a.box.x, b.box.x);
        const down = Math.min(a.box.y + a.box.height, b.box.y + b.box.height) - Math.max(a.box.y, b.box.y);
        if (across <= 0 || down <= 0 || (across * down) / (a.box.width * a.box.height) < 0.9) continue;
        // The later of the two in the page is drawn on top; the ring is for the other.
        const under = a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? a : b;
        const ring = svgEl("ellipse", {
          class: `shared voiced v${under.voice}`,
          cx: under.box.x + under.box.width / 2, cy: under.box.y + under.box.height / 2,
          rx: under.box.width * 0.78, ry: under.box.height * 0.85,
        });
        // Set on the element itself: the engraver's own stylesheet styles every shape by id.
        ring.style.cssText = `fill: none; stroke: var(--voice); stroke-width: ${(under.box.height * 0.22).toFixed(1)}px`;
        staff.append(ring);
      }
    }
  }
  // A disc behind each note head, shown while the note sounds: among coloured notes a
  // change of colour is easy to miss, and a mark behind the head is not.
  for (const n of scoreNotes) {
    const head = n.el.querySelector("g.notehead") || n.el;
    const box = head.getBBox();
    if (!box.width || !n.system) continue;
    const halo = svgEl("circle", {
      class: `halo${n.voice != null ? ` v${n.voice}` : ""}${n.theme ? ` themed ${n.theme}` : ""}`,
      cx: box.x + box.width / 2, cy: box.y + box.height / 2, r: box.width * 1.15,
    });
    n.system.insertBefore(halo, n.system.firstChild);
    n.halo = halo;
  }
}

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

// The notes of one voice between two times, grouped by the system they are printed in,
// each group with the box that encloses its notes and its staff.
function voiceBoxes(voice, start, end) {
  const groups = new Map();
  for (const n of scoreNotes) {
    if (n.staff !== voice || n.on < start - 1e-6 || n.on >= end - 1e-6) continue;
    if (!groups.has(n.system)) groups.set(n.system, []);
    groups.get(n.system).push(n);
  }
  return Array.from(groups, ([system, notes]) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const n of notes) {
      const b = n.el.getBBox();
      x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x + b.width);
      y0 = Math.min(y0, b.y); y1 = Math.max(y1, b.y + b.height);
    }
    // Cover the full height of the staff as well as any notes outside it.
    for (const staff of new Set(notes.map((n) => n.staffEl))) {
      for (const line of staff.querySelectorAll(":scope > path")) {
        const b = line.getBBox();
        y0 = Math.min(y0, b.y); y1 = Math.max(y1, b.y + b.height);
      }
    }
    return { system, notes, x0, x1, y0, y1 };
  });
}

function drawMarks(unit) {
  const padX = 5 * unit, padY = 3 * unit;

  for (const mark of marks) {
    const kind = mark.frag ? `frag ${mark.cls}` : mark.cls;
    let first = true;
    for (const { system, x0, x1, y0, y1 } of voiceBoxes(mark.voice, mark.start, mark.end)) {
      const rect = svgEl("rect", {
        class: `mark-rect ${kind}`, x: x0 - padX, y: y0 - padY,
        width: x1 - x0 + 2 * padX, height: y1 - y0 + 2 * padY, rx: 4 * unit,
      });
      wireMark(rect, mark);
      system.insertBefore(rect, system.firstChild);

      if (first) {
        first = false;
        const size = (mark.frag ? 9 : 10.5) * unit, chipH = (mark.frag ? 12 : 15) * unit;
        const group = svgEl("g", {});
        const bg = svgEl("rect", { class: `mark-chip-bg ${kind}`, x: x0 - padX, y: y0 - padY - chipH - unit, height: chipH, rx: 3 * unit, width: 10 });
        const text = svgEl("text", { class: `mark-chip-text ${kind}`, x: x0 - padX + 4 * unit, y: y0 - padY - unit - (mark.frag ? 3.2 : 4.2) * unit, "font-size": size });
        text.textContent = mark.chip;
        group.append(bg, text);
        system.append(group);
        const width = text.getComputedTextLength() + 8 * unit;
        bg.setAttribute("width", width);
        // Keep the name on the page when the theme begins at the right-hand edge.
        // (The systems are drawn inside a group moved right by the page's left margin.)
        const page = system.closest("svg").viewBox.baseVal;
        const margin = system.closest(".page-margin")?.transform.baseVal.consolidate()?.matrix.e || 0;
        const over = x0 - padX + width - (page.x + page.width - margin - 3 * unit);
        if (page.width && over > 0) {
          bg.setAttribute("x", x0 - padX - over);
          text.setAttribute("x", x0 - padX + 4 * unit - over);
        }
        wireMark(bg, mark);
      }
    }
  }
}

// A bracket under each sequence, with a tick where every statement begins.
function drawSequences(unit) {
  for (const s of piece.sequences) {
    let first = true;
    for (const { system, notes, x0, x1, y1 } of voiceBoxes(s.voice, s.start, s.end)) {
      const y = y1 + 8 * unit, tick = -4 * unit;
      let d = `M${x0} ${y + tick} V${y} H${x1} V${y + tick}`;
      for (let k = 1; k < s.count; k++) {
        const note = notes.find((n) => Math.abs(n.on - (s.start + k * s.period)) < 1e-6);
        if (note) d += ` M${note.el.getBBox().x} ${y} v${tick}`;
      }
      system.append(svgEl("path", { class: "seq-line", d }));
      if (first) {
        first = false;
        const text = svgEl("text", { class: "seq-text", x: x0, y: y + 10 * unit, "font-size": 9.5 * unit });
        text.textContent = s.text.replace(/^a /, "");
        text.addEventListener("mousemove", (ev) => showTip(ev, `Sequence in the ${piece.voices[s.voice].toLowerCase()}`,
          `${barRange(s.start, s.end)} · the same pattern ${s.count} times, ${s.text.replace(/^a sequence /, "")}`));
        text.addEventListener("mouseleave", hideTip);
        // Keep the caption on the page when the sequence starts near the right edge.
        const frame = system.getBBox();
        system.append(text);
        const length = text.getComputedTextLength();
        if (x0 + length > frame.x + frame.width) text.setAttribute("x", Math.max(frame.x, frame.x + frame.width - length));
      }
    }
  }
}

function tagText(s) {
  if (s.kind === "entries") {
    if (/^Together/.test(s.label)) return "Entries together";
    return /^(Stretto|Combination)/.test(s.label) ? s.label.split(":")[0] : "Entry";
  }
  if (s.kind === "codetta") return "Codetta";
  return s.label.split(":")[0];
}

// What a flag may say, longest first. In the open score every entry carries its own
// name, so the flag only says "Entry". The keyboard layout has no such names, and there
// the flag says which theme enters, in what key and in which voice, where there is room.
function tagWordings(s) {
  const short = tagText(s);
  if (layoutMode !== "keyboard" || !["entries", "final"].includes(s.kind)) return [short];
  const inside = marks.filter((m) => m.entry && m.start >= s.start - 1e-6 && m.start < s.end - 1e-6);
  if (!inside.length) return [short];
  const voice = (m) => piece.voices[m.voice].toLowerCase();
  if (inside.length === 1 && s.kind === "entries") {
    const m = inside[0];
    return [`${m.chip} · ${voice(m)}`, `${m.chip.split(" · ")[0]} · ${voice(m)}`, short];
  }
  const head = short === "Entry" ? "Entries" : short;
  const who = inside.length > 4 ? `${inside.length} entries` : inside.map(voice).join(", ");
  return [`${head} · ${who}`, head];
}

// A label above the system wherever a section begins: the longest wording that fits
// before the next flag (or the edge of the page).
function drawSectionTags(unit) {
  const frames = new Map();
  for (const system of document.querySelectorAll("#score g.system")) frames.set(system, system.getBBox());
  const tags = [];
  for (const s of passages()) {
    const firstNote = scoreNotes.find((n) => n.on >= s.start - 1e-6);
    if (!firstNote) continue;
    const x = Math.min(...scoreNotes.filter((n) => n.on === firstNote.on).map((n) => n.el.getBBox().x)) - 5 * unit;
    tags.push({ s, system: firstNote.system, x });
  }
  tags.forEach(({ s, system, x }, i) => {
    const frame = frames.get(system);
    const next = tags[i + 1] && tags[i + 1].system === system ? tags[i + 1] : null;
    const page = system.closest("svg").viewBox.baseVal;
    const margin = system.closest(".page-margin")?.transform.baseVal.consolidate()?.matrix.e || 0;
    const edge = page.width ? page.x + page.width - margin - 3 * unit : Infinity;
    const room = (next ? next.x - 4 * unit : edge) - x;
    const tagH = 16 * unit, y = frame.y - tagH - 4 * unit;
    const group = svgEl("g", { class: "section-tag" });
    const line = svgEl("path", { class: "section-line", d: `M${x} ${y + tagH} V${frame.y + frame.height}` });
    const bg = svgEl("rect", { class: "section-tag-bg", x, y, height: tagH, rx: 3 * unit, width: 10 });
    const text = svgEl("text", { class: "section-tag-text", x: x + 6 * unit, y: y + 11.5 * unit, "font-size": 10.5 * unit });
    group.append(line, bg, text);
    system.append(group);
    let width = 0;
    for (const wording of tagWordings(s)) {
      text.textContent = wording;
      width = text.getComputedTextLength() + 12 * unit;
      if (width <= room) break;
    }
    bg.setAttribute("width", width);
    if (!next && x + width > edge) {     // the last flag of a line: keep it on the page
      const left = Math.max(frame.x, edge - width);
      bg.setAttribute("x", left);
      text.setAttribute("x", left + 6 * unit);
    }
    bg.addEventListener("mousemove", (ev) => showTip(ev, s.label, passageDetail(s)));
    bg.addEventListener("mouseleave", hideTip);
    bg.addEventListener("click", () => seek(s.start));
  });
}

// Under the system, where a perfect cadence arrives: the key it closes in.
function drawCadences(unit) {
  const frames = new Map();
  for (const system of document.querySelectorAll("#score g.system")) frames.set(system, system.getBBox());
  const reached = new Map();      // per system, how far right its last label runs
  for (const c of piece.cadences || []) {
    const note = scoreNotes.find((n) => n.on >= c.start - 1e-6);
    if (!note || !note.system || Math.abs(note.on - c.start) > 1e-6) continue;
    const system = note.system, frame = frames.get(system);
    const page = system.closest("svg").viewBox.baseVal;
    const margin = system.closest(".page-margin")?.transform.baseVal.consolidate()?.matrix.e || 0;
    const edge = page.width ? page.x + page.width - margin - 3 * unit : Infinity;
    let x = Math.min(...scoreNotes.filter((n) => n.on === note.on).map((n) => n.el.getBBox().x));
    const text = svgEl("text", { class: "cadence-text", x, y: frame.y + frame.height + 13 * unit, "font-size": 10 * unit });
    system.append(text);
    const free = reached.get(system) ?? -Infinity;
    for (const wording of [`◆ cadence in ${c.key}`, `◆ ${c.key}`]) {
      text.textContent = wording;
      if (x >= free + 6 * unit || wording.length < 12) break;
    }
    const width = text.getComputedTextLength();
    if (x + width > edge) { x = Math.max(frame.x, edge - width); text.setAttribute("x", x); }
    reached.set(system, x + width);
    text.addEventListener("mousemove", (ev) => showTip(ev, `Perfect cadence in ${c.key}`,
      `bar ${c.measure} · the lowest voice steps from the fifth of the key to the keynote, and the top voice arrives on it`));
    text.addEventListener("mouseleave", hideTip);
    text.addEventListener("click", () => seek(c.start));
  }
}

// A ring round each note where a tonal answer is adjusted: the few notes a step off
// the rest of it, which is what makes the answer tonal and not real.
function drawAltered(unit) {
  for (const e of piece.entries) {
    const step = e.altered_by < 0 ? "lower" : "higher";
    const why = e.answer_at === "fourth"
      ? `A step ${step} than the rest of the answer. Most of this answer is a fourth above the subject, which `
        + "brings it back to the home key after a subject that leaves it; this note is a fifth above, as in an exact answer."
      : e.answer_at === "fifth"
        ? `A step ${step} than the rest of the answer, which is a fifth above the subject as an exact answer would be. `
          + "Adjustments like this keep the answer near the home key."
        : `A step ${step} than the rest of this statement: the adjustment the answer makes in the exposition, in another key.`;
    for (const t of e.altered || []) {
      const n = scoreNotes.find((x) => Math.abs(x.on - t) < 1e-6
        && (layoutMode === "keyboard" ? x.voice === e.voice : x.staff === e.voice));
      if (!n || !n.system) continue;
      const box = (n.el.querySelector("g.notehead") || n.el).getBBox();
      if (!box.width) continue;
      const ring = svgEl("circle", { class: "altered", cx: box.x + box.width / 2, cy: box.y + box.height / 2, r: box.width * 1.05 });
      // Set on the element itself: the engraver's own stylesheet styles every shape by id.
      ring.style.cssText = `fill: none; stroke: var(--paper-ink); stroke-width: ${(1.5 * unit).toFixed(1)}px; pointer-events: all; cursor: pointer`;
      ring.addEventListener("mousemove", (ev) => showTip(ev, "Where the answer is adjusted", why));
      ring.addEventListener("mouseleave", hideTip);
      ring.addEventListener("click", () => seek(t));
      n.system.append(ring);
    }
  }
}

// ----------------------------------------------------------------- audio

let ctx, master;
const voiceGains = [];
const voiceOn = [];
const banks = {};       // instrument name -> Map(midi -> AudioBuffer)
let instrument = "piano";
let bpm = 72;
let playing = false;
let pausedAt = 0;       // quarter notes
let q0 = 0, t0 = 0;     // playback anchor: position q0 at audio time t0
let pointer = 0;        // next note to schedule
let live = [];          // scheduled sources
let timer = null;

const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function ensureContext() {
  if (ctx) return;
  ctx = new AudioContext();
  const squash = ctx.createDynamicsCompressor();
  master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(squash).connect(ctx.destination);
  piece.voices.forEach((_, v) => {
    const g = ctx.createGain();
    g.gain.value = voiceOn[v] === false ? 0 : 1;
    g.connect(master);
    voiceGains[v] = g;
  });
}

async function loadInstrument(name) {
  if (banks[name]) return banks[name];
  const text = await (await fetch(INSTRUMENTS[name].file)).text();
  const wanted = new Set(piece.notes.flatMap((n) => [...n.midi, ...(n.aux || [])]));
  const bank = new Map();
  const jobs = [];
  for (const m of text.matchAll(/"([A-G])(b?)(\d)":\s*"data:audio\/mp3;base64,([^"]+)"/g)) {
    const midi = NOTE_PC[m[1]] - (m[2] ? 1 : 0) + 12 * (Number(m[3]) + 1);
    if (!wanted.has(midi)) continue;
    const bytes = Uint8Array.from(atob(m[4]), (c) => c.charCodeAt(0));
    jobs.push(ctx.decodeAudioData(bytes.buffer).then((buf) => bank.set(midi, buf)));
  }
  await Promise.all(jobs);
  banks[name] = bank;
  return bank;
}

function position() {
  if (!playing) return pausedAt;
  return q0 + (Math.max(0, ctx.currentTime - t0) * bpm) / 60;
}

function firstNoteFrom(q) {
  let lo = 0, hi = piece.notes.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (piece.notes[mid].on < q - 1e-6) lo = mid + 1; else hi = mid; }
  return lo;
}

// A note is struck once, or as its ornament has it (ornaments.js).
function scheduleNote(n, start) {
  const inst = INSTRUMENTS[instrument], bank = banks[instrument];
  for (const { midi, at, sounds } of strokes(n, (n.dur * 60) / bpm, inst.hold)) {
    const buffer = bank.get(midi);
    if (!buffer) continue;
    const when = start + at, off = when + sounds;
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buffer;
    gain.gain.setValueAtTime(inst.gain, when);
    gain.gain.setValueAtTime(inst.gain, off);
    gain.gain.setTargetAtTime(0, off, inst.release / 3);
    src.connect(gain).connect(voiceGains[n.v]);
    src.start(when);
    src.stop(off + inst.release * 3);
    live.push({ src, gain, when, end: off + inst.release * 3 });
  }
}

function silence(onlyFuture) {
  const now = ctx.currentTime;
  live = live.filter((x) => {
    if (onlyFuture && x.when <= now) return true;
    x.gain.gain.cancelScheduledValues(now);
    x.gain.gain.setTargetAtTime(0, now, 0.012);
    try { x.src.stop(now + 0.08); } catch { /* already stopped */ }
    return false;
  });
}

function pump() {
  if (!playing) return;
  const now = ctx.currentTime, q = position();
  const horizon = q + (0.35 * bpm) / 60;
  const stop = loop ? loop.end - 1e-6 : Infinity;      // a repeated section's notes only
  while (pointer < piece.notes.length && piece.notes[pointer].on < Math.min(horizon, stop)) {
    const n = piece.notes[pointer++];
    const when = t0 + ((n.on - q0) * 60) / bpm;
    if (when > now - 0.03) scheduleNote(n, Math.max(when, now));
  }
  live = live.filter((x) => x.end > now);
  if (loop && q >= loop.end) { seek(loop.start); return; }
  if (q >= piece.end + 0.5) { pause(); pausedAt = 0; paint(0); }
}

// Repeating a section: while `loop` holds a section, playing goes round it. Moving
// somewhere else (a click in the score or the timeline, an arrow key) moves the
// repeat to the section landed in.
let loop = null;

function setLoopQuietly(section) {
  loop = section;
  $("loop").setAttribute("aria-pressed", String(Boolean(loop)));
  for (const block of document.querySelectorAll(".block.section")) {
    block.classList.toggle("looped", Boolean(loop) && Number(block.dataset.start) === loop.start);
  }
}

function setLoop(section) {
  setLoopQuietly(section);
  paint(position());
}

// To the next or the previous place where a section (or, with `byEntry`, a statement
// of a theme) begins. Going back while playing first returns to the start of the
// present one, as a music player does.
function step(direction, byEntry) {
  const starts = [...new Set((byEntry ? piece.entries : passages()).map((x) => x.start))].sort((a, b) => a - b);
  const q = position();
  const to = direction > 0
    ? starts.find((t) => t > q + 1e-6)
    : starts.filter((t) => t < q - (playing ? 1 : 1e-6)).at(-1) ?? 0;
  if (to != null) seek(to);
}

// An iPhone's ring/silent switch also silences this page, whose sound the phone
// takes for the kind that should obey it, like a keyboard click. Telling the phone
// the page is playing music gets round the switch. Older systems cannot be told;
// they take the hint from an <audio> element that plays nothing, alongside.
let hush = null;

function silentWav() {
  const rate = 8000, samples = rate / 4;
  const wav = new DataView(new ArrayBuffer(44 + samples));
  const text = (at, word) => [...word].forEach((c, i) => wav.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF"); wav.setUint32(4, 36 + samples, true); text(8, "WAVEfmt ");
  wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
  wav.setUint32(24, rate, true); wav.setUint32(28, rate, true);
  wav.setUint16(32, 1, true); wav.setUint16(34, 8, true);
  text(36, "data"); wav.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) wav.setUint8(44 + i, 128);   // in 8 bits, 128 is silence
  return URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
}

function soundDespiteSilentSwitch() {
  try {
    if (navigator.audioSession) { navigator.audioSession.type = "playback"; return; }
  } catch { /* try the older way */ }
  const apple = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!apple) return;
  try {
    if (!hush) {
      hush = new Audio(silentWav());
      hush.loop = true;
      hush.setAttribute("playsinline", "");
    }
    hush.play().catch(() => {});
  } catch { /* the page plays as before */ }
}

async function play() {
  soundDespiteSilentSwitch();   // before anything is awaited: it must happen in the tap itself
  ensureContext();
  await ctx.resume();
  if (!banks[instrument]) {
    setPlayLabel("Loading…");
    await loadInstrument(instrument);
  }
  if (pausedAt >= piece.end) pausedAt = 0;
  q0 = pausedAt;
  t0 = ctx.currentTime + 0.08;
  pointer = firstNoteFrom(q0);
  playing = true;
  setPlayLabel("Pause");
  timer = setInterval(pump, 25);
  pump();
  requestAnimationFrame(frame);
}

function pause() {
  if (!playing) return;
  pausedAt = Math.min(position(), piece.end);
  playing = false;
  clearInterval(timer);
  silence(false);
  hush?.pause();
  setPlayLabel("Play");
}

function seek(q) {
  if (loop && !(q >= loop.start - 1e-6 && q < loop.end - 1e-6)) setLoopQuietly(sectionAt(q));
  if (playing) {
    silence(false);
    q0 = q;
    t0 = ctx.currentTime + 0.05;
    pointer = firstNoteFrom(q);
  } else {
    pausedAt = q;
  }
  currentSystem = null;
  paint(q, true);
}

function setTempo(value) {
  if (playing) {
    const q = position();
    silence(true);
    q0 = q;
    t0 = ctx.currentTime;
    pointer = firstNoteFrom(q + 1e-4);
  }
  bpm = value;
  $("tempo-text").textContent = `♩ = ${value}`;
}

function setVoice(v, on) {
  voiceOn[v] = on;
  if (voiceGains[v]) voiceGains[v].gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.015);
}

async function setInstrument(name) {
  instrument = name;
  if (!ctx) return;
  const wasPlaying = playing;
  if (wasPlaying) pause();
  if (!banks[name]) { setPlayLabel("Loading…"); await loadInstrument(name); setPlayLabel("Play"); }
  if (wasPlaying) play();
}

function setPlayLabel(text) {
  $("play-text").textContent = text;
  $("play").setAttribute("aria-label", text);
  $("play-icon").setAttribute("d", text === "Pause" ? "M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" : "M4 2.5v11l9-5.5z");
}

// ------------------------------------------------------------- following

let lastSounding = new Set();

function paint(q, jump) {
  const head = $("playhead");
  if (head) head.style.left = pct(Math.min(q, piece.end));
  if (head && timelineScrolls && (playing || jump)) {
    const tl = $("timeline"), x = head.offsetLeft, room = tl.clientWidth - head.parentNode.offsetLeft;
    if (x < tl.scrollLeft || x > tl.scrollLeft + room - 24) tl.scrollLeft = Math.max(0, x - room / 3);
  }

  const sounding = new Set();
  let lead = null;
  if (playing || q > 0) {
    for (const n of scoreNotes) {
      if (n.on > q + 1e-6) break;
      if (q < n.off - 1e-6) { sounding.add(n); lead = lead || n; }
    }
  }
  for (const n of lastSounding) {
    if (sounding.has(n)) continue;
    n.el.classList.remove("sounding");
    if (n.halo) n.halo.classList.remove("on");
  }
  for (const n of sounding) {
    if (lastSounding.has(n)) continue;
    n.el.classList.add("sounding");
    if (n.halo) n.halo.classList.add("on");
  }
  lastSounding = sounding;

  // Keep the system being played in view, below the sticky deck.
  const system = lead ? lead.system : (jump && nearestNote(q)?.system) || null;
  if (system && system !== currentSystem && (playing || jump)) {
    currentSystem = system;
    const top = system.getBoundingClientRect().top + scrollY - stuckHeight() - 28;
    scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  const at = Math.min(q, piece.end - 0.01);
  const codetta = piece.spans.find((s) => s.kind === "codetta" && at >= s.start - 1e-6 && at < s.end - 1e-6);
  const section = codetta ? { ...codetta, label: "Exposition, codetta" } : sectionAt(at);
  const active = marks.filter((m) => !m.frag && q >= m.start - 1e-6 && q < m.end - 1e-6)
    .map((m) => `${m.short} in ${piece.voices[m.voice].toLowerCase()}`);
  const now = $("now");
  now.replaceChildren(el("b", null, `Bar ${barOf(at)}`),
    ` · ${section.label}${loop ? " (repeating)" : ""}` + (section.summary ? ` · ${section.summary}` : active.length ? ` · ${active.join(", ")}` : ""));
  now.title = section.summary || "";
}

function nearestNote(q) {
  return scoreNotes.find((n) => n.on >= q - 1e-6) || scoreNotes.at(-1);
}

function frame() {
  if (!playing) return;
  paint(position());
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ kind

// Text with any glossary term made into a button: hovering explains it,
// and a click or tap keeps the explanation open.
function glossed(text) {
  const terms = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})s?`, "gi");
  const meaning = Object.fromEntries(Object.entries(GLOSSARY).map(([k, v]) => [k.toLowerCase(), v]));
  const nodes = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const term = el("button", "term", m[0]);
    term.type = "button";
    term.dataset.meaning = meaning[m[1].toLowerCase()];
    term.setAttribute("aria-expanded", "false");
    term.addEventListener("mouseenter", () => explain(term));
    term.addEventListener("mouseleave", () => { if (pinned) explain(pinned); else tip.hidden = true; });
    term.addEventListener("click", () => {
      const open = pinned !== term;
      unpin();
      if (open) {
        pinned = term;
        term.setAttribute("aria-expanded", "true");
        explain(term);
      } else {
        tip.hidden = true;
      }
    });
    nodes.push(term);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function showKind() {
  const procedures = $("procedures"), character = $("character");
  if (piece.procedures && piece.procedures.length) {
    procedures.replaceChildren(el("b", null, "Means: "), ...glossed(piece.procedures.join(" · ")));
    procedures.hidden = false;
  }
  if (piece.character) {
    character.replaceChildren(el("b", null, "Character: "), ...glossed(piece.character.text),
      el("span", "source", ` (${piece.character.source.replace(/\s*\((\d+)\)/, ", $1")})`));
    character.hidden = false;
  }
}

// ------------------------------------------------------------------ boot

// The switch between the two layouts of the score, where the piece has both.
async function loadKeyboard() {
  if (piece.keyboardXml) return true;
  try {
    const reply = await fetch(`data/${PIECE}.keyboard.musicxml`);
    if (reply.ok) piece.keyboardXml = await reply.text();
  } catch { /* no keyboard score: stay with the open score */ }
  return Boolean(piece.keyboardXml);
}

// Draw the score in the chosen layout, falling back to the open score if the other cannot be had.
async function showLayout() {
  if (layoutMode === "keyboard" && !(await loadKeyboard())) {
    layoutMode = "open";
    document.querySelectorAll('input[name="layout"]').forEach((input) => { input.checked = input.value === "open"; });
  }
  $("colour-tools").hidden = layoutMode !== "keyboard";
  $("score-note").textContent = layoutMode === "keyboard"
    ? "Laid out on two staves by rule, not copied from an edition."
      + (touchScreen.matches ? "" : " Point at a voice's name to pick it out.")
    : "";
  if (toolkit) renderScore(true);
}

const recall = (key, allowed, otherwise) => {
  try { const v = localStorage.getItem(key); return allowed.includes(v) ? v : otherwise; } catch { return otherwise; }
};
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch { /* not remembered */ } };

function wireLayout() {
  scoreSize = recall("fugae-size", Object.keys(SIZES), "medium");
  document.querySelectorAll('input[name="size"]').forEach((input) => {
    input.checked = input.value === scoreSize;
    input.addEventListener("change", () => {
      if (!input.checked) return;
      scoreSize = input.value;
      remember("fugae-size", scoreSize);
      if (toolkit) renderScore(false);
    });
  });
  $("score-tools").hidden = false;
  if (!piece.hasKeyboard) {
    document.querySelector('[aria-label="Layout of the score"]').hidden = true;
    return;
  }
  layoutMode = recall("fugae-layout", ["open", "keyboard"], "open");
  colourMode = recall("fugae-colour", ["voice", "theme"], "voice");
  document.querySelectorAll('input[name="layout"]').forEach((input) => {
    input.checked = input.value === layoutMode;
    input.addEventListener("change", () => {
      if (!input.checked) return;
      layoutMode = input.value;
      remember("fugae-layout", layoutMode);
      showLayout();
    });
  });
  document.querySelectorAll('input[name="colour"]').forEach((input) => {
    input.checked = input.value === colourMode;
    input.addEventListener("change", () => {
      if (!input.checked) return;
      colourMode = input.value;
      remember("fugae-colour", colourMode);
      if (toolkit) renderScore(false);
    });
  });
}

// ----------------------------------------------------------------- panel

// On a wide screen the deck stays at the top while the score scrolls. Whole, it takes
// a good third of the screen, so once it is stuck it shrinks to its controls and a thin
// timeline (.compact in the style sheet). The button at the end of the controls keeps
// it whole instead, and that choice is remembered.
const wideScreen = matchMedia("(min-width: 561px) and (min-height: 521px)");
let panelWhole = false;       // the reader asked for the whole deck
let panelHeights = null;      // { whole, compact } in pixels, measured for the present width

function measurePanel() {
  const deck = $("deck"), was = deck.classList.contains("compact");
  deck.classList.remove("compact");
  const whole = deck.offsetHeight;
  deck.classList.add("compact");
  const compact = deck.offsetHeight;
  deck.classList.toggle("compact", was);
  panelHeights = { whole, compact };
}

// The height the deck has once the page has scrolled, or 0 on a phone (where only the
// controls stay, and stuckHeight measures those).
function panelHeight() {
  if (!wideScreen.matches || !panelHeights) return 0;
  return panelWhole ? panelHeights.whole : panelHeights.compact;
}

function updatePanel() {
  const deck = $("deck"), fold = $("fold"), masthead = document.querySelector(".masthead");
  const stuck = wideScreen.matches && scrollY > masthead.offsetTop + masthead.offsetHeight + 24;
  const compact = stuck && !panelWhole;
  fold.hidden = !stuck;
  if (compact === deck.classList.contains("compact")) return;
  deck.classList.toggle("compact", compact);
  // The space the deck gives up stays in the page as a margin, so nothing below it moves.
  deck.style.marginBottom = compact ? `${panelHeights.whole - panelHeights.compact}px` : "";
  refitTimeline();
}

function wirePanel() {
  panelWhole = recall("fugae-panel", ["whole", "compact"], "compact") === "whole";
  const label = () => {
    $("fold-text").textContent = panelWhole ? "Less" : "More";
    $("fold-icon").setAttribute("d", panelWhole ? "M3 10.5l5-5 5 5-1.1 1.1L8 7.7l-3.9 3.9z" : "M3 5.5l5 5 5-5-1.1-1.1L8 8.3 4.1 4.4z");
    $("fold").title = panelWhole
      ? "Shrink this panel while the score scrolls, to leave it more room"
      : "Keep the whole panel in view: instrument, tempo, voices, key path and legend";
    $("fold").setAttribute("aria-expanded", String(panelWhole));
  };
  $("fold").addEventListener("click", () => {
    panelWhole = !panelWhole;
    remember("fugae-panel", panelWhole ? "whole" : "compact");
    label();
    updatePanel();
  });
  label();
  measurePanel();
  updatePanel();
  addEventListener("scroll", updatePanel, { passive: true });
}

// After the window changes size: the deck's two heights are different, and so is the margin.
function resizePanel() {
  const deck = $("deck");
  deck.classList.remove("compact");
  deck.style.marginBottom = "";
  measurePanel();
  updatePanel();
}

function wireControls() {
  $("play").addEventListener("click", () => (playing ? pause() : play()));
  $("rewind").addEventListener("click", () => { seek(0); scrollTo({ top: 0, behavior: "smooth" }); });
  $("tempo").addEventListener("input", (ev) => setTempo(Number(ev.target.value)));
  document.querySelectorAll('input[name="instrument"]').forEach((input) =>
    input.addEventListener("change", () => input.checked && setInstrument(input.value)));
  $("loop").addEventListener("click", () => setLoop(loop ? null : sectionAt(Math.min(position(), piece.end - 0.01))));
  document.addEventListener("keydown", (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.target.closest?.("input, select, textarea")) return;
    if (ev.code === "Space") {
      if (ev.target.closest?.("button, summary")) return;
      ev.preventDefault();
      playing ? pause() : play();
    } else if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
      ev.preventDefault();
      step(ev.key === "ArrowRight" ? 1 : -1, ev.shiftKey);
    } else if (ev.key === "l" || ev.key === "L") {
      $("loop").click();
    }
  });
  let resizeTimer, lastWidth = $("score").clientWidth;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizePanel();
      refitTimeline();
      if ($("score").clientWidth === lastWidth) return;
      lastWidth = $("score").clientWidth;
      renderScore(false);
    }, 200);
  });
}

async function boot() {
  const [json, xml, index0] = await Promise.all([
    fetch(`data/${PIECE}.json`).then((r) => r.json()),
    fetch(`data/${PIECE}.musicxml`).then((r) => r.text()),
    fetch("data/index.json").then((r) => (r.ok ? r.json() : [])).catch(() => []),
  ]);
  const all = index0;
  // The fugue's own collection: the menu and the arrows stay inside it.
  const collection = collectionOf(json.collection || (all.find((p) => p.id === PIECE) || {}).collection);
  const index = all.filter((p) => collectionOf(p.collection) === collection)
    .sort((a, b) => (a.book || 0) - (b.book || 0) || (a.number || 0) - (b.number || 0));
  $("source-credit").innerHTML = collection.credit;      // our own text, with links
  if (index.length > 1) {
    // "I/2 C minor" for a fugue of the Well-Tempered Clavier, otherwise its name in its collection.
    const name = (p) => (p.book ? `${shortName(p)} ${p.key}` : shortName(p));
    const menu = $("piece");
    for (const p of index) {
      const option = el("option", null, name(p));
      option.value = p.id;
      option.selected = p.id === PIECE;
      menu.append(option);
    }
    menu.addEventListener("change", () => { location.search = `?piece=${menu.value}`; });
    const here = index.findIndex((p) => p.id === PIECE);
    for (const [id, other, arrow] of [["prev", index[here - 1], "‹ "], ["next", index[here + 1], " ›"]]) {
      if (here < 0 || !other) continue;
      const link = $(id);
      link.href = `?piece=${other.id}`;
      link.textContent = id === "prev" ? arrow + name(other) : name(other) + arrow;
      link.setAttribute("aria-label", `${id === "prev" ? "Previous" : "Next"}: ${other.title}`);
      link.hidden = false;
    }
    // Go back to the list as it was left, with the same tags chosen.
    let tags = "";
    try { tags = sessionStorage.getItem(tagsKey(collection)) || ""; } catch { /* private window */ }
    $("all").href = listHref(collection, tags);
    $("where").hidden = false;
  }
  piece = json;
  piece.xml = xml;
  piece.hasKeyboard = Boolean((index.find((p) => p.id === PIECE) || {}).keyboard);
  piece.keyboardXml = null;      // the two-staff score, fetched when first asked for
  piece.notes.sort((a, b) => a.on - b.on);
  marks = buildMarks();
  bpm = piece.tempo || 72;

  document.title = `${piece.title} · Fugae`;
  $("title").textContent = piece.title;

  // A compact title for the sticky bar: "II/2 · C minor · BWV 871". It appears
  // only when the full title above has scrolled out of view, and is the way back
  // up to it: a button that returns to the top of the page.
  const mini = $("mini");
  const parts = piece.title.match(/Book (\d+), Fugue (\d+) in (.+)$/);
  const short = parts ? `${["", "I", "II"][Number(parts[1])] || parts[1]}/${parts[2]} · ${parts[3]}`
    : piece.label || piece.title;
  const bwv = bwvOf(piece.id);
  $("caution").textContent = piece.caution ? `Not yet read well. ${piece.caution}` : "";
  $("caution").hidden = !piece.caution;
  const arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  arrow.setAttribute("viewBox", "0 0 16 16");
  arrow.setAttribute("aria-hidden", "true");
  arrow.innerHTML = '<path d="M8 3l5 5.2-1.1 1.1L8.8 6v7H7.2V6L4.1 9.3 3 8.2z"/>';
  mini.replaceChildren(arrow, el("b", null, short.replace("-sharp", "♯").replace("-flat", "♭")),
                       ...(bwv ? [el("span", null, ` · ${bwv}`)] : []));
  mini.title = `${piece.title}: back to the top of the page`;
  mini.setAttribute("aria-label", mini.title);
  mini.onclick = () => scrollTo({ top: 0, behavior: "smooth" });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => { mini.hidden = entry.isIntersecting; }).observe($("title"));
  } else {
    mini.hidden = false;
  }
  $("meta").textContent = `${piece.voices.length} voices · ${piece.key} · ${piece.meter} · ${piece.measures.length} bars`;
  showKind();
  $("tempo").value = bpm;
  $("tempo-text").textContent = `♩ = ${bpm}`;

  buildTimeline();
  buildTables();
  wireControls();
  wireLayout();
  wirePanel();
  paint(0);

  await verovioReady;
  toolkit = new verovio.toolkit();
  await showLayout();
  $("play").disabled = false;
}

document.addEventListener("DOMContentLoaded", () => {
  if (!PIECE) { location.replace("browse.html"); return; }
  boot().catch((err) => {
    console.error(err);
    $("score").replaceChildren(el("p", "status", `Could not load the piece: ${err.message}`));
  });
});
