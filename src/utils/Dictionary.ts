type DictionaryCache = Pick<Cache, "match" | "put" | "delete">

const readDictionary = async (response: Response): Promise<string[]> => {
  if (!response.ok) throw new Error("사전 파일을 불러오지 못했어요. 다시 준비해 주세요.")
  let words: unknown
  try { words = await response.json() } catch { throw new Error("사전 파일을 읽지 못했어요. 다시 준비해 주세요.") }
  if (!Array.isArray(words) || !words.length || !words.every((word) => typeof word === "string" && word.length > 0)) throw new Error("사전 파일을 확인하지 못했어요. 다시 준비해 주세요.")
  return words as string[]
}

export const loadDictionary = async (fetchDictionary: () => Promise<Response>, cache?: DictionaryCache, path = "/dictionary.json"): Promise<string[]> => {
  let cached: Response | undefined
  try { cached = await cache?.match(path) } catch { /* A cache read must not block downloading. */ }
  if (cached) {
    try { return await readDictionary(cached) }
    catch { try { await cache?.delete(path) } catch { /* Continue with a fresh response. */ } }
  }
  let response: Response
  try { response = await fetchDictionary() } catch { throw new Error("사전을 불러오지 못했어요. 연결을 확인하고 다시 준비해 주세요.") }
  const copy = response.clone()
  const words = await readDictionary(response)
  // Only valid dictionaries enter the cache. Storage failure still permits play.
  try { await cache?.put(path, copy) } catch { /* The current page can use the in-memory dictionary. */ }
  return words
}
