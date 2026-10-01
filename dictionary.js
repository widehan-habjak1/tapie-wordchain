import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const sqlPath = fileURLToPath(new URL("./korean_kr.sql", import.meta.url))
const kkutuWordsPath = fileURLToPath(new URL("./kkutu_words.txt", import.meta.url))
const kkutuExcludedWordsPath = fileURLToPath(new URL("./kkutu_excluded_words.txt", import.meta.url))
const wordPattern = /\((\d+),\s*'((?:\\.|''|[^'\\])*)',\s*'((?:\\.|''|[^'\\])*)'\)/g
const HANGUL_BASE = 0xac00
const HANGUL_END = 0xd7a3
const SYLLABLES_PER_INITIAL = 21 * 28
const NIEUN_INDEX = 2
const RIEUL_INDEX = 5
const IEUNG_INDEX = 11
const NIEUN_TO_IEUNG_VOWELS = new Set([3, 6, 7, 12, 17, 20])

const decodeSqlString = (value) => value
  .replace(/''/g, "'")
  .replace(/\\([0abtnvfrZ\\'"%_])/g, (_, escaped) => ({
    0: "\0", a: "\x07", b: "\b", t: "\t", n: "\n", v: "\v", f: "\f", r: "\r", Z: "\x1a",
    "\\": "\\", "'": "'", '"': '"', "%": "%", _: "_",
  })[escaped])

const replaceInitial = (syllable, initialIndex) => {
  const syllableIndex = syllable.charCodeAt(0) - HANGUL_BASE
  return String.fromCharCode(HANGUL_BASE + initialIndex * SYLLABLES_PER_INITIAL + syllableIndex % SYLLABLES_PER_INITIAL)
}

export const getAllowedInitials = (syllable) => {
  const code = syllable.charCodeAt(0)
  if (code < HANGUL_BASE || code > HANGUL_END) return [syllable]

  const syllableIndex = code - HANGUL_BASE
  const initialIndex = Math.floor(syllableIndex / SYLLABLES_PER_INITIAL)
  const vowelIndex = Math.floor((syllableIndex % SYLLABLES_PER_INITIAL) / 28)
  const allowed = [syllable]

  if (initialIndex === RIEUL_INDEX) {
    allowed.push(replaceInitial(syllable, NIEUN_INDEX), replaceInitial(syllable, IEUNG_INDEX))
  } else if (initialIndex === NIEUN_INDEX && NIEUN_TO_IEUNG_VOWELS.has(vowelIndex)) {
    allowed.push(replaceInitial(syllable, IEUNG_INDEX))
  }

  return [...new Set(allowed)]
}

const loadWordIndex = () => {
  const sql = readFileSync(sqlPath, "utf8")
  const nounWords = new Set()
  const northKoreanWords = new Set()

  for (const [, , rawWord, rawPart] of sql.matchAll(wordPattern)) {
    const word = decodeSqlString(rawWord).normalize("NFC")
    const part = decodeSqlString(rawPart)
    if (part === "북한어") northKoreanWords.add(word)
    if (part === "명사" && /^[가-힣]{2,}$/u.test(word)) nounWords.add(word)
  }

  const words = new Set([...nounWords].filter((word) => !northKoreanWords.has(word)))
  const kkutuWords = readFileSync(kkutuWordsPath, "utf8")
    .split(/\r?\n/u)
    .filter((word) => /^[가-힣]{2,}$/u.test(word))
  for (const word of kkutuWords) words.add(word.normalize("NFC"))
  const kkutuExcludedWords = readFileSync(kkutuExcludedWordsPath, "utf8").split(/\r?\n/u).filter(Boolean)
  for (const word of kkutuExcludedWords) words.delete(word.normalize("NFC"))
  const index = new Map()
  for (const word of words) {
    const initial = word[0]
    const bucket = index.get(initial) ?? []
    bucket.push(word)
    index.set(initial, bucket)
  }

  return { index, words, excluded: new Set([...northKoreanWords, ...kkutuExcludedWords]) }
}

const dictionary = loadWordIndex()

// Keep the original order immutable: version 2 transcripts replay against this prefix.
export const legacyDictionaryWords = dictionary.words
export const excludedDictionaryWords = dictionary.excluded
const expandedWords = new Set(dictionary.words)
for (const word of dictionary.excluded) expandedWords.delete(word)
for (const file of ["kkutu_extended_words.txt", "open_korean_words.txt"]) {
  const content = readFileSync(new URL(file, import.meta.url), "utf8")
  for (const line of content.split(/\r?\n/u)) {
    const word = line.normalize("NFC")
    if (/^[가-힣]{2,100}$/u.test(word) && !dictionary.excluded.has(word)) expandedWords.add(word)
  }
}

const expandedIndex = new Map()
for (const word of expandedWords) {
  const bucket = expandedIndex.get(word[0]) ?? []
  bucket.push(word)
  expandedIndex.set(word[0], bucket)
}
export const wordsByInitial = expandedIndex
export const dictionaryWords = expandedWords
export const wordCount = expandedWords.size
