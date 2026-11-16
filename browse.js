/* Fugae: the list of pieces. A map of the 48 by key and book, tags that narrow it,
 * and the matching fugues listed underneath.
 *
 * Data comes from data/index.json, written by `python -m fugae build` or `index`.
 */
"use strict";

// Tag groups, in the order shown. In an "any" group a piece has exactly one tag,
// so choosing two means either; elsewhere choosing two means both.
const GROUPS = [
  { key: "voices", label: "Voices", any: true,
    order: ["2 voices", "3 voices", "4 voices", "5 voices"] },
  { key: "answer", label: "Answer", any: true, order: ["real answer", "tonal answer"] },
  { key: "themes", label: "Themes",
    order: ["countersubject", "no regular countersubject", "more than one subject"] },
  { key: "devices", label: "Devices",
    order: ["stretto", "inversion", "augmentation", "diminution", "late voice", "pedal point"] },
  { key: "character", label: "Character", note: "after Ledbetter, 2002" },
];
const LINES = ["Book I, major", "Book I, minor", "Book II, major", "Book II, minor"];

// Which collection is shown: "?c=art-of-fugue" in the address, or the 48.
const COLLECTION = collectionOf(new URLSearchParams(location.search).get("c"));

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

let pieces = [];
let incipits = {};             // piece id -> its themes, each a small engraved score
const chosen = new Set();      // "group:tag"

const idOf = (group, tag) => `${group}:${tag}`;
const href = (p) => `index.html?piece=${encodeURIComponent(p.id)}`;

// "c♯" for C♯ minor, "E♭" for E♭ major.
function keyLabel(p) {
  const [tonic, mode] = p.key.split(" ");
  return mode === "minor" ? tonic.toLowerCase() : tonic;
}

function matches(p, selection) {
  return GROUPS.every((g) => {
    const wanted = (g.tags || []).filter((t) => selection.has(idOf(g.key, t)));
    if (!wanted.length) return true;
    const has = p.tags[g.key] || [];
    return g.any ? wanted.some((t) => has.includes(t)) : wanted.every((t) => has.includes(t));
  });
}

// How many fugues would be showing if this tag were chosen as well.
function countWith(group, tag) {
  const trial = new Set(chosen);
  if (group.any) for (const t of group.tags) trial.delete(idOf(group.key, t));
  trial.add(idOf(group.key, tag));
  return pieces.filter((p) => matches(p, trial)).length;
}

function toggle(group, tag) {
  const id = idOf(group, tag);
  if (chosen.has(id)) chosen.delete(id); else chosen.add(id);
  remember();
  hideTip();
  render();
}

// ---------------------------------------------------------------- the address

// The chosen tags live in the address, so Back from a fugue returns to the same subset.
function remember() {
  const hash = [...chosen].map((id) => encodeURI(id.replace(/ /g, "_"))).join("&");
  history.replaceState(null, "", hash ? `#${hash}` : location.pathname + location.search);
  try { sessionStorage.setItem(tagsKey(COLLECTION), hash); } catch { /* private window: the address is enough */ }
}

function recall() {
  chosen.clear();
  const known = new Set(GROUPS.flatMap((g) => g.tags.map((t) => idOf(g.key, t))));
  for (const part of location.hash.slice(1).split("&")) {
    let id = "";
    try { id = decodeURIComponent(part).replace(/_/g, " "); } catch { /* a mangled address: ignore that part */ }
    if (known.has(id)) chosen.add(id);
  }
}

// ---------------------------------------------------------------- tooltip

const tip = $("tip");
function showTip(event, title, detail) {
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
// On a touch screen nothing "leaves" a button: the next touch puts the tip away,
// and so does coming back to this page from a fugue.
document.addEventListener("pointerdown", (ev) => { if (ev.pointerType === "touch") hideTip(); });
addEventListener("pageshow", hideTip);

// The tags fold away on a phone, unless some are chosen.
const phone = matchMedia("(max-width: 560px)");
function fold() { $("narrow").open = !phone.matches || chosen.size > 0; }
phone.addEventListener("change", fold);

// ---------------------------------------------------------------- drawing

function chip(group, tag, count) {
  const on = chosen.has(idOf(group.key, tag));
  const button = el("button", "chip", tag);
  button.type = "button";
  button.setAttribute("aria-pressed", String(on));
  if (count != null) {
    button.append(el("span", "n", String(count)));
    button.disabled = !on && count === 0;
  }
  const note = tagNote(tag);
  if (note) {
    button.addEventListener("mousemove", (ev) => showTip(ev, tag, note));
    button.addEventListener("mouseleave", hideTip);
  }
  button.addEventListener("click", () => toggle(group.key, tag));
  return button;
}

function drawFilters() {
  const rows = GROUPS.filter((g) => g.tags.length).map((g) => {
    const row = el("div", "filter-row");
    const label = el("span", "filter-label", g.label);
    if (g.note) label.append(el("span", "source", ` (${g.note})`));
    const chips = el("div", "chips");
    for (const t of g.tags) chips.append(chip(g, t, countWith(g, t)));
    row.append(label, chips);
    return row;
  });
  $("filters").replaceChildren(...rows);
}

function drawMap(showing) {
  const map = $("map");
  const filtered = chosen.size > 0;
  const nodes = LINES.map((text, line) => {
    const label = el("span", "map-label", text);
    label.style.setProperty("--line", line);
    if (line === 2) label.classList.add("second");
    return label;
  });
  for (const p of pieces.filter((x) => x.book)) {
    const cell = el("a", "cell");
    cell.href = href(p);
    cell.style.setProperty("--line", (p.book - 1) * 2 + ((p.number - 1) % 2));
    cell.style.setProperty("--pc", Math.floor((p.number - 1) / 2));
    if (p.book === 2 && p.number % 2) cell.classList.add("second");
    cell.append(el("b", null, keyLabel(p)), el("span", null, String(p.voices)));
    cell.setAttribute("aria-label", `${shortName(p)}, ${p.key}, ${p.voices} voices`);
    if (filtered) cell.classList.add(showing.has(p.id) ? "on" : "off");
    cell.addEventListener("mousemove", (ev) => showTip(ev, `${shortName(p)} · ${p.key} · ${p.voices} voices`,
      [p.character, p.procedures.join(" · ")].filter(Boolean).join(". ")));
    cell.addEventListener("mouseleave", hideTip);
    nodes.push(cell);
  }
  map.replaceChildren(...nodes);
}

// A fugue's subject as a small score: its first subject only, even where there are
// more, since the point is to recall the piece. The pictures are made when the page
// is built, by the same engraver that draws the full scores.
function drawIncipits(box) {
  const themes = (incipits[box.dataset.piece] || []).slice(0, 1);
  const figures = themes.map((t) => {
    const figure = el("figure", "incipit");
    const staff = el("a", "staff");
    staff.href = `index.html?piece=${encodeURIComponent(box.dataset.piece)}`;
    staff.setAttribute("aria-label", `The subject, first stated in the ${t.voice.toLowerCase()}`);
    staff.innerHTML = t.svg;
    const svg = staff.querySelector("svg");
    const size = svg && svg.getAttribute("viewBox");
    if (size) svg.style.width = `${size.split(" ")[2]}px`;   // drawn at its own size, shrunk only if it must
    figure.append(staff);
    return figure;
  });
  box.replaceChildren(...figures);
}

function drawList(shown) {
  const rows = shown.map((p) => {
    const row = el("li", "piece");
    const link = el("a", "piece-link");
    link.href = href(p);
    link.append(el("b", null, shortName(p)), p.book ? ` ${p.key}` : p.note ? `, ${p.note}` : "");
    const bwv = bwvOf(p.id) ? ` · ${bwvOf(p.id)}` : "";
    const facts = el("span", "facts", `${p.voices} voices · ${p.meter} · ${p.bars} bars${bwv}`);
    const head = el("div", "piece-head");
    head.append(link, facts);

    const body = el("div", "piece-body");
    const themes = el("div", "incipits");
    themes.dataset.piece = p.id;
    drawIncipits(themes);
    body.append(themes);
    if (p.character) body.append(el("p", "piece-character", p.character));
    if (p.caution) body.append(el("p", "piece-character caution", p.caution));
    const chips = el("div", "chips quiet");
    for (const g of GROUPS.filter((x) => x.key !== "voices")) {
      for (const t of g.tags.filter((x) => (p.tags[g.key] || []).includes(x))) {
        const c = chip(g, t);
        if (g.key === "character") c.classList.add("of-character");
        chips.append(c);
      }
    }
    body.append(chips);
    row.append(head, body);
    return row;
  });
  $("pieces").replaceChildren(...rows);
}

function render() {
  const shown = pieces.filter((p) => matches(p, chosen));
  drawFilters();
  if (COLLECTION.map) drawMap(new Set(shown.map((p) => p.id)));
  drawList(shown);
  $("count").textContent = chosen.size
    ? `${shown.length} of ${pieces.length} fugues`
    : `All ${pieces.length} fugues`;
  $("clear").hidden = chosen.size === 0;
  $("chosen").textContent = chosen.size ? `· ${chosen.size} chosen` : "";
}

// ------------------------------------------------------------------ boot

async function boot() {
  const all = await fetch("data/index.json").then((r) => r.json());
  pieces = all.filter((p) => collectionOf(p.collection) === COLLECTION)
    .sort((a, b) => (a.book || 0) - (b.book || 0) || (a.number || 0) - (b.number || 0));

  // The collections, where there is more than one: links, the present one marked.
  const present = COLLECTIONS.filter((c) => all.some((p) => collectionOf(p.collection) === c));
  if (present.length > 1) {
    $("collections").replaceChildren(...present.map((c) => {
      const link = el("a", "btn", c.name);
      link.href = listHref(c);
      if (c === COLLECTION) link.setAttribute("aria-current", "page");
      return link;
    }));
    $("collections").hidden = false;
  }
  document.title = `${COLLECTION.name} · Fugae`;
  $("heading").textContent = COLLECTION.heading;
  $("meta").textContent = COLLECTION.intro;
  $("map").hidden = $("map-note").hidden = !COLLECTION.map;
  $("character-credit").hidden = !pieces.some((p) => (p.tags.character || []).length);
  $("source-credit").innerHTML = COLLECTION.credit;      // our own text, with links
  for (const g of GROUPS) {
    const count = new Map();
    for (const p of pieces) for (const t of p.tags[g.key] || []) count.set(t, (count.get(t) || 0) + 1);
    const preset = (g.order || []).filter((t) => count.has(t));
    const rest = [...count.keys()].filter((t) => !preset.includes(t))
      .sort((a, b) => count.get(b) - count.get(a) || a.localeCompare(b));
    g.tags = [...preset, ...rest];
  }
  // The pictures are large and the list is useful without them, so they come second.
  fetch("data/incipits.json").then((r) => (r.ok ? r.json() : {})).then((found) => {
    incipits = found;
    document.querySelectorAll(".incipits").forEach(drawIncipits);
  }).catch(() => {});
  recall();
  fold();
  $("clear").addEventListener("click", () => { chosen.clear(); remember(); render(); });
  addEventListener("hashchange", () => { recall(); render(); });
  render();
}

document.addEventListener("DOMContentLoaded", () => {
  boot().catch((err) => {
    console.error(err);
    $("count").textContent = `Could not load the list of fugues: ${err.message}`;
  });
});
