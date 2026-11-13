# Fugae

An annotated, playable score of each of the 48 fugues of Bach's *Well-Tempered Clavier*:
subject and answer entries, countersubjects, later subjects, strettos, episodes and what
they are made of, pedal points, and which episodes rework earlier ones. Playback is on
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
- Notation: Verovio (https://www.verovio.org), LGPL.
- Sounds: the FluidR3 GM sound set, as packaged by the midi-js-soundfonts project.

This repository holds only the built page. It is a static site: there is nothing to install.
