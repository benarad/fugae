// How a note is played where the score says more than its pitch and length: an ornament, or a staccato.
// Shared by a fugue's page (app.js) and the clip page (clip/sound.js). A note in a fugue's data may carry
// `orn` (trill, mordent, prall or turn), `aux` (the notes the ornament turns to: the one above or below,
// or for a turn the one above and the one below) and `stacc`.
//
// The ornaments are played as in Bach's time. A trill starts on the note above and alternates with the
// main note at about the speed a player would take, nine notes a second or so (faster on a short note),
// and comes to rest on the main note for the last part of its length. A mordent is the main note, the one
// below and the main note again, quickly; a prall (the inverted mordent) the same with the note above. A
// turn is the note above, the main note, the one below and the main note. A staccato note is held for
// half as long as it would otherwise be.

/**
 * The strokes that play note `n`, `length` seconds long, on an instrument that holds a plain note for
 * `hold` of its length: each a pitch, when it is struck and how long it sounds, in seconds from the
 * note's start. The other notes of a chord are struck plainly.
 */
function strokes(n, length, hold) {
  const keep = (n.stacc ? 0.5 : 1) * hold;
  const [main, ...others] = n.midi;
  const out = others.map((midi) => ({ midi, at: 0, sounds: Math.max(0.07, length * keep) }));
  // Quick notes in turn from the note's start, the last of them held for the rest of the note.
  const run = (pitches, each) => {
    pitches.forEach((midi, i) => out.push({ midi, at: i * each, sounds: each * 0.95 }));
    const last = out[out.length - 1];
    last.sounds = Math.max(each * 0.95, length * keep - last.at, 0.07);
  };
  const [first, second] = n.aux || [];
  if (n.orn === "trill" && first != null) {
    let each = Math.min(0.11, Math.max(0.065, length / 8));
    // An even number of quick notes, so that the trill ends on the main note, over most of the note's length.
    const count = Math.max(4, 2 * Math.floor((length * 0.85) / each / 2));
    if (count * each > length * 0.9) each = (length * 0.9) / count;
    run(Array.from({ length: count }, (_, i) => (i % 2 ? main : first)), each);
  } else if ((n.orn === "mordent" || n.orn === "prall") && first != null) {
    run([main, first, main], Math.min(0.075, length / 4));
  } else if (n.orn === "turn" && first != null && second != null) {
    run([first, main, second, main], Math.min(0.09, length / 6));
  } else {
    out.push({ midi: main, at: 0, sounds: Math.max(0.07, length * keep) });
  }
  return out;
}

// For the page, which loads this as a plain script, and the clip page, which imports it as a module.
globalThis.strokes = strokes;
