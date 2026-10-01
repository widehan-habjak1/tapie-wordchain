import { createWordEngine, type WordEngine } from "../../worker/engine.ts"
import { getTranscript, type LocalRun } from "../../shared/run.ts"
import type { RankingEntry, RankingResult } from "../../shared/game.ts"
import { synchronizeRecords, type SavedRecord, type QueueStore } from "./SyncQueue.ts"
import { loadDictionary } from "./Dictionary.ts"
import { normalizePhone } from "../../shared/contact.ts"
import { dictionaryPath, DICTIONARY_VERSION } from "../../shared/dictionary-version.ts"

const RUN_KEY = "wordchain-run-v2"
const RANK_KEY = "wordchain-rankings-v2"
const MODE_KEY = "wordchain-local-mode"
let manual = false
let connected = true
let syncing: Promise<void> | null = null
const enginePromises = new Map<number, Promise<WordEngine>>()
const changed = () => window.dispatchEvent(new Event("wordchain-sync"))
try { manual = localStorage.getItem(MODE_KEY) === "true" } catch { /* Optional preference. */ }

export const connectionState = () => ({ manual, connected })
export const setLocalMode = (value: boolean) => {
  manual = value
  try { localStorage.setItem(MODE_KEY, String(value)) } catch { /* Optional preference. */ }
  changed()
  if (!value) void syncRankings()
}
const readJson = <T>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback } catch { return fallback } }
export const restoreRun = (): LocalRun | null => {
  const run = readJson<LocalRun | null>(RUN_KEY, null)
  return run?.game?.id && Array.isArray(run.attempts) && Number.isFinite(run.turnStartedAt) ? run : null
}
export const persistRun = (run: LocalRun | null) => { try { if (run) localStorage.setItem(RUN_KEY, JSON.stringify(run)); else localStorage.removeItem(RUN_KEY) } catch { /* Gameplay still works if browser storage is full. */ } }
export const cachedRankings = () => readJson<RankingEntry[]>(RANK_KEY, [])
const cacheRankings = (entries: RankingEntry[]) => { try { localStorage.setItem(RANK_KEY, JSON.stringify(entries)) } catch { /* Optional cache. */ } }

let database: Promise<IDBDatabase> | null = null
const db = () => database ??= new Promise((resolve, reject) => {
  const request = indexedDB.open("tapie-offline-v2", 1)
  request.onupgradeneeded = () => request.result.createObjectStore("records", { keyPath: "id" })
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => { database = null; reject(request.error) }
})
const records: QueueStore = {
  all: async () => new Promise<SavedRecord[]>((resolve, reject) => {
    void db().then((database) => {
      const request = database.transaction("records").objectStore("records").getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }).catch(reject)
  }),
  put: async (record) => new Promise<void>((resolve, reject) => {
    void db().then((database) => {
      const transaction = database.transaction("records", "readwrite")
      transaction.objectStore("records").put(record)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    }).catch(reject)
  }),
}

export const loadLocalEngine = (version = DICTIONARY_VERSION) => {
  const existing = enginePromises.get(version)
  if (existing) return existing
  const path = dictionaryPath(version)
  const promise = (async () => {
    let cache: Cache | undefined
    try { cache = await caches.open(`tapie-dictionary-v${version}`) } catch { /* In-memory mode still works. */ }
    const words = await loadDictionary(() => fetch(path, { signal: AbortSignal.timeout(30000), cache: "no-cache" }), cache, path)
    return createWordEngine(words)
  })().catch((error) => { enginePromises.delete(version); throw error })
  enginePromises.set(version, promise)
  return promise
}

class RankingFailure extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}
const fetchRanking = async (path: string, body?: unknown) => {
  const response = await fetch(path, { method: body ? "POST" : "GET", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(3000) })
  const value = await response.json()
  if (!response.ok) throw new RankingFailure(value.error || "기록을 등록하지 못했어요.", response.status)
  return value
}
export const refreshRankings = async () => {
  if (manual) return cachedRankings()
  try {
    const { rankings } = await fetchRanking("/api/rankings") as { rankings: RankingEntry[] }
    cacheRankings(rankings); connected = true
  } catch { connected = false }
  changed()
  return cachedRankings()
}
export const pendingRankings = async (): Promise<RankingEntry[]> => (await records.all()).filter((record) => !record.result && !record.error).map((record) => ({ rank: 0, nickname: record.nickname, score: record.score, createdAt: record.createdAt, pending: true }))
export const registrationFor = async (id: string) => {
  const record = (await records.all()).find((record) => record.id === id)
  if (record && !record.result && !record.phone) return null
  if (record?.error) throw new Error(record.error)
  return record ? record.result?.entry ?? { rank: 0, nickname: record.nickname, score: record.score, createdAt: record.createdAt, pending: true } : null
}
export const queueRanking = async (run: LocalRun, nicknameInput: string, phoneInput: string) => {
  const nickname = nicknameInput.trim().normalize("NFC")
  if (!/^[가-힣a-zA-Z0-9_ ]{1,12}$/u.test(nickname)) throw new Error("닉네임은 한글·영문·숫자로 1~12자 입력해 주세요.")
  const phone = normalizePhone(phoneInput)
  if (!phone) throw new Error("전화번호를 확인해 주세요. 숫자 9~15자리를 입력해 주세요.")
  const existing = (await records.all()).find((record) => record.id === run.game.id)
  if (!existing) await records.put({ id: run.game.id, nickname, phone, transcript: getTranscript(run), score: run.game.score, createdAt: Date.now() })
  else if (!existing.result && (!existing.phone || existing.error)) await records.put({ ...existing, nickname, phone, error: undefined })
  try { localStorage.setItem("wordchain-nickname", nickname) } catch { /* Optional preference. */ }
  changed()
  void syncRankings()
  return registrationFor(run.game.id)
}
export const syncRankings = () => {
  if (manual) return Promise.resolve()
  if (syncing) return syncing
  syncing = (async () => {
    connected = await synchronizeRecords(records, async (record) => {
      if (!record.phone) throw new RankingFailure("전화번호를 입력해 기록 등록을 완료해 주세요.", 400)
      const result = await fetchRanking("/api/local-ranking", { nickname: record.nickname, phone: record.phone, transcript: record.transcript }) as RankingResult
      cacheRankings(result.rankings)
      return result
    }, (error) => error instanceof RankingFailure && error.status >= 400 && error.status < 500 ? error.message : undefined)
    await refreshRankings()
  })().catch(() => { connected = false }).finally(() => { syncing = null; changed() })
  return syncing
}

export const prepareOfflineShell = async () => {
  if (import.meta.env.DEV || !("serviceWorker" in navigator)) return false
  const registration = await navigator.serviceWorker.register("/sw.js")
  const worker = registration.installing || registration.waiting
  if (worker && worker.state !== "activated") await new Promise<void>((resolve, reject) => {
    worker.addEventListener("statechange", () => { if (worker.state === "activated") resolve(); if (worker.state === "redundant") reject(new Error("오프라인 화면을 저장하지 못했어요.")) })
  })
  return true
}
