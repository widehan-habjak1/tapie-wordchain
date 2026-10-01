import assert from "node:assert/strict"
import test from "node:test"
import { getWordPoints, getWrongPenalty } from "../shared/game.ts"
import { createLocalRun, finishLocalRun, getTranscript, replayTranscript, submitLocalWord } from "../shared/run.ts"
import { createWordEngine } from "../worker/engine.ts"
import { synchronizeRecords, type SavedRecord } from "../src/utils/SyncQueue.ts"

const engine = createWordEngine(["사과", "과일", "일기", "기차", "차표", "표사", "기쁨"])
const make = () => createLocalRun(crypto.randomUUID(), 1000)

test("fine scoring changes every tenth, rewards length and caps bonuses", () => {
  assert.equal(getWordPoints("사과", 1199).timePoints, 11)
  assert.equal(getWordPoints("사과", 1200).timePoints, 12)
  assert.equal(getWordPoints("끝말잇기", 1200, 3).total, 69)
  assert.equal(getWordPoints("가".repeat(50), 0, 100).lengthBonus, 40)
  assert.equal(getWordPoints("사과", 0, 100).comboPoints, 30)
  assert.equal(getWrongPenalty(100), 45)
})
test("local game works without a request, including errors, progressive time and loss", () => {
  let run = make()
  run = submitLocalWord(run, "사과", 1000, engine).run
  assert.equal(run.game.score, 130)
  const wrong = submitLocalWord(run, "가짜", 2000, engine)
  assert.ok(wrong.error)
  run = wrong.run
  assert.equal(run.game.score, 112)
  assert.equal(run.game.streak, 0)
  assert.equal(run.game.remainingMs, 10000)
  assert.equal(run.turnStartedAt, 2000)
  run = submitLocalWord(run, "일기", 2500, engine).run
  assert.equal(run.game.score, 227)
  assert.equal(run.game.turnDurationMs, 10000)
  run = finishLocalRun(run, "timeout", 10000)
  assert.equal(run.game.reason, "timeout")
  assert.equal(run.game.score, 227)
  assert.deepEqual(replayTranscript(getTranscript(run), engine).game, run.game)
})
test("errors at zero cannot create negative scores and one-shot words remain blocked", () => {
  const { run, error } = submitLocalWord(make(), "기쁨", 100, engine)
  assert.match(error!, /한방/)
  assert.equal(run.game.score, 0)
  assert.equal(run.game.mistakes, 1)
  assert.deepEqual(run.game.words, [])
})
test("late local submissions lose with no appended attempt", () => {
  const run = submitLocalWord(make(), "사과", 12000, engine).run
  assert.equal(run.game.status, "finished")
  assert.equal(run.attempts.length, 0)
})
test("replay rejects illegal elapsed times, premature timeouts and oversized ledgers", () => {
  const run = finishLocalRun(submitLocalWord(make(), "사과", 500, engine).run, "forfeit", 1000)
  const transcript = getTranscript(run)
  for (const altered of [
    { ...transcript, version: 0 },
    { ...transcript, attempts: [{ word: "사과", elapsedMs: -1 }] },
    { ...transcript, attempts: [{ word: "사과", elapsedMs: 12000 }] },
    { ...transcript, attempts: [{ word: "가짜", elapsedMs: 2000 }, { word: "가짜", elapsedMs: 1000 }] },
    { ...transcript, reason: "timeout", finishElapsedMs: 1000 },
    { ...transcript, attempts: Array(2001).fill({ word: "가짜", elapsedMs: 1 }) },
  ]) assert.throws(() => replayTranscript(altered, engine))
})
test("replaying on another engine yields the same bot replies and exact score", () => {
  const words = ["사과", "과일", "일기", "기차", "차표", "표사", "사자", "자기", "과자"]
  const a = createWordEngine(words, () => 0)
  const b = createWordEngine(words, () => .99)
  const run = finishLocalRun(submitLocalWord(make(), "사과", 900, a).run, "forfeit", 400)
  assert.deepEqual(replayTranscript(getTranscript(run), b).game, run.game)
})
test("queued records survive a disconnection and sync once after reconnecting", async () => {
  const run = finishLocalRun(submitLocalWord(make(), "사과", 1000, engine).run, "forfeit", 100)
  const record: SavedRecord = { id: run.game.id, nickname: "로컬", phone: "01000000000", transcript: getTranscript(run), score: run.game.score, createdAt: 1 }
  const data = new Map([[record.id, record]])
  const store = { all: async () => [...data.values()], put: async (value: SavedRecord) => { data.set(value.id, value) } }
  assert.equal(await synchronizeRecords(store, async () => { throw new TypeError("offline") }), false)
  assert.equal(data.get(record.id)?.result, undefined)
  let calls = 0
  const send = async () => { calls++; return { entry: { rank: 1, nickname: "로컬", score: 130, createdAt: 2 }, rankings: [] } }
  assert.equal(await synchronizeRecords(store, send), true)
  await synchronizeRecords(store, send)
  assert.equal(calls, 1)
  assert.equal(data.get(record.id)?.result?.entry.rank, 1)
  assert.equal(data.get(record.id)?.phone, undefined)
})
