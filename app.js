/* Fugae browser view: score, structure timeline and playback for one analysed fugue.
 *
 * Data comes from `python -m fugae build`, which writes data/<id>.musicxml and
 * data/<id>.json. All musical time below is in quarter notes from the start.
 */

const PIECE = new URLSearchParams(location.search).get("piece");   // none: go to the list of pieces
const SVG_NS = "http://www.w3.org/2000/svg";
const SCALE = 40; // Verovio rendering scale, per cent

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
    const tag = { inversion: " inv.", augmentation: " aug.", diminution: " dim." }[e.form] || "";
    const voice = piece.voices[e.voice];
    out.push({
      cls: later ? `s${e.theme}` : e.role,
      short: (later ? `S${e.theme}` : e.role === "answer" ? "A" : "S") + tag,
      voice: e.voice, start: e.start, end: e.end,
      title: `${role}${kind}${e.key ? ` in ${e.key}` : ""}${form}`,
      detail: `${voice}, ${barRange(e.start, e.end)}`
        + (e.late ? ` · the ${voice.toLowerCase()}'s first entry` : "")
        + (e.varied ? " · opening or rhythm varied" : "")
        + (e.partial ? " · breaks off as another voice takes over" : e.complete ? "" : " · incomplete"),
      chip: `${role}${e.tonal ? " (tonal)" : ""}${tag}${e.varied ? " (varied)" : ""}${e.key ? ` · ${e.key}` : ""}`,
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
  return passageBars(s) + (s.summary ? ` · ${s.summary}` : "");
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
document.addEventListener("pointerdown", (ev) => { if (!ev.target.closest(".term")) closeExplanation(); });
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeExplanation(); });
addEventListener("scroll", closeExplanation, { passive: true });
addEventListener("resize", closeExplanation);

function showTip(event, title, detail) {
  unpin();
  tip.replaceChildren(el("b", null, title), el("span", null, detail || ""));
  tip.hidden = false;
  const pad = 12, w = tip.offsetWidth, h = tip.offsetHeight;
  let x = event.clientX + pad, y = event.clientY + pad;
  if (x + w > innerWidth - 4) x = event.clientX - w - pad;
  if (y + h > innerHeight - 4) y = event.clientY - h - pad;
  tip.style.left = `${Math.max(4, x)}px`;
  tip.style.top = `${Math.max(4, y)}px`;
}
function hideTip() { tip.hidden = true; }

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

function buildTimeline() {
  const tl = $("timeline");
  tl.replaceChildren();

  // Form: the sections, and the codetta inside the exposition.
  tl.append(el("span", "tl-label", "Form"));
  const form = el("div", "tl-track");
  for (const s of piece.sections) {
    const inside = piece.entries.filter((e) => e.start >= s.start - 1e-6 && e.start < s.end);
    const short = s.kind === "entries"
      ? (/^(Stretto|Combination)/.test(s.label) ? s.label.split(":")[0]
        : inside.map((e) => (e.key ? e.key.replace("major", "maj").replace("minor", "min") : `S${e.theme}`)).join(", "))
      : s.kind === "link" ? "" : s.label.split(":")[0].replace("Episode", "Ep.");
    const block = place(el("div", `block section ${s.kind}`, short), s.start, s.end);
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
    const toggle = el("button", "voice-toggle", name);
    toggle.type = "button";
    toggle.setAttribute("aria-pressed", "true");
    toggle.title = `Mute or unmute the ${name.toLowerCase()}`;
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
      axis.append(text);
    }
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
    passages().map((s) => row([passageBars(s).replace(/^bars? /, ""), s.label, s.summary || ""], s.start)));
}

// ----------------------------------------------------------------- score

function renderScore(first) {
  const host = $("score");
  const width = Math.max(480, host.clientWidth);
  toolkit.setOptions({
    scale: SCALE,
    pageWidth: Math.round((width * 100) / SCALE),
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
    spacingStaff: 20,
    spacingSystem: 30,
  });
  if (first) toolkit.loadData(piece.xml);
  else toolkit.redoLayout();

  let svg = "";
  for (let p = 1; p <= toolkit.getPageCount(); p++) svg += toolkit.renderToSVG(p);
  host.innerHTML = svg;

  toolkit.renderToMIDI();
  indexNotes(toolkit.renderToTimemap());
  if (scoreNotes.length) {
    // Length of one CSS pixel in the score's own units.
    const unit = 1 / scoreNotes[0].el.getScreenCTM().a;
    drawMarks(unit);
    drawSequences(unit);
    drawSectionTags(unit);
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
        bg.setAttribute("width", text.getComputedTextLength() + 8 * unit);
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
  if (s.kind === "entries") return /^(Stretto|Combination)/.test(s.label) ? s.label.split(":")[0] : "Entry";
  if (s.kind === "codetta") return "Codetta";
  return s.label.split(":")[0];
}

// A label above the system wherever a section begins.
function drawSectionTags(unit) {
  const frames = new Map();
  for (const system of document.querySelectorAll("#score g.system")) frames.set(system, system.getBBox());
  for (const s of passages()) {
    const firstNote = scoreNotes.find((n) => n.on >= s.start - 1e-6);
    if (!firstNote) continue;
    const frame = frames.get(firstNote.system);
    const x = Math.min(...scoreNotes.filter((n) => n.on === firstNote.on).map((n) => n.el.getBBox().x)) - 5 * unit;
    const tagH = 16 * unit, y = frame.y - tagH - 4 * unit;
    const group = svgEl("g", { class: "section-tag" });
    const line = svgEl("path", { class: "section-line", d: `M${x} ${y + tagH} V${frame.y + frame.height}` });
    const bg = svgEl("rect", { class: "section-tag-bg", x, y, height: tagH, rx: 3 * unit, width: 10 });
    const text = svgEl("text", { class: "section-tag-text", x: x + 6 * unit, y: y + 11.5 * unit, "font-size": 10.5 * unit });
    text.textContent = tagText(s);
    group.append(line, bg, text);
    firstNote.system.append(group);
    bg.setAttribute("width", text.getComputedTextLength() + 12 * unit);
    bg.addEventListener("mousemove", (ev) => showTip(ev, s.label, passageDetail(s)));
    bg.addEventListener("mouseleave", hideTip);
    bg.addEventListener("click", () => seek(s.start));
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
  const wanted = new Set(piece.notes.flatMap((n) => n.midi));
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

function scheduleNote(n, when) {
  const inst = INSTRUMENTS[instrument], bank = banks[instrument];
  const off = when + Math.max(0.07, ((n.dur * 60) / bpm) * inst.hold);
  for (const midi of n.midi) {
    const buffer = bank.get(midi);
    if (!buffer) continue;
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
  while (pointer < piece.notes.length && piece.notes[pointer].on < horizon) {
    const n = piece.notes[pointer++];
    const when = t0 + ((n.on - q0) * 60) / bpm;
    if (when > now - 0.03) scheduleNote(n, Math.max(when, now));
  }
  live = live.filter((x) => x.end > now);
  if (q >= piece.end + 0.5) { pause(); pausedAt = 0; paint(0); }
}

async function play() {
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
  setPlayLabel("Play");
}

function seek(q) {
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

  const sounding = new Set();
  let lead = null;
  if (playing || q > 0) {
    for (const n of scoreNotes) {
      if (n.on > q + 1e-6) break;
      if (q < n.off - 1e-6) { sounding.add(n); lead = lead || n; }
    }
  }
  for (const n of lastSounding) if (!sounding.has(n)) n.el.classList.remove("sounding");
  for (const n of sounding) if (!lastSounding.has(n)) n.el.classList.add("sounding");
  lastSounding = sounding;

  // Keep the system being played in view, below the sticky deck.
  const system = lead ? lead.system : (jump && nearestNote(q)?.system) || null;
  if (system && system !== currentSystem && (playing || jump)) {
    currentSystem = system;
    const top = system.getBoundingClientRect().top + scrollY - $("deck").offsetHeight - 28;
    scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  const at = Math.min(q, piece.end - 0.01);
  const codetta = piece.spans.find((s) => s.kind === "codetta" && at >= s.start - 1e-6 && at < s.end - 1e-6);
  const section = codetta ? { ...codetta, label: "Exposition, codetta" } : sectionAt(at);
  const active = marks.filter((m) => !m.frag && q >= m.start - 1e-6 && q < m.end - 1e-6)
    .map((m) => `${m.short} in ${piece.voices[m.voice].toLowerCase()}`);
  const now = $("now");
  now.replaceChildren(el("b", null, `Bar ${barOf(at)}`),
    ` · ${section.label}` + (section.summary ? ` · ${section.summary}` : active.length ? ` · ${active.join(", ")}` : ""));
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

function wireControls() {
  $("play").addEventListener("click", () => (playing ? pause() : play()));
  $("rewind").addEventListener("click", () => { seek(0); scrollTo({ top: 0, behavior: "smooth" }); });
  $("tempo").addEventListener("input", (ev) => setTempo(Number(ev.target.value)));
  document.querySelectorAll('input[name="instrument"]').forEach((input) =>
    input.addEventListener("change", () => input.checked && setInstrument(input.value)));
  document.addEventListener("keydown", (ev) => {
    if (ev.code !== "Space" || ev.target.closest("input, button, summary, select, textarea")) return;
    ev.preventDefault();
    playing ? pause() : play();
  });
  let resizeTimer, lastWidth = $("score").clientWidth;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if ($("score").clientWidth === lastWidth) return;
      lastWidth = $("score").clientWidth;
      renderScore(false);
    }, 200);
  });
}

async function boot() {
  const [json, xml, index] = await Promise.all([
    fetch(`data/${PIECE}.json`).then((r) => r.json()),
    fetch(`data/${PIECE}.musicxml`).then((r) => r.text()),
    fetch("data/index.json").then((r) => (r.ok ? r.json() : [])).catch(() => []),
  ]);
  if (index.length > 1) {
    // "I/2 C minor" for a fugue of the Well-Tempered Clavier, otherwise its title.
    const name = (p) => (p.book ? `${["", "I", "II"][p.book]}/${p.number} ${p.key}` : p.title);
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
    try { tags = sessionStorage.getItem("fugae-tags") || ""; } catch { /* private window */ }
    if (tags) $("all").href = `browse.html#${tags}`;
    $("where").hidden = false;
  }
  piece = json;
  piece.xml = xml;
  piece.notes.sort((a, b) => a.on - b.on);
  marks = buildMarks();
  bpm = piece.tempo || 72;

  document.title = `${piece.title} · Fugae`;
  $("title").textContent = piece.title;

  // A compact title for the sticky bar: "II/2 · C minor · BWV 871". It appears
  // only when the full title above has scrolled out of view.
  const mini = $("mini");
  const parts = piece.title.match(/Book (\d+), Fugue (\d+) in (.+)$/);
  const short = parts ? `${["", "I", "II"][Number(parts[1])] || parts[1]}/${parts[2]} · ${parts[3]}` : piece.title;
  const bwv = /^bwv\d+$/.test(piece.id) ? `BWV ${piece.id.slice(3)}` : "";
  mini.replaceChildren(short.replace("-sharp", "♯").replace("-flat", "♭"), ...(bwv ? [el("span", null, ` · ${bwv}`)] : []));
  mini.title = piece.title;
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
  paint(0);

  await verovioReady;
  toolkit = new verovio.toolkit();
  renderScore(true);
  $("play").disabled = false;
}

document.addEventListener("DOMContentLoaded", () => {
  if (!PIECE) { location.replace("browse.html"); return; }
  boot().catch((err) => {
    console.error(err);
    $("score").replaceChildren(el("p", "status", `Could not load the piece: ${err.message}`));
  });
});
