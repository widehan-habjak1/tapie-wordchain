import { getAllowedInitials, isValidWord } from "../shared/rules.ts"

export const createWordEngine = (words: string[], random: () => number = Math.random) => {
  const dictionary = new Set(words)
  const index = new Map<string, string[]>()
  for (const word of dictionary) {
    const bucket = index.get(word[0]) ?? []
    bucket.push(word)
    index.set(word[0], bucket)
  }
  const buckets = (word: string) => getAllowedInitials(word.at(-1)!).map((initial) => index.get(initial) ?? [])
  const canContinue = (word: string, used: Set<string>) => buckets(word).some((bucket) => bucket.some((candidate) => candidate !== word && !used.has(candidate)))

  return {
    evaluateMove(previousWord: string | undefined, word: string, usedWords: string[], moveRandom = random): { error: string } | { botWord: string } {
      const error = isValidWord(previousWord, word, usedWords)
      if (error) return { error }
      if (!dictionary.has(word)) return { error: "사전에 없는 단어예요." }
      const used = new Set([...usedWords, word])
      const replies = buckets(word)
      // Prefer short words and avoid a one-shot reply from the bot as well.
      for (const shortOnly of [true, false]) {
        for (const bucket of replies) {
          const offset = Math.floor(moveRandom() * bucket.length)
          for (let i = 0; i < bucket.length; i++) {
            const candidate = bucket[(offset + i) % bucket.length]
            if (used.has(candidate) || (shortOnly && candidate.length > 5)) continue
            if (canContinue(candidate, used)) return { botWord: candidate }
          }
        }
      }
      return { error: "한방 단어는 사용할 수 없어요. 테이피가 이어갈 수 있는 단어를 입력해 주세요." }
    },
  }
}

export type WordEngine = ReturnType<typeof createWordEngine>
