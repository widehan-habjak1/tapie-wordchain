import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import test from "node:test"
import { getTurnDurationMs, getWordPoints, type GameSnapshot } from "../shared/game.ts"
import { isValidWord } from "../shared/rules.ts"
import { createApi, type Env } from "../worker/api.ts"
import { createWordEngine } from "../worker/engine.ts"

const fixtureWords = ["사과", "과쁨", "과일", "일기", "기차", "차표", "표사", "기쁨"]
const engine = createWordEngine(fixtureWords, () => 0)
const migration = ["0001_game_rankings.sql", "0002_scoring.sql", "0003_registration_contacts.sql"].map((file) => readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8")).join("\n")

const harness = (replayEngine?: (version: number) => ReturnType<typeof createWordEngine>) => {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(migration)
  const prepare = (sql: string, params: SQLInputValue[] = []) => ({
    bind: (...values: SQLInputValue[]) => prepare(sql, values),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) } }),
  })
  const env = { DB: { prepare } as unknown as D1Database, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher } satisfies Env
  let clock = 0
  const api = createApi(engine, () => clock, replayEngine)
  const send = async (path: string, body?: unknown) => {
    if (body && typeof body === "object" && "nickname" in body) body = { phone: "010-0000-0000", ...body }
    const response = await api(new Request(`https://game.test/api/${path}`, {
      method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env)
    return { status: response.status, body: await response.json() as { game: GameSnapshot; error: string; entry: { rank: number; nickname: string; score: number }; rankings: { rank: number; nickname: string; score: number }[] } }
  }
  return { sqlite, api, env, send, time: (value: number) => { clock = value } }
}

const start = async (app: ReturnType<typeof harness>) => (await app.send("games", {})).body.game
const move = (app: ReturnType<typeof harness>, game: GameSnapshot, word = "사과") => app.send(`games/${game.id}/words`, { word, revision: game.revision })

test("time gets shorter every two rounds, reaching three seconds at round eleven", () => {
  for (const [completed, ms] of [[0, 12000], [1, 12000], [2, 10000], [4, 8000], [6, 6000], [8, 4000], [10, 3000], [100, 3000]]) assert.equal(getTurnDurationMs(completed), ms)
})
test("points combine length, long-word bonus, tenths of seconds and streaks", () => {
  assert.deepEqual(getWordPoints("사과", 11500), { lengthPoints: 20, lengthBonus: 0, timePoints: 115, comboPoints: 0, total: 135 })
  assert.equal(getWordPoints("사과".normalize("NFD"), 11500).total, 135)
  assert.equal(getWordPoints("끝말잇기", 8000).total, 128)
  assert.equal(getWordPoints("사과", -100).timePoints, 0)
})
test("one-shot words and duplicate-exhausted replies are rejected", () => {
  assert.match((engine.evaluateMove(undefined, "기쁨", []) as { error: string }).error, /한방/)
  assert.match((engine.evaluateMove(undefined, "사과", ["과일"]) as { error: string }).error, /한방/)
})
test("the bot also avoids dead-end words and makes a legal, unused reply", () => {
  assert.deepEqual(engine.evaluateMove(undefined, "사과", []), { botWord: "과일" })
  assert.deepEqual(engine.evaluateMove("과일", "일기", ["사과", "과일"]), { botWord: "기차" })
})
test("the existing dictionary syntax and duplicate rules stay in force", () => {
  assert.ok(isValidWord(undefined, "a", []))
  assert.ok(isValidWord(undefined, "가", []))
  assert.ok(isValidWord("사과", "사과", ["사과"]))
  assert.ok(isValidWord("사과", "바나나", []))
  assert.equal(isValidWord("소녀", "여행".normalize("NFD"), []), null)
})
test("start returns a server-owned session with a twelve second deadline", async () => {
  const app = harness()
  const response = await app.send("games", {})
  assert.equal(response.status, 201)
  assert.equal(response.body.game.status, "active")
  assert.equal(response.body.game.remainingMs, 12000)
  assert.equal(response.body.game.score, 0)
  assert.match(response.body.game.id, /^[a-f0-9-]{36}$/)
})
test("one accepted word adds a bot reply and server-calculated live points", async () => {
  const app = harness(); const game = await start(app)
  app.time(1000)
  const response = await move(app, game)
  assert.equal(response.status, 200)
  assert.deepEqual(response.body.game.words, ["사과", "과일"])
  assert.equal(response.body.game.score, 130)
  assert.equal(response.body.game.lastGain, 130)
  assert.equal(response.body.game.revision, 1)
  assert.equal(response.body.game.remainingMs, 12000)
  app.time(3000)
  const next = await move(app, response.body.game, "일기")
  assert.equal(next.body.game.score, 253)
  assert.equal(next.body.game.turnDurationMs, 10000)
})
test("invalid and one-shot input never adds points or resets the deadline", async () => {
  const app = harness(); let game = await start(app)
  app.time(4000)
  for (const word of ["기쁨", "없는말", "a"]) {
    const response = await move(app, game, word)
    assert.equal(response.status, 422)
    assert.equal(response.body.game.score, 0)
    assert.equal(response.body.game.remainingMs, 8000)
    assert.deepEqual(response.body.game.words, [])
    game = response.body.game
  }
})
test("replayed and simultaneous move requests only count once", async () => {
  const app = harness(); const game = await start(app)
  app.time(1000)
  const responses = await Promise.all([move(app, game), move(app, game)])
  assert.deepEqual(responses.map((item) => item.status).sort(), [200, 409])
  const saved = (await app.send(`games/${game.id}`)).body.game
  assert.equal(saved.score, 130)
  assert.equal(saved.words.length, 2)
  assert.equal((await move(app, game)).status, 409)
})
test("late moves lose without appending words or points", async () => {
  const app = harness(); const game = await start(app)
  app.time(12000)
  const response = await move(app, game)
  assert.equal(response.status, 409)
  assert.equal(response.body.game.status, "finished")
  assert.equal(response.body.game.reason, "timeout")
  assert.equal(response.body.game.score, 0)
})
test("a client cannot force an early timeout or register a still-active game", async () => {
  const app = harness(); const game = await start(app)
  const played = (await move(app, game)).body.game
  const response = await app.send(`games/${game.id}/finish`, { reason: "timeout" })
  assert.equal(response.body.game.status, "active")
  assert.equal((await app.send(`games/${game.id}/ranking`, { nickname: "테스트", score: played.score })).status, 409)
})
test("forfeit keeps the earned points but subsequent moves are rejected", async () => {
  const app = harness(); const game = (await move(app, await start(app))).body.game
  const finished = (await app.send(`games/${game.id}/finish`, { reason: "forfeit" })).body.game
  assert.equal(finished.status, "finished")
  assert.equal(finished.reason, "forfeit")
  assert.equal(finished.score, 140)
  assert.equal((await move(app, game, "일기")).status, 409)
})
test("ranking ignores client scores and uses only the finished session's score", async () => {
  const app = harness(); let game = await start(app); app.time(1000)
  game = (await move(app, game)).body.game
  await app.send(`games/${game.id}/finish`, { reason: "forfeit" })
  const response = await app.send(`games/${game.id}/ranking`, { nickname: "테스트", score: 999999, words: ["가짜"] })
  assert.equal(response.status, 200)
  assert.equal(response.body.entry.score, 130)
  assert.equal(response.body.entry.rank, 1)
  assert.equal(response.body.rankings[0].score, 130)
})
test("registration is idempotent and cannot rename a completed record", async () => {
  const app = harness(); const game = (await move(app, await start(app))).body.game
  await app.send(`games/${game.id}/finish`, { reason: "forfeit" })
  await app.send(`games/${game.id}/ranking`, { nickname: "첫이름" })
  const again = await app.send(`games/${game.id}/ranking`, { nickname: "새이름" })
  assert.equal(again.body.entry.nickname, "첫이름")
  assert.equal(again.body.rankings.length, 1)
  assert.equal((await app.send(`games/${game.id}`)).body.game.ranked, true)
})
test("same-score records use registration time to break ties", async () => {
  const app = harness()
  for (const [offset, nickname] of [[0, "먼저"], [10000, "나중"]] as const) {
    app.time(offset); const game = await start(app)
    app.time(offset + 1000); await move(app, game)
    await app.send(`games/${game.id}/finish`, { reason: "forfeit" })
    await app.send(`games/${game.id}/ranking`, { nickname })
  }
  const list = (await app.send("rankings")).body.rankings
  assert.deepEqual(list.map((row) => row.nickname), ["먼저", "나중"])
  assert.deepEqual(list.map((row) => row.score), [130, 130])
})
test("zero-score finished games can register but invalid nicknames are rejected", async () => {
  const app = harness(); const empty = await start(app)
  await app.send(`games/${empty.id}/finish`, { reason: "forfeit" })
  assert.equal((await app.send(`games/${empty.id}/ranking`, { nickname: "이름" })).status, 200)
  const played = (await move(app, await start(app))).body.game
  await app.send(`games/${played.id}/finish`, { reason: "forfeit" })
  for (const nickname of ["", "<script>", "너무긴닉네임이름입니다아아아아"]) assert.equal((await app.send(`games/${played.id}/ranking`, { nickname })).status, 400)
})
test("rankings include only twenty entries in score order", async () => {
  const app = harness()
  for (let i = 0; i < 25; i++) {
    const id = crypto.randomUUID()
    app.sqlite.prepare("INSERT INTO games (id, deadline, created_at, status, score) VALUES (?, 0, 0, 'finished', ?)").run(id, i + 1)
    app.sqlite.prepare("INSERT INTO rankings VALUES (?, ?, ?, ?)").run(id, `이름${i}`, i + 1, i)
  }
  const response = await app.send("rankings")
  assert.equal(response.body.rankings.length, 20)
  assert.equal(response.body.rankings[0].score, 25)
  assert.equal(response.body.rankings.at(-1)?.score, 6)
})
test("missing API paths return JSON and malformed requests are rejected", async () => {
  const app = harness(); const game = await start(app)
  assert.equal((await app.send("does-not-exist")).status, 404)
  const malformed = await app.api(new Request(`https://game.test/api/games/${game.id}/words`, { method: "POST", body: "{" }), app.env)
  assert.equal(malformed.status, 400)
  assert.equal((await app.send(`games/${game.id}/finish`, { reason: "win" })).status, 400)
})

test("wrong submissions deduct points once, reset streak and keep the deadline", async () => {
  const app = harness()
  let game = (await move(app, await start(app))).body.game
  app.time(1000)
  const bad = await move(app, game, "없는말")
  assert.equal(bad.status, 422)
  assert.equal(bad.body.game.score, 122)
  assert.equal(bad.body.game.lastGain, -18)
  assert.equal(bad.body.game.streak, 0)
  assert.equal(bad.body.game.mistakes, 1)
  assert.equal(bad.body.game.rounds, 1)
  assert.equal(bad.body.game.remainingMs, 11000)
  assert.equal((await move(app, game, "없는말")).status, 409)
  game = bad.body.game
  const good = await move(app, game, "일기")
  assert.equal(good.body.game.score, 252)
  assert.equal(good.body.game.streak, 1)
  assert.equal(good.body.game.turnDurationMs, 10000)
})

test("offline ranking replays words and penalties instead of accepting the client score", async () => {
  const { createLocalRun, submitLocalWord, finishLocalRun, getTranscript } = await import("../shared/run.ts")
  const app = harness()
  let run = createLocalRun(crypto.randomUUID(), 0)
  run = submitLocalWord(run, "사과", 1000, engine).run
  run = submitLocalWord(run, "없는말", 1000, engine).run
  run = finishLocalRun(run, "forfeit", 2000)
  const response = await app.send("local-ranking", { nickname: "오프라인", transcript: getTranscript(run), score: 999999 })
  assert.equal(response.status, 200)
  assert.equal(response.body.entry.score, 112)
  const replay = await app.send("local-ranking", { nickname: "변경", transcript: getTranscript(run) })
  assert.equal(replay.body.rankings.length, 1)
  assert.equal(replay.body.entry.nickname, "오프라인")
})
test("offline ranking rejects a forged timeout and invalid transcript", async () => {
  const app = harness()
  for (const transcript of [{}, { version: 2, id: crypto.randomUUID(), attempts: [{ word: "사과", elapsedMs: -100 }], reason: "forfeit", finishElapsedMs: 0 }, { version: 2, id: crypto.randomUUID(), attempts: [], reason: "timeout", finishElapsedMs: 1 }]) {
    assert.equal((await app.send("local-ranking", { nickname: "잘못된기록", transcript })).status, 400)
  }
  assert.equal((await app.send("rankings")).body.rankings.length, 0)
})

test("old and expanded dictionary records are registered using their original engine", async () => {
  const { createLocalRun, submitLocalWord, finishLocalRun, getTranscript } = await import("../shared/run.ts")
  const expanded = createWordEngine([...fixtureWords, "과자", "자기"])
  const app = harness((version) => version === 2 ? engine : expanded)
  for (const version of [2, 3]) {
    const selected = version === 2 ? engine : expanded
    let run = createLocalRun(crypto.randomUUID(), 0, version)
    run = submitLocalWord(run, "과자", 1000, selected).run
    run = finishLocalRun(run, "forfeit", 1000)
    const response = await app.send("local-ranking", { nickname: `사전${version}`, transcript: getTranscript(run) })
    assert.equal(response.status, 200)
    assert.equal(response.body.entry.score, version === 2 ? 0 : 130)
  }
})

test("phone numbers are required, normalized, private, and immutable on replay", async () => {
  const app = harness()
  const game = (await move(app, await start(app))).body.game
  await app.send(`games/${game.id}/finish`, { reason: "forfeit" })
  for (const phone of [undefined, "", "123", "abc01012345678", "010<script>"]) {
    assert.equal((await app.send(`games/${game.id}/ranking`, { nickname: "연락처검증", phone })).status, 400)
  }
  const response = await app.send(`games/${game.id}/ranking`, { nickname: "연락처검증", phone: "010-0000-0000" })
  assert.equal(response.status, 200)
  assert.equal(app.sqlite.prepare("SELECT phone FROM ranking_contacts WHERE game_id = ?").get(game.id)?.phone, "01000000000")
  assert.equal(JSON.stringify(response.body).includes("01000000000"), false)
  assert.equal(JSON.stringify((await app.send("rankings")).body).includes("phone"), false)
  await app.send(`games/${game.id}/ranking`, { nickname: "다른이름", phone: "010-1111-1111" })
  assert.equal(app.sqlite.prepare("SELECT phone FROM ranking_contacts WHERE game_id = ?").get(game.id)?.phone, "01000000000")
})
test("a zero-score offline finish can save a nickname and private contact", async () => {
  const { createLocalRun, finishLocalRun, getTranscript } = await import("../shared/run.ts")
  const app = harness()
  const run = finishLocalRun(createLocalRun(crypto.randomUUID(), 0), "timeout", 12000)
  const response = await app.send("local-ranking", { nickname: "첫참여", phone: "010-0000-0000", transcript: getTranscript(run) })
  assert.equal(response.status, 200)
  assert.equal(response.body.entry.score, 0)
  assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS count FROM ranking_contacts").get()?.count, 1)
})

test("the contact migration preserves existing ranking entries", () => {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(["0001_game_rankings.sql", "0002_scoring.sql"].map((file) => readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8")).join("\n"))
  const id = crypto.randomUUID()
  sqlite.prepare("INSERT INTO games (id, deadline, created_at, status, score) VALUES (?, 0, 0, 'finished', 120)").run(id)
  sqlite.prepare("INSERT INTO rankings VALUES (?, '기존기록', 120, 1)").run(id)
  sqlite.exec(readFileSync(new URL("../migrations/0003_registration_contacts.sql", import.meta.url), "utf8"))
  assert.equal(sqlite.prepare("SELECT nickname FROM rankings WHERE game_id = ?").get(id)?.nickname, "기존기록")
  assert.equal(sqlite.prepare("SELECT score FROM rankings WHERE game_id = ?").get(id)?.score, 120)
})
