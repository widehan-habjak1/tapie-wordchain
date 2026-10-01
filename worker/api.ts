import { getTurnDurationMs, getWordPoints, getWrongPenalty, type GameSnapshot, type RankingEntry } from "../shared/game.ts"
import { replayTranscript } from "../shared/run.ts"
import { normalizePhone } from "../shared/contact.ts"
import type { WordEngine } from "./engine.ts"

export type Env = { DB: D1Database; ASSETS: Fetcher }
type GameRow = { id: string; words: string; score: number; revision: number; streak: number; mistakes: number; last_gain: number; deadline: number; status: "active" | "finished"; reason: "timeout" | "forfeit" | null; ranked: number }
type RankRow = { game_id: string; nickname: string; score: number; created_at: number }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } })
const gameSelect = "SELECT g.*, EXISTS(SELECT 1 FROM rankings r WHERE r.game_id = g.id) AS ranked FROM games g WHERE g.id = ?"
const snapshot = (game: GameRow, now: number): GameSnapshot => ({
  id: game.id, words: JSON.parse(game.words), score: game.score, revision: game.revision, rounds: JSON.parse(game.words).length / 2, streak: game.streak, mistakes: game.mistakes,
  status: game.status, reason: game.reason, ranked: Boolean(game.ranked), lastGain: game.last_gain,
  turnDurationMs: getTurnDurationMs(JSON.parse(game.words).length / 2), remainingMs: game.status === "active" ? Math.max(0, game.deadline - now) : 0,
})
const readBody = async (request: Request): Promise<Record<string, unknown>> => {
  const raw = await request.text()
  if (raw.length > 256000) throw new Error("body")
  const body: unknown = JSON.parse(raw)
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("body")
  return body as Record<string, unknown>
}

export const createApi = (engine: WordEngine, now: () => number = Date.now, replayEngine: (version: number) => WordEngine = () => engine) => {
  const getGame = (db: D1Database, id: string) => db.prepare(gameSelect).bind(id).first<GameRow>()
  const finish = async (db: D1Database, game: GameRow, reason: "timeout" | "forfeit") => {
    await db.prepare("UPDATE games SET status = 'finished', reason = ? WHERE id = ? AND status = 'active' AND revision = ?").bind(reason, game.id, game.revision).run()
    return (await getGame(db, game.id))!
  }
  const rankings = async (db: D1Database): Promise<RankingEntry[]> => {
    const { results } = await db.prepare("SELECT nickname, score, created_at FROM rankings ORDER BY score DESC, created_at ASC, game_id ASC LIMIT 20").all<RankRow>()
    return results.map((row, index) => ({ rank: index + 1, nickname: row.nickname, score: row.score, createdAt: row.created_at }))
  }
  const register = async (db: D1Database, id: string, input: unknown, phoneInput: unknown) => {
    const nickname = typeof input === "string" ? input.trim().normalize("NFC") : ""
    if (!/^[가-힣a-zA-Z0-9_ ]{1,12}$/u.test(nickname)) return json({ error: "닉네임은 한글·영문·숫자로 1~12자 입력해 주세요." }, 400)
    const phone = normalizePhone(phoneInput)
    if (!phone) return json({ error: "전화번호를 확인해 주세요. 숫자 9~15자리를 입력해 주세요." }, 400)
    await db.prepare("INSERT INTO rankings (game_id, nickname, score, created_at) SELECT id, ?, score, ? FROM games WHERE id = ? AND status = 'finished' ON CONFLICT(game_id) DO NOTHING").bind(nickname, now(), id).run()
    const row = await db.prepare("SELECT * FROM rankings WHERE game_id = ?").bind(id).first<RankRow>()
    if (!row) return json({ error: "종료된 경기만 등록할 수 있어요." }, 409)
    await db.prepare("INSERT INTO ranking_contacts (game_id, phone, created_at) VALUES (?, ?, ?) ON CONFLICT(game_id) DO NOTHING").bind(id, phone, now()).run()
    const count = await db.prepare("SELECT COUNT(*) AS total FROM rankings WHERE score > ? OR (score = ? AND (created_at < ? OR (created_at = ? AND game_id < ?)))").bind(row.score, row.score, row.created_at, row.created_at, row.game_id).first<{ total: number }>()
    return json({ entry: { rank: count!.total + 1, nickname: row.nickname, score: row.score, createdAt: row.created_at }, rankings: await rankings(db) })
  }

  return async (request: Request, env: Env): Promise<Response> => {
    const url = new URL(request.url)
    const path = url.pathname
    if (!path.startsWith("/api/")) return env.ASSETS.fetch(request)
    const receivedAt = now()
    try {
      if (request.method === "GET" && path === "/api/rankings") return json({ rankings: await rankings(env.DB) })
      if (request.method === "POST" && path === "/api/local-ranking") {
        const body = await readBody(request)
        let run
        try { run = replayTranscript(body.transcript, replayEngine) } catch { return json({ error: "경기 기록을 확인해 주세요." }, 400) }
        const game = run.game
        await env.DB.prepare("INSERT INTO games (id, words, score, revision, streak, mistakes, last_gain, deadline, status, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'finished', ?, ?) ON CONFLICT(id) DO NOTHING").bind(game.id, JSON.stringify(game.words), game.score, game.revision, game.streak, game.mistakes, game.lastGain, game.reason, receivedAt).run()
        return register(env.DB, game.id, body.nickname, body.phone)
      }
      if (request.method === "POST" && path === "/api/games") {
        const id = crypto.randomUUID()
        await env.DB.prepare("INSERT INTO games (id, deadline, created_at) VALUES (?, ?, ?)").bind(id, receivedAt + getTurnDurationMs(0), receivedAt).run()
        return json({ game: snapshot((await getGame(env.DB, id))!, now()) }, 201)
      }
      const match = /^\/api\/games\/([a-f0-9-]{36})(?:\/(words|finish|ranking))?$/.exec(path)
      if (!match) return json({ error: "요청한 API를 찾을 수 없어요." }, 404)
      if (request.method !== "POST" && request.method !== "GET") return json({ error: "지원하지 않는 요청이에요." }, 405)
      let game = await getGame(env.DB, match[1])
      if (!game) return json({ error: "게임을 찾을 수 없어요. 새 게임을 시작해 주세요." }, 404)
      if (game.status === "active" && receivedAt >= game.deadline) game = await finish(env.DB, game, "timeout")
      if (request.method === "GET" && !match[2]) return json({ game: snapshot(game, now()) })
      if (request.method !== "POST") return json({ error: "지원하지 않는 요청이에요." }, 405)
      const body = await readBody(request)

      if (match[2] === "words") {
        if (game.status !== "active") return json({ game: snapshot(game, now()), error: "경기가 종료됐어요." }, 409)
        if (body.revision !== game.revision) return json({ game: snapshot(game, now()), error: "현재 차례를 다시 확인해 주세요." }, 409)
        if (typeof body.word !== "string" || body.word.length > 100) return json({ error: "단어를 확인해 주세요." }, 400)
        const word = body.word.trim().normalize("NFC")
        const words: string[] = JSON.parse(game.words)
        const move = engine.evaluateMove(words.at(-1), word, words)
        if ("error" in move) {
          const penalty = Math.min(game.score, getWrongPenalty(game.streak))
          const updated = await env.DB.prepare("UPDATE games SET score = score - ?, last_gain = ?, streak = 0, mistakes = mistakes + 1, revision = revision + 1 WHERE id = ? AND revision = ? AND status = 'active'").bind(penalty, -penalty, game.id, game.revision).run()
          game = (await getGame(env.DB, game.id))!
          return json({ game: snapshot(game, now()), error: move.error }, updated.meta.changes ? 422 : 409)
        }
        const nextWords = [...words, word, move.botWord]
        const deadline = now() + getTurnDurationMs(nextWords.length / 2)
        const gain = getWordPoints(word, game.deadline - receivedAt, game.streak).total
        const updated = await env.DB.prepare("UPDATE games SET words = ?, score = score + ?, last_gain = ?, revision = revision + 1, streak = streak + 1, deadline = ? WHERE id = ? AND revision = ? AND status = 'active'").bind(JSON.stringify(nextWords), gain, gain, deadline, game.id, game.revision).run()
        game = (await getGame(env.DB, game.id))!
        if (!updated.meta.changes) return json({ game: snapshot(game, now()), error: "이미 처리된 차례예요." }, 409)
        return json({ game: snapshot(game, now()) })
      }

      if (match[2] === "finish") {
        if (body.reason !== "timeout" && body.reason !== "forfeit") return json({ error: "종료 사유를 확인해 주세요." }, 400)
        if (game.status === "active" && body.reason === "forfeit") game = await finish(env.DB, game, "forfeit")
        // An early client timer cannot end a live game or submit an unearned score.
        return json({ game: snapshot(game, now()) })
      }

      if (match[2] === "ranking") {
        if (game.status !== "finished") return json({ error: "경기가 끝나야 등록할 수 있어요." }, 409)
        return register(env.DB, game.id, body.nickname, body.phone)
      }
      return json({ error: "요청한 API를 찾을 수 없어요." }, 404)
    } catch (error) {
      if (error instanceof SyntaxError || (error instanceof Error && error.message === "body")) return json({ error: "요청 내용을 확인해 주세요." }, 400)
      console.error("Game API failed", error)
      return json({ error: "서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요." }, 503)
    }
  }
}
