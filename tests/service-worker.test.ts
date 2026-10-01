import assert from "node:assert/strict"
import test from "node:test"
import { runInNewContext } from "node:vm"
import { createServiceWorker } from "../scripts/service-worker.mjs"

test("offline navigation uses the unredirected root and assets stay cached; API bypasses cache", async () => {
  const handlers = new Map<string, (event: unknown) => void>()
  const saved = new Map<string, Response>()
  const cache = {
    addAll: async (assets: string[]) => { for (const path of assets) saved.set(path, new Response(path === "/" ? "app root" : "redirected index")) },
    match: async (path: string) => saved.get(path)?.clone(),
  }
  let claimed = false
  runInNewContext(createServiceWorker("tapie-shell-test", ["/", "/index.html", "/assets/app.js", "/dictionary.json", "/dictionary-v3.json"]), {
    self: { location: { origin: "https://game.test" }, addEventListener: (name: string, callback: (event: unknown) => void) => handlers.set(name, callback), skipWaiting: async () => {}, clients: { claim: async () => { claimed = true } } },
    caches: { open: async () => cache, keys: async () => ["tapie-shell-test"], delete: async () => true },
    fetch: async () => { throw new TypeError("network unavailable") }, URL, AbortSignal,
  })
  let work: Promise<unknown> | undefined
  handlers.get("install")!({ waitUntil: (promise: Promise<unknown>) => { work = promise } })
  await work
  handlers.get("activate")!({ waitUntil: (promise: Promise<unknown>) => { work = promise } })
  await work
  assert.equal(claimed, true)
  const request = async (path: string, mode = "navigate", method = "GET") => {
    let response: Promise<Response> | undefined
    handlers.get("fetch")!({ request: { url: `https://game.test${path}`, mode, method }, respondWith: (promise: Promise<Response>) => { response = promise } })
    return response ? (await response).text() : null
  }
  assert.equal(await request("/"), "app root")
  assert.equal(await request("/any/path"), "app root")
  assert.equal(await request("/dictionary.json", "cors"), "redirected index")
  assert.equal(await request("/dictionary-v3.json", "cors"), "redirected index")
  assert.equal(await request("/api/rankings", "cors"), null)
  assert.equal(await request("/api/local-ranking", "cors", "POST"), null)
})
