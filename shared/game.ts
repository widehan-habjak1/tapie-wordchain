export const getTurnDurationMs = (completedRounds: number) => Math.max(3000, 12000 - Math.floor(completedRounds / 2) * 2000)

export const getWordPoints = (word: string, remainingMs: number, streak = 0) => {
  const length = word.normalize("NFC").length
  const lengthPoints = length * 10
  const lengthBonus = Math.min(40, Math.max(0, length - 2) ** 2 * 2)
  const timePoints = Math.floor(Math.max(0, remainingMs) / 100)
  const comboPoints = Math.min(10, streak) * 3
  return { lengthPoints, lengthBonus, timePoints, comboPoints, total: lengthPoints + lengthBonus + timePoints + comboPoints }
}

export const getWrongPenalty = (streak: number) => 15 + Math.min(10, streak) * 3

export type GameSnapshot = {
  id: string
  revision: number
  rounds: number
  streak: number
  mistakes: number
  words: string[]
  score: number
  status: "active" | "finished"
  reason: "timeout" | "forfeit" | null
  turnDurationMs: number
  remainingMs: number
  ranked: boolean
  lastGain: number
}

export type RankingEntry = { rank: number; nickname: string; score: number; createdAt: number; pending?: boolean }
export type RankingResult = { entry: RankingEntry; rankings: RankingEntry[] }
