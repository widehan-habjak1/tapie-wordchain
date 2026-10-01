# Third-party data notices

## KKuTu Korean word data

The supplemental Korean noun list in `kkutu_words.txt` was derived from
[JJoriping/KKuTu](https://github.com/JJoriping/KKuTu) at commit
`a2c240bc31fe2dea31d26fb1cf7625b4645556a6`.

KKuTu is distributed under the GNU General Public License version 3. A copy of
that license is included in `KKUTU_LICENSE`. The generated list retains only
modern Hangul noun entries of at least two syllables, manga/anime titles,
Korean railway station names, geographical names, and country/capital names.
North Korean vocabulary is excluded from every category and is also removed
from the pre-existing dictionary.

`kkutu_extended_words.txt` additionally includes the same source's recognized
Korean topic entries (including games, Pokemon, music, television, movies,
literature, manga/anime, stations, places and specialist vocabulary). Its theme
allowlist follows `Server/lib/const.js`'s `KO_IJP`: `OIJ` is excluded. Entries
are restricted to 2–100 NFC Hangul syllables; North Korean entries and existing
words are removed. This is a filtered derivative, not the live KKuTu Korea
dictionary or an assertion that every KKuTu variant accepts these entries.

## Open Korean Text noun data

`open_korean_words.txt` was derived from the noun resources of
[Open Korean Text](https://github.com/open-korean-text/open-korean-text) at commit
`74cc4ae7d3dab232747cd5ddb723e4b73c476e4f`, by its developers and contributors
(the official fork of Twitter Korean Text).

The source is distributed under Apache License 2.0; a copy is included in
`OPEN_KOREAN_TEXT_LICENSE`. Included source files are `nouns`, `entities`,
`foreign`, `fashion`, `brand`, `company_names`, `geolocations`, `kpop`, `lol`,
`pokemon`, and `wikipedia_title_nouns` under
`src/main/resources/org/openkoreantext/processor/util/noun/`.

This derivative normalizes NFC and keeps only 2–100-syllable Hangul entries,
removing duplicates and the project's existing North Korean exclusions.
The source's profanity, slang, spam and Twitter-specific lists are not imported.
Pinned source URLs and SHA-256 digests are recorded in `dictionary-sources.json`.
