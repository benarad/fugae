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

// The sets of pieces, in the order the list page offers them. A piece belongs to the
// one its `collection` names (data/index.json); the 48 are "wtc".
const COLLECTIONS = [
  {
    id: "wtc",
    name: "The Well-Tempered Clavier",
    heading: "The Well-Tempered Clavier: the 48 fugues",
    intro: "Pick a fugue from the map or the list. Tags narrow both to the fugues that share them.",
    map: true,
    credit: 'Scores: the Humdrum edition of <i>The Well-Tempered Clavier</i>, encoded by David Huron and edited by '
      + 'Craig Stuart Sapp (<a href="https://github.com/humdrum-tools/bach-wtc-fugues">humdrum-tools/bach-wtc-fugues</a>), '
      + 'after the Bach-Gesellschaft edition.',
  },
  {
    id: "art-of-fugue",
    name: "The Art of Fugue",
    heading: "The Art of Fugue: fourteen fugues on one subject",
    intro: "All fourteen are in D minor and grow from the same subject. The four canons and the versions for two "
      + "keyboards are left out. Nos. 6 and 7 are not yet read well: their voices enter in stretto from the first bar.",
    credit: 'Scores: <i>The Art of Fugue</i> from the <a href="https://mcma.readthedocs.io/">Multitrack Contrapuntal '
      + 'Music Archive</a> (MCMA, 2021), after the Werner Icking Music Collection. '
      + 'They are under <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a>, and so are '
      + 'the files this page builds from them.',
  },
  {
    id: "handel-fugues",
    name: "Handel: Six Fugues",
    heading: "Handel: Six Fugues or Voluntarys, HWV 605\u2013610",
    intro: "Six four-voice fugues for organ or harpsichord, published in 1735. Handel writes more freely than Bach: "
      + "voices drop out and come back, chords are filled in, and a subject is often accompanied from its first bars. "
      + "The voices here were worked out by this program from a keyboard edition and have not been proofread note by note.",
    credit: 'Scores: made from the MIDI files and typeset editions of Handel\u2019s <i>Six Fugues</i> by Patrick Roose '
      + '(Werner Icking Music Archive, at <a href="https://imslp.org/wiki/6_Fugues,_HWV_605-610_(Handel,_George_Frideric)">IMSLP</a>), '
      + 'which are under <a href="https://creativecommons.org/licenses/by-nc-sa/3.0/">CC BY-NC-SA 3.0</a>, and so are '
      + 'the files this page builds from them. The edition is for two staves; this program sorted its notes into voices.',
  },
  {
    id: "assorted",
    name: "Other fugues",
    heading: "Other fugues: Bach outside the 48, and his contemporaries",
    intro: "Fugues brought in one at a time, beginning with pieces from Alan Feinberg\u2019s album Fugue State. "
      + "The Scarlatti and Buxtehude fugues were read by this program from typeset editions, notes and voices both, and "
      + "proofread against other editions; Scarlatti writes freely, and a voice here is sometimes the program\u2019s best guess.",
    credit: 'Scores: '
      + 'the fugues of Domenico and Alessandro Scarlatti are made from Pierre '
      + 'Gouin\u2019s typeset editions (Les \u00c9ditions Outremontaises, at <a href="https://imslp.org">IMSLP</a>), which are '
      + 'under <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>, and so are the files this '
      + 'page builds from them; Alessandro Scarlatti\u2019s follows the 18th-century prints where they agree against Gouin. '
      + 'Buxtehude\u2019s fugue is made from Paul-Gustav Feller\u2019s typeset edition (Ritter von '
      + 'Schleyer Verlag, 2014, at IMSLP, <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>).'
  },
];
const collectionOf = (id) => COLLECTIONS.find((c) => c.id === (id || "wtc")) || COLLECTIONS[0];
// Where a collection's chosen tags are kept while a fugue is open (see browse.js).
const tagsKey = (c) => (c.id === "wtc" ? "fugae-tags" : `fugae-tags-${c.id}`);
const listHref = (c, tags) => `browse.html${c.id === "wtc" ? "" : `?c=${c.id}`}${tags ? `#${tags}` : ""}`;
// "I/2" for the 48, otherwise the name its collection gives it, or its title.
const shortName = (p) => (p.book ? `${["", "I", "II"][p.book]}/${p.number}` : p.label || p.title);
// "BWV 847", "HWV 605", or "BWV 1080/9" for one piece of a larger work.
function bwvOf(id) {
  const m = /^(bwv|hwv)(\d+)(?:-0*(\d+))?$/.exec(id || "");
  return m ? `${m[1].toUpperCase()} ${m[2]}${m[3] ? `/${m[3]}` : ""}` : "";
}

function tagNote(tag) {
  const key = Object.keys(GLOSSARY).find((k) => k.toLowerCase() === tag.toLowerCase());
  return TAG_NOTES[tag] || (key ? GLOSSARY[key] : "");
}
