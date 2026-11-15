"use strict";

// Terms that need a word of explanation, shared by the pages.
const GLOSSARY = {
  "stile antico": "the old church style: two slow beats in a bar, long notes, lines moving mostly by step, suspensions",
  "ricercar": "a learned fugue in the old style on a slow, serious subject",
  "verset": "a short organ fugue made for the liturgy on a brief stock subject, as in Fischer and Kerll",
  "fughetta": "a short, light fugue",
  "Spielfuge": "a 'playing fugue', built from idiomatic keyboard figuration",
  "partimento": "a fugue improvised from a figured bass, which is how fugue was usually taught",
  "galant": "the lighter, fashionable style of Bach's later years: clear phrases and simple harmony",
  "canzona": "an older, lively kind of fugue in quick notes",
  "exposition fugue": "a fugue made of a chain of expositions, with little or no episode between them",
  "triple-counterpoint": "three lines written so that any one of them can be the bass",
  "triple counterpoint": "three lines written so that any one of them can be the bass",
  "quadruple counterpoint": "four lines written so that any one of them can be the bass",
  "double counterpoint": "two lines written so that either can be the bass",
  "concerto-like": "planned like a concerto movement: the exposition returns as the full band's theme does",
  "concerto type": "planned like a concerto movement: the exposition returns as the full band's theme does",
  "da capo": "the opening comes back at the end",
  "alla breve": "two minim beats in a bar",
  "bourrée": "a quick dance in two, starting with an upbeat",
  "gigue": "a quick dance in compound time",
  "passepied": "a light, quick dance in three",
  "gavotte": "a moderate dance in two, starting in the middle of the bar",
  "Minuet": "a moderate dance in three",
  "real answer": "the subject transposed exactly to the dominant",
  "tonal answer": "the subject transposed to the dominant with a note or two adjusted to stay near the home key",
  "stretto": "a second statement begins before the first has finished, sooner than the entries followed each other in the exposition",
  "inversion": "the subject upside down",
  "augmentation": "the subject in notes twice as long",
  "diminution": "the subject in notes half as long",
  "pedal point": "one note held or repeated, usually in the bass, while the harmony changes in the other voices",
  "countersubject": "a line that regularly accompanies the subject",
};

// What the tags on the list of pieces mean, where the glossary above has no entry.
const TAG_NOTES = {
  "more than one subject": "the program finds a second theme with an exposition of its own that later joins the first",
  "no regular countersubject": "no line accompanies the subject often enough to count as one",
  "late voice": "one voice is held back until after the exposition",
  "verset tradition": GLOSSARY["verset"],
  "stile antico / ricercar": `${GLOSSARY["stile antico"]}; a ricercar is ${GLOSSARY["ricercar"]}`,
  "dance": "in the metre and manner of a dance: bourrée, gigue, passepied, gavotte or minuet",
  "invertible counterpoint": "lines written so that any of them can be the bass",
  "chromatic": "built on a subject that moves by semitones",
  "double or triple fugue": "the commentator counts two or three subjects",
};

function tagNote(tag) {
  const key = Object.keys(GLOSSARY).find((k) => k.toLowerCase() === tag.toLowerCase());
  return TAG_NOTES[tag] || (key ? GLOSSARY[key] : "");
}
