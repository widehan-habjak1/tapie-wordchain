import { mkdir, writeFile } from "node:fs/promises"
import { dictionaryWords, legacyDictionaryWords } from "../dictionary.js"
import { LEGACY_DICTIONARY_SIZE, dictionaryPath, DICTIONARY_VERSION, dictionaryForVersion } from "../shared/dictionary-version.ts"

if (legacyDictionaryWords.size !== LEGACY_DICTIONARY_SIZE) throw new Error("The version 2 dictionary must remain immutable")

const destination = new URL("../worker/generated/", import.meta.url)
await mkdir(destination, { recursive: true })
const replayWords = [...legacyDictionaryWords, ...[...dictionaryWords].filter((word) => !legacyDictionaryWords.has(word))]
if (JSON.stringify(dictionaryForVersion(replayWords, DICTIONARY_VERSION)) !== JSON.stringify([...dictionaryWords])) throw new Error("Versioned dictionaries do not match")
await writeFile(new URL("words.json", destination), JSON.stringify(replayWords))
const publicFolder = new URL("../public/", import.meta.url)
await mkdir(publicFolder, { recursive: true })
await writeFile(new URL("dictionary.json", publicFolder), JSON.stringify([...legacyDictionaryWords]))
await writeFile(new URL(dictionaryPath(DICTIONARY_VERSION).slice(1), publicFolder), JSON.stringify([...dictionaryWords]))
console.log(`Worker dictionary: ${dictionaryWords.size.toLocaleString()} words`)
