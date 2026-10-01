import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import WordInput from "./WordInput"
import WordList from "./WordList"
import RankingList from "./RankingList"
import ResultScreen from "./ResultScreen"
import { getTurnDurationMs, getWordPoints, type RankingEntry } from "../shared/game"
import { createLocalRun, finishLocalRun, submitLocalWord, runVersion, RULES_VERSION, type LocalRun } from "../shared/run"
import { getAllowedInitials } from "./utils/WordChain"
import { connectionState, loadLocalEngine, persistRun, prepareOfflineShell, queueRanking, registrationFor, restoreRun, setLocalMode, syncRankings } from "./utils/Offline"
import type { WordEngine } from "../worker/engine"

const Arrow = () => <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg>

const App = () => {
  const [run, setRun] = useState<LocalRun | null>(restoreRun)
  const [clock, setClock] = useState(Date.now)
  const [pending, setPending] = useState(false)
  const [ready, setReady] = useState(false)
  const [dictionaryLoading, setDictionaryLoading] = useState(true)
  const [offlineReady, setOfflineReady] = useState(false)
  const [connection, setConnection] = useState(connectionState)
  const [error, setError] = useState("")
  const [registered, setRegistered] = useState<RankingEntry | null>(null)
  const [nickname, setNickname] = useState(() => { try { return localStorage.getItem("wordchain-nickname") || "" } catch { return "" } })
  const [phone, setPhone] = useState("")
  const rulesRef = useRef<HTMLDialogElement>(null)
  const engineRef = useRef<WordEngine | null>(null)
  const engineVersionRef = useRef<number | null>(null)
  const runRef = useRef(run)
  const generation = useRef(0)
  const data = run?.game
  const game = run
  const words = data?.words ?? []
  const lastWord = words.at(-1)
  const requiredLetter = lastWord?.at(-1)
  const allowedInitials = requiredLetter ? getAllowedInitials(requiredLetter) : []
  const remainingMs = run ? Math.max(0, data!.turnDurationMs - Math.max(run.lastElapsedMs, clock - run.turnStartedAt)) : 12000
  const isFinished = data?.status === "finished"
  const lastAttempt = run?.attempts.at(-1)
  const breakdown = data && data.lastGain > 0 && lastAttempt ? getWordPoints(lastAttempt.word, getTurnDurationMs(data.rounds - 1) - lastAttempt.elapsedMs, data.streak - 1) : null

  useEffect(() => {
    let cancelled = false
    const version = runVersion(runRef.current)
    const initialGeneration = generation.current
    void loadLocalEngine(version).then((engine) => { if (!cancelled && generation.current === initialGeneration) { engineRef.current = engine; engineVersionRef.current = version; setReady(true) } }).catch((cause) => { if (!cancelled && generation.current === initialGeneration) setError(cause instanceof Error ? cause.message : "사전 준비에 실패했어요. 다시 준비해 주세요.") }).finally(() => { if (!cancelled) setDictionaryLoading(false) })
    void prepareOfflineShell().then((saved) => { if (!cancelled) setOfflineReady(saved) }).catch(() => { /* The dictionary still supports this open page offline. */ })
    const update = () => setConnection(connectionState())
    const reconnect = () => { void syncRankings() }
    const offline = () => setConnection({ ...connectionState(), connected: false })
    window.addEventListener("wordchain-sync", update)
    window.addEventListener("online", reconnect)
    window.addEventListener("offline", offline)
    const timer = window.setInterval(reconnect, 30000)
    reconnect()
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("wordchain-sync", update); window.removeEventListener("online", reconnect); window.removeEventListener("offline", offline); window.speechSynthesis?.cancel() }
  }, [])

  useEffect(() => {
    if (!data || !isFinished) return
    let cancelled = false
    const update = () => { void registrationFor(data.id).then((entry) => { if (!cancelled) setRegistered(entry) }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "기록 저장 공간을 확인해 주세요.") }) }
    update()
    window.addEventListener("wordchain-sync", update)
    return () => { cancelled = true; window.removeEventListener("wordchain-sync", update) }
  }, [data, isFinished])

  const commitRun = useCallback((next: LocalRun | null) => {
    runRef.current = next
    persistRun(next)
    setRun(next)
    setClock(Date.now())
  }, [])

  const reset = () => { generation.current++; setError(""); setRegistered(null); setPhone(""); setPending(false); window.speechSynthesis?.cancel() }
  const startGame = async () => {
    reset()
    const current = generation.current
    if (!engineRef.current || engineVersionRef.current !== RULES_VERSION) {
      setPending(true)
      try {
        const engine = await loadLocalEngine()
        if (current !== generation.current) return
        engineRef.current = engine; engineVersionRef.current = RULES_VERSION; setReady(true)
      }
      catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : "사전 준비에 실패했어요. 다시 준비해 주세요."); return }
      finally { if (current === generation.current) setPending(false) }
    }
    if (current === generation.current) commitRun(createLocalRun(crypto.randomUUID(), Date.now()))
  }
  const goHome = () => { reset(); commitRun(null) }
  const finishGame = useCallback((reason: "timeout" | "forfeit") => {
    const current = runRef.current
    if (!current || current.game.status === "finished") return
    commitRun(finishLocalRun(current, reason, Date.now() - current.turnStartedAt))
    setError("")
  }, [commitRun])

  useEffect(() => {
    if (!run || isFinished) return
    const interval = window.setInterval(() => setClock(Date.now()), 50)
    return () => window.clearInterval(interval)
  }, [run, isFinished])
  useEffect(() => {
    if (!run || isFinished || remainingMs > 0) return
    const timer = window.setTimeout(() => finishGame("timeout"), 0)
    return () => window.clearTimeout(timer)
  }, [run, isFinished, remainingMs, finishGame])

  const handleSubmit = (text: string) => {
    const current = runRef.current
    if (!current || current.game.status === "finished" || !engineRef.current) return false
    if (current.attempts.length >= 2000) { finishGame("forfeit"); return false }
    const result = submitLocalWord(current, text, Date.now() - current.turnStartedAt, engineRef.current)
    commitRun(result.run)
    setError(result.error || "")
    return !result.error
  }

  const registerRanking = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!run || pending || registered) return
    const current = generation.current
    setPending(true)
    setError("")
    try {
      const entry = await queueRanking(run, nickname, phone)
      if (current === generation.current) { setRegistered(entry); setPhone("") }
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : "기기에 기록을 저장하지 못했어요.")
    } finally { if (current === generation.current) setPending(false) }
  }

  const readLastWord = () => {
    if (!lastWord) return
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) { setError("이 브라우저는 단어 읽기를 지원하지 않아요."); return }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(lastWord)
    utterance.lang = "ko-KR"
    utterance.rate = .9
    window.speechSynthesis.speak(utterance)
  }

  return <div className={`app-shell ${isFinished ? "app-results" : ""}`}>
    <header className="site-header">
      <button className="brand" onClick={goHome} aria-label="끝말잇기 홈"><span className="brand-mark" aria-hidden="true">↗</span><span>TAPIE<span className="brand-divider">/</span>끝말잇기</span></button>
      {game ? <button className="text-button" onClick={goHome}>홈으로 <Arrow /></button> : <button className="text-button" onClick={() => rulesRef.current?.showModal()}>게임 방법 <span className="help-icon" aria-hidden="true">?</span></button>}
    </header>
    <main id="main">
      <div className="connection-bar"><span role="status">{!ready ? dictionaryLoading || pending ? "사전 준비 중" : "사전 준비 실패" : connection.manual || !connection.connected ? "로컬 모드 · 기록은 기기에 저장" : offlineReady ? "오프라인 준비 완료" : "기기에서 플레이"}</span><button className="local-toggle" role="switch" aria-label="로컬 모드 고정" aria-checked={connection.manual} onClick={() => setLocalMode(!connection.manual)}>로컬 고정 <span aria-hidden="true">{connection.manual ? "켜짐" : "꺼짐"}</span></button></div>
      {!game ? <section className="home-screen" aria-labelledby="home-title">
        <div className="hero"><div className="hero-copy"><h1 id="home-title">끝말잇기.<br />내 기록은 어디까지?</h1><p>빠르게 이어갈수록, 길게 입력할수록 더 높은 점수.</p><button className="button-dark primary-start" onClick={() => { void startGame() }} disabled={pending || dictionaryLoading}>{pending || dictionaryLoading ? "사전 준비 중" : !ready ? "사전 다시 준비" : "시작하기"}<Arrow /></button>{error && <p className="word-error" role="alert">{error}</p>}</div>
          <div className="word-art" aria-hidden="true"><div className="art-word art-word-first"><span>사</span><span className="art-dark">과</span></div><span className="art-connector">↘</span><div className="art-word art-word-second"><span className="art-outline">과</span><span className="art-dark">일</span></div><span className="art-connector art-connector-second">↘</span><div className="art-word art-word-third"><span className="art-outline">일</span><span>기</span></div></div>
        </div>
        <RankingList />
      </section> : isFinished ? <ResultScreen game={data!} registered={registered} nickname={nickname} phone={phone} pending={pending} error={error} onNickname={(value) => { setNickname(value); setError("") }} onPhone={(value) => { setPhone(value); setError("") }} onRegister={(event) => { void registerRanking(event) }} onRestart={() => { void startGame() }} onHome={goHome} /> : <section className="game-screen" aria-labelledby="game-title">
        <div className="game-heading"><h1 id="game-title">끝말잇기<span className="round-label">라운드 {String(data!.rounds + 1).padStart(2, "0")}</span></h1><button className="text-button" disabled={pending} onClick={() => { void startGame() }}>새 게임 <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 5v6h-6M20 11a8 8 0 1 0-1 6" /></svg></button></div>
        <div className="game-layout"><div className="play-column">
          <div className="scoreboard survival-score" aria-label="현재 점수"><span>내 점수</span><strong aria-live="polite">{data!.score.toLocaleString()}<span>점</span></strong>{data!.lastGain !== 0 && <span className="score-gain" key={data!.revision}>{data!.lastGain > 0 ? "+" : ""}{data!.lastGain}</span>}<span className="bot-opponent">상대 테이피</span></div>
          {breakdown && <p className="score-details">글자 {breakdown.lengthPoints} · 길이 보너스 {breakdown.lengthBonus} · 시간 {breakdown.timePoints} · 연속 {breakdown.comboPoints}</p>}
          <div className={`game-board ${isFinished ? "game-board-finished" : ""} ${remainingMs <= 3000 && !isFinished && !pending ? "game-board-urgent" : ""}`}>
            <div className="board-top"><span className="turn-status" role="status">{isFinished ? "경기 종료" : pending ? "테이피 생각 중" : "내 차례"}{pending && <span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>}</span>{!isFinished && <span className="timer" aria-label={`제한 시간 ${data!.turnDurationMs / 1000}초`}><strong aria-hidden="true">{(remainingMs / 1000).toFixed(1)}</strong><span aria-hidden="true">초</span></span>}</div>
            {<div className="word-prompt"><p>{requiredLetter ? "이 글자로 이어주세요" : "어떤 단어든 좋아요"}</p><strong className={requiredLetter ? "required-letter" : "first-word"}>{requiredLetter ?? "첫 단어"}</strong>{allowedInitials.length > 1 && <span className="allowed-initials">{allowedInitials.join(" · ")} 시작 가능</span>}{lastWord && <div className="previous-word"><span>이전 단어</span><strong>{lastWord}</strong><button onClick={readLastWord} aria-label={`이전 단어 ${lastWord} 읽기`}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m11 5-5 4H3v6h3l5 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></svg></button></div>}</div>}
            {!isFinished && <div className="time-track" role="progressbar" aria-label="남은 시간" aria-valuemin={0} aria-valuemax={data!.turnDurationMs} aria-valuenow={Math.ceil(remainingMs)} aria-valuetext={`${(remainingMs / 1000).toFixed(1)}초 남음`}><span style={{ transform: `scaleX(${remainingMs / data!.turnDurationMs})` }} /></div>}
          </div>
          {!isFinished && <WordInput key={data!.id} onSubmit={handleSubmit} disabled={!ready || pending || remainingMs === 0} error={error} remainingMs={remainingMs} streak={data!.streak} onEdit={() => setError("")} />}
          <div className="game-actions">{!isFinished && <><span className="pace-note">{data!.turnDurationMs > 3000 ? `${2 - data!.rounds % 2}라운드 뒤 ${Math.max(3, data!.turnDurationMs / 1000 - 2)}초` : "최종 속도 · 3초"}</span><button className="text-button muted-button" disabled={pending} onClick={() => { void finishGame("forfeit") }}>기권하기</button></>}</div>
        </div><aside className="history-column" aria-labelledby="history-title"><div className="history-heading"><h2 id="history-title">이어진 단어</h2><span>{words.length}</span></div><WordList words={words} /></aside></div>
      </section>}
    </main>
    <dialog className="rules-dialog" ref={rulesRef} aria-labelledby="rules-title" onClick={(event) => { if (event.target === event.currentTarget) rulesRef.current?.close() }}><div className="dialog-heading"><h2 id="rules-title">게임 방법</h2><button className="close-button" onClick={() => rulesRef.current?.close()} aria-label="게임 방법 닫기">×</button></div><ol><li>두 글자 이상의 한글 단어를 입력하세요.</li><li>앞 단어의 마지막 글자로 이어주세요. 중복과 한방 단어는 사용할 수 없어요.</li><li>글자당 10점 + 긴 단어 보너스(최대 40점) + 남은 시간 0.1초당 1점 + 연속 성공 보너스(최대 30점)가 쌓여요.</li><li>오답은 15점 + 현재 연속 성공당 3점(최대 45점)을 감점하고 연속 성공을 초기화해요. 시간은 늘어나지 않아요.</li><li>한 번 준비하면 인터넷 없이도 플레이할 수 있어요. 로컬 모드에서 저장한 기록은 연결이 돌아오면 자동 등록돼요.</li></ol><p>12초로 시작해 2라운드마다 2초씩, 최소 3초까지 줄어들어요. 테이피는 반드시 답하니 끝까지 버티며 최고 점수에 도전하세요.</p><button className="button-dark" onClick={() => rulesRef.current?.close()}>알겠어요 <Arrow /></button></dialog>
  </div>
}

export default App
