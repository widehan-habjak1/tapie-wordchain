import { getTurnDurationMs, getWordPoints, getWrongPenalty, type GameSnapshot } from "./game.ts"
import type { WordEngine } from "../worker/engine.ts"
import { DICTIONARY_VERSION, LEGACY_DICTIONARY_VERSION } from "./dictionary-version.ts"

export const RULES_VERSION = DICTIONARY_VERSION
export type Attempt = { word: string; elapsedMs: number }
export type Transcript = { version: number; id: string; attempts: Attempt[]; reason: "timeout" | "forfeit"; finishElapsedMs: number }
export type LocalRun = { version?: number; game: GameSnapshot; attempts: Attempt[]; turnStartedAt: number; lastElapsedMs: number; finishElapsedMs: number }
export const runVersion = (run: LocalRun | null) => run ? run.version ?? LEGACY_DICTIONARY_VERSION : RULES_VERSION

const seededRandom = (text: string) => {
  let seed = 2166136261
  for (const char of text) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619)
  return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 }
}

export const createLocalRun = (id: string, now: number, version = RULES_VERSION): LocalRun => ({
  version,
  game: { id, revision: 0, rounds: 0, streak: 0, mistakes: 0, words: [], score: 0, status: "active", reason: null, turnDurationMs: getTurnDurationMs(0), remainingMs: getTurnDurationMs(0), ranked: false, lastGain: 0 },
  attempts: [], turnStartedAt: now, lastElapsedMs: 0, finishElapsedMs: 0,
})

export const finishLocalRun = (run: LocalRun, reason: "timeout" | "forfeit", elapsedMs: number): LocalRun => {
  if (run.game.status === "finished") return run
  const elapsed = Math.max(run.lastElapsedMs, Math.floor(elapsedMs))
  const actualReason = elapsed >= run.game.turnDurationMs ? "timeout" : reason
  return { ...run, finishElapsedMs: actualReason === "timeout" ? run.game.turnDurationMs : elapsed, game: { ...run.game, status: "finished", reason: actualReason, remainingMs: 0 } }
}

export const submitLocalWord = (run: LocalRun, input: string, elapsedMs: number, engine: WordEngine): { run: LocalRun; error?: string } => {
  if (run.game.status === "finished") return { run, error: "경기가 종료됐어요." }
  const elapsed = Math.max(run.lastElapsedMs, Math.floor(elapsedMs))
  if (elapsed >= run.game.turnDurationMs) return { run: finishLocalRun(run, "timeout", elapsed), error: "제한 시간이 끝났어요." }
  const word = input.trim().normalize("NFC")
  const remainingMs = run.game.turnDurationMs - elapsed
  const move = engine.evaluateMove(run.game.words.at(-1), word, run.game.words, seededRandom(`${run.game.id}:${run.game.rounds}`))
  const attempts = [...run.attempts, { word, elapsedMs: elapsed }]
  const revision = run.game.revision + 1
  if ("error" in move) {
    const penalty = Math.min(run.game.score, getWrongPenalty(run.game.streak))
    return { run: { ...run, attempts, lastElapsedMs: elapsed, game: { ...run.game, revision, streak: 0, mistakes: run.game.mistakes + 1, score: run.game.score - penalty, lastGain: -penalty, remainingMs } }, error: `${move.error} ${penalty ? `${penalty}점 감점.` : "점수는 0점 아래로 내려가지 않아요."}` }
  }
  const gain = getWordPoints(word, remainingMs, run.game.streak).total
  const rounds = run.game.rounds + 1
  const duration = getTurnDurationMs(rounds)
  return { run: { ...run, attempts, turnStartedAt: run.turnStartedAt + elapsed, lastElapsedMs: 0, game: { ...run.game, revision, rounds, streak: run.game.streak + 1, words: [...run.game.words, word, move.botWord], score: run.game.score + gain, lastGain: gain, remainingMs: duration, turnDurationMs: duration } } }
}

export const getTranscript = (run: LocalRun): Transcript => {
  if (!run.game.reason) throw new Error("경기가 끝나야 기록할 수 있어요.")
  return { version: runVersion(run), id: run.game.id, attempts: run.attempts, reason: run.game.reason, finishElapsedMs: run.finishElapsedMs }
}

export const replayTranscript = (input: unknown, engine: WordEngine | ((version: number) => WordEngine)): LocalRun => {
  const invalid = () => { throw new Error("경기 기록을 확인해 주세요.") }
  if (!input || typeof input !== "object") return invalid()
  const value = input as Transcript
  if (![RULES_VERSION, LEGACY_DICTIONARY_VERSION].includes(value.version) || typeof value.id !== "string" || !/^[a-f0-9-]{36}$/.test(value.id) || !Array.isArray(value.attempts) || value.attempts.length > 2000 || !["timeout", "forfeit"].includes(value.reason)) return invalid()
  const replayEngine = typeof engine === "function" ? engine(value.version) : engine
  let run = createLocalRun(value.id, 0, value.version)
  for (const attempt of value.attempts) {
    if (!attempt || typeof attempt.word !== "string" || attempt.word.length > 100 || !Number.isInteger(attempt.elapsedMs) || attempt.elapsedMs < run.lastElapsedMs || attempt.elapsedMs >= run.game.turnDurationMs) return invalid()
    run = submitLocalWord(run, attempt.word, attempt.elapsedMs, replayEngine).run
  }
  if (!Number.isInteger(value.finishElapsedMs) || value.finishElapsedMs < run.lastElapsedMs || value.finishElapsedMs > run.game.turnDurationMs || (value.reason === "timeout" && value.finishElapsedMs !== run.game.turnDurationMs) || (value.reason === "forfeit" && value.finishElapsedMs >= run.game.turnDurationMs)) return invalid()
  return finishLocalRun(run, value.reason, value.finishElapsedMs)
}
