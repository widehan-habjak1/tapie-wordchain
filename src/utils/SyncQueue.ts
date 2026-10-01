import type { RankingResult } from "../../shared/game.ts"
import type { Transcript } from "../../shared/run.ts"

export type SavedRecord = { id: string; nickname: string; phone?: string; transcript: Transcript; score: number; createdAt: number; result?: RankingResult; error?: string }
export type QueueStore = { all: () => Promise<SavedRecord[]>; put: (record: SavedRecord) => Promise<void> }

// Persist the receipt before moving on. A lost response retries the same UUID.
export const synchronizeRecords = async (store: QueueStore, send: (record: SavedRecord) => Promise<RankingResult>, rejected: (error: unknown) => string | undefined = () => undefined) => {
  let connected = true
  for (const record of await store.all()) {
    if (record.result || record.error) continue
    try {
      const saved = { ...record, result: await send(record) }
      delete saved.phone
      await store.put(saved)
    }
    catch (error) {
      const message = rejected(error)
      if (message) await store.put({ ...record, error: message })
      else { connected = false; break }
    }
  }
  return connected
}
