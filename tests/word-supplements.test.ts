import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"
import { dictionaryWords, legacyDictionaryWords, excludedDictionaryWords } from "../dictionary.js"
import { normalizeEntry, parseKkutuWords } from "../scripts/import-word-supplements.mjs"
import { DICTIONARY_VERSION, LEGACY_DICTIONARY_SIZE, dictionaryForVersion, dictionaryPath } from "../shared/dictionary-version.ts"
import { createLocalRun, finishLocalRun, getTranscript, replayTranscript, runVersion, submitLocalWord } from "../shared/run.ts"
import { isValidWord } from "../shared/rules.ts"
import { createWordEngine } from "../worker/engine.ts"

const words = [...dictionaryWords] as string[]
const legacyWords = [...legacyDictionaryWords] as string[]
const replayWords = [...legacyWords, ...words.filter((word) => !legacyDictionaryWords.has(word))]
const currentEngine = createWordEngine(words)
const legacyEngine = createWordEngine(dictionaryForVersion(replayWords, 2))

test("source entries normalize Hangul and exclude punctuation, spaces and unsupported lengths", () => {
  assert.equal(normalizeEntry(" 피카츄 ".normalize("NFD")), "피카츄")
  for (const word of ["가", "a", "리그 오브 레전드", "가-나", "가".repeat(101), null]) assert.equal(normalizeEntry(word), null)
})

test("KKuTu recognized themes expand game and work names without admitting excluded entries", () => {
  const rows = [
    "사과\t1\tmeaning\t0\t0\t\\N", "피카츄\tINJEONG\tmeaning\t0\t2\tPOK",
    "리그오브레전드\tINJEONG\tmeaning\t0\t2\tLOL", "수상한말\tINJEONG\tmeaning\t0\t2\tOIJ",
    "금지단어\t1\tmeaning\t0\t32\tPOK", "옛단어\t1\tmeaning\t0\t16\t\\N",
    "틀린행\t1\tmeaning\t0\tbad\tLOL", "가\t1\tmeaning\t0\t0\tPOK",
  ]
  const { words: parsed, excluded } = parseKkutuWords(`COPY public.kkutu_ko (_id, type, mean, hit, flag, theme) FROM stdin;\r\n${rows.join("\r\n")}\r\n\\.\r\n`)
  assert.deepEqual([...parsed], ["사과", "피카츄", "리그오브레전드"])
  assert.ok(excluded.has("금지단어"))
  assert.throws(() => parseKkutuWords("<html>missing source</html>"))
})

test("the expanded corpus matches the manifest and preserves the immutable old dictionary order", () => {
  const manifest = JSON.parse(readFileSync(new URL("../dictionary-sources.json", import.meta.url), "utf8"))
  assert.equal(words.length, manifest.totalWords)
  assert.equal(words.length, 402553)
  assert.equal(new Set(words).size, words.length)
  assert.equal(legacyWords.length, LEGACY_DICTIONARY_SIZE)
  assert.equal(createHash("sha256").update(JSON.stringify(legacyWords)).digest("hex"), "0fc6e3197f151f7746a9396ae7d165e695e16d311438ce9f8b68ef742b1f347f")
  assert.deepEqual(dictionaryForVersion(replayWords, 2), legacyWords)
  assert.deepEqual(dictionaryForVersion(replayWords, DICTIONARY_VERSION), words)
  assert.ok(words.every((word) => /^[가-힣]{2,100}$/u.test(word) && word === word.normalize("NFC") && !excludedDictionaryWords.has(word)))
})

test("new KKuTu game, Pokemon and brand words work with deterministic offline scoring", () => {
  for (const word of ["피카츄", "이상해씨", "리그오브레전드", "마인크래프트", "오버워치", "스타벅스"]) {
    assert.ok(!legacyDictionaryWords.has(word))
    const move = submitLocalWord(createLocalRun(crypto.randomUUID(), 0), word, 1000, currentEngine)
    assert.equal(move.error, undefined, word)
    assert.equal(move.run.game.rounds, 1)
    const finished = finishLocalRun(move.run, "forfeit", 100)
    assert.deepEqual(replayTranscript(getTranscript(finished), currentEngine).game, finished.game)
  }
})

test("sampled supplemental entries always get a legal bot reply or a one-shot rejection", () => {
  let accepted = 0
  for (let i = LEGACY_DICTIONARY_SIZE - 1; i < words.length; i += 89) {
    const word = words[i]
    const move = currentEngine.evaluateMove(undefined, word, [], () => .5)
    if ("error" in move) { assert.match(move.error, /한방/, word); continue }
    accepted++
    assert.ok(dictionaryWords.has(move.botWord))
    assert.equal(isValidWord(word, move.botWord, [word]), null)
  }
  assert.ok(accepted > 1500)
  assert.match((currentEngine.evaluateMove(undefined, "기쁨", []) as { error: string }).error, /한방/)
})

test("legacy runs and queued transcripts retain errors, bot replies and scores after expansion", () => {
  let old = createLocalRun(crypto.randomUUID(), 0, 2)
  delete old.version // Runs already stored before this release have no version field.
  assert.equal(runVersion(old), 2)
  old = submitLocalWord(old, "피카츄", 100, legacyEngine).run
  old = submitLocalWord(old, "사과", 1000, legacyEngine).run
  old = finishLocalRun(old, "forfeit", 100)
  const transcript = getTranscript(old)
  assert.equal(transcript.version, 2)
  const replay = replayTranscript(transcript, (version) => version === 2 ? legacyEngine : currentEngine)
  assert.deepEqual(replay.game, old.game)
  assert.equal(replay.game.mistakes, 1)
  assert.equal(createLocalRun(crypto.randomUUID(), 0).version, DICTIONARY_VERSION)
})

test("cache paths isolate expanded data from old apps and reject unknown dictionary versions", () => {
  assert.equal(dictionaryPath(DICTIONARY_VERSION), "/dictionary-v3.json")
  assert.equal(dictionaryPath(2), "/dictionary.json")
  assert.equal(runVersion(null), 3)
  assert.throws(() => dictionaryPath(999))
  assert.throws(() => dictionaryForVersion(words, 0))
})
