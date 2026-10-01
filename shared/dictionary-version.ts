export const DICTIONARY_VERSION = 3
export const LEGACY_DICTIONARY_VERSION = 2
export const LEGACY_DICTIONARY_SIZE = 221796
// Previously reintroduced by the old supplement despite its exclusion metadata.
export const REMOVED_LEGACY_WORDS = ["조게"]

export const dictionaryPath = (version: number) => {
  if (version === LEGACY_DICTIONARY_VERSION) return "/dictionary.json"
  if (version === DICTIONARY_VERSION) return "/dictionary-v3.json"
  throw new Error("지원하지 않는 사전 버전이에요.")
}

// The old dictionary is an immutable prefix so old offline transcripts keep
// their original bot replies, errors and scores after a dictionary update.
export const dictionaryForVersion = (words: string[], version: number) => {
  dictionaryPath(version)
  return version === LEGACY_DICTIONARY_VERSION ? words.slice(0, LEGACY_DICTIONARY_SIZE) : words.filter((word) => !REMOVED_LEGACY_WORDS.includes(word))
}
