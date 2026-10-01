import { useEffect, useState } from "react"
import type { RankingEntry } from "../shared/game"
import { cachedRankings, connectionState, pendingRankings, refreshRankings, syncRankings } from "./utils/Offline"

const RankingList = () => {
  const [entries, setEntries] = useState<RankingEntry[]>(cachedRankings)
  const [local, setLocal] = useState<RankingEntry[]>([])
  const [connection, setConnection] = useState(connectionState)
  useEffect(() => {
    let cancelled = false
    const update = () => {
      if (cancelled) return
      setEntries(cachedRankings()); setConnection(connectionState())
      void pendingRankings().then((records) => { if (!cancelled) setLocal(records) }).catch(() => { /* Public ranking remains available without local storage. */ })
    }
    update()
    void refreshRankings()
    window.addEventListener("wordchain-sync", update)
    return () => { cancelled = true; window.removeEventListener("wordchain-sync", update) }
  }, [])
  const offline = connection.manual || !connection.connected
  const list = [...local, ...entries]
  return <section className="ranking-section" aria-labelledby="ranking-title">
    <div className="ranking-heading"><h2 id="ranking-title">랭킹</h2><span>{offline ? "기기에 저장된 기록" : "최고 점수 TOP 20"}</span></div>
    {!list.length ? <p className="ranking-empty">{offline ? "연결되면 전체 랭킹을 갱신해요. 지금도 새 기록에 도전할 수 있어요." : "첫 번째 기록의 주인공이 되어보세요."}</p> :
      <ol className="ranking-list">{list.map((entry) => <li className="ranking-entry" key={`${entry.pending}-${entry.rank}-${entry.createdAt}-${entry.nickname}`}><span className={`ranking-position ${!entry.pending && entry.rank <= 3 ? "ranking-position-top" : ""}`}>{entry.pending ? "대기" : String(entry.rank).padStart(2, "0")}</span><strong>{entry.nickname}{entry.pending && <span className="pending-label">연결 시 자동 등록</span>}</strong><span className="ranking-score">{entry.score.toLocaleString()}<span>점</span></span></li>)}</ol>}
    {offline && !connection.manual && <button className="text-button" onClick={() => { void syncRankings() }}>연결 다시 확인 ↗</button>}
  </section>
}

export default RankingList
