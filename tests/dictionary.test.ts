import assert from "node:assert/strict"
import test from "node:test"
import { loadDictionary } from "../src/utils/Dictionary.ts"

const valid = () => Response.json(["사과", "과일", "일기"])
const makeCache = (response?: Response) => {
  let stored = response
  let deleted = 0
  let writes = 0
  const cache = {
    match: async () => stored?.clone(),
    delete: async () => { stored = undefined; deleted++; return true },
    put: async (_path: string, value: Response) => { stored = value; writes++ },
  }
  return { cache, deleted: () => deleted, writes: () => writes }
}

test("the first download validates and stores the dictionary", async () => {
  const storage = makeCache()
  assert.deepEqual(await loadDictionary(async () => valid(), storage.cache), ["사과", "과일", "일기"])
  assert.equal(storage.writes(), 1)
})
test("a cached HTML fallback is evicted and the game recovers automatically", async () => {
  const storage = makeCache(new Response("<!doctype html><div id='root'></div>"))
  let downloads = 0
  const words = await loadDictionary(async () => { downloads++; return valid() }, storage.cache)
  assert.equal(downloads, 1)
  assert.equal(storage.deleted(), 1)
  assert.equal(storage.writes(), 1)
  assert.equal(words[0], "사과")
  assert.deepEqual(await loadDictionary(async () => { throw new Error("offline") }, storage.cache), words)
})
test("malformed cached data is replaced and malformed downloads are never cached", async () => {
  for (const data of [[], { words: ["사과"] }, ["사과", 1], [""]]) {
    const storage = makeCache(Response.json(data))
    assert.equal((await loadDictionary(async () => valid(), storage.cache)).length, 3)
    assert.equal(storage.deleted(), 1)
  }
  const storage = makeCache()
  await assert.rejects(loadDictionary(async () => new Response("<html>missing dictionary</html>"), storage.cache), /사전 파일/)
  assert.equal(storage.writes(), 0)
})
test("cache reads and quota failures cannot block a valid online game", async () => {
  const cache = { match: async () => { throw new Error("unavailable") }, delete: async () => true, put: async () => { throw new Error("quota") } }
  assert.equal((await loadDictionary(async () => valid(), cache)).length, 3)
})
test("only an uncached network failure requires reconnection", async () => {
  await assert.rejects(loadDictionary(async () => { throw new TypeError("offline") }), /연결을 확인/)
  const storage = makeCache(valid())
  assert.equal((await loadDictionary(async () => { throw new TypeError("offline") }, storage.cache)).length, 3)
})
