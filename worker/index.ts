import words from "./generated/words.json"
import { createWordEngine } from "./engine"
import { createApi } from "./api"
import { dictionaryForVersion, DICTIONARY_VERSION, LEGACY_DICTIONARY_VERSION } from "../shared/dictionary-version"

const engine = createWordEngine(dictionaryForVersion(words, DICTIONARY_VERSION))
let legacyEngine: ReturnType<typeof createWordEngine> | undefined
const replayEngine = (version: number) => version === LEGACY_DICTIONARY_VERSION ? legacyEngine ??= createWordEngine(dictionaryForVersion(words, version)) : engine
export default { fetch: createApi(engine, Date.now, replayEngine) }
