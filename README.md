# Fugae

An annotated, playable score of each of the 48 fugues of Bach's *Well-Tempered Clavier*,
fourteen fugues of *The Art of Fugue* and Handel's Six Fugues, HWV 605-610:
subject and answer entries, countersubjects, later subjects, strettos, episodes and what
they are made of, pedal points, cadences, and which episodes rework earlier ones. Playback is on
piano or harpsichord, with a tempo control and a mute for each voice.

Open it at https://benarad.github.io/fugae/

The analysis is worked out by a program and is a first reading, not an authority. It has
been checked against published analyses (Prout, Bruhn, Ledbetter, and the reference
annotations of Giraud et al. 2015) and still differs from them in places, most of all
over countersubjects.

## Sources

- Scores: the Humdrum edition of the Well-Tempered Clavier, encoded by David Huron and
  edited by Craig Stuart Sapp, after the Bach-Gesellschaft edition
  (https://github.com/humdrum-tools/bach-wtc-fugues). The score and analysis files in
  `data/` are derived from those encodings; rights in the encodings remain with their authors.
- *The Art of Fugue*: scores from the Multitrack Contrapuntal Music Archive (MCMA, 2021,
  https://mcma.readthedocs.io/), after the Werner Icking Music Collection, under CC BY-NC-SA 4.0;
  the files derived from them in `data/` (`bwv1080-*`) are under the same licence.
- Handel's Six Fugues: made from the MIDI files and typeset editions by Patrick Roose (Werner
  Icking Music Archive, at IMSLP: https://imslp.org/wiki/6_Fugues,_HWV_605-610_(Handel,_George_Frideric)),
  listed there as CC BY-NC-SA 3.0; the files derived from them in `data/` (`hwv*`) are under the
  same licence. The edition is on two staves; the program sorted its notes into four voices,
  and the result has not been proofread note by note.
- Beaming follows Bach's practice as described by Yo Tomita, "Deciphering the performance hints
  hidden in J. S. Bach's quaver beams", *Early Music* 44/1 (2016).
- Notation: Verovio (https://www.verovio.org), LGPL.
- Sounds: the FluidR3 GM sound set, as packaged by the midi-js-soundfonts project.

This repository holds only the built page. It is a static site: there is nothing to install.
