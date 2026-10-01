import { useEffect, useRef, type FormEvent } from "react"
import type { GameSnapshot, RankingEntry } from "../shared/game"

type Props = {
  game: GameSnapshot
  registered: RankingEntry | null
  nickname: string
  phone: string
  pending: boolean
  error: string
  onNickname: (value: string) => void
  onPhone: (value: string) => void
  onRegister: (event: FormEvent<HTMLFormElement>) => void
  onRestart: () => void
  onHome: () => void
}

const ResultScreen = ({ game, registered, nickname, phone, pending, error, onNickname, onPhone, onRegister, onRestart, onHome }: Props) => {
  const nicknameRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (!registered) nicknameRef.current?.focus({ preventScroll: true }) }, [registered])

  return <section className="result-screen" aria-labelledby="result-title">
    <div className="result-summary">
      <span className="result-eyebrow">경기 종료 · 테이피의 승리</span>
      <h1 id="result-title">이번 기록</h1>
      <strong className="final-score">{game.score.toLocaleString()}<span>점</span></strong>
      <dl className="result-stats"><div><dt>성공한 단어</dt><dd>{game.rounds}<span>개</span></dd></div><div><dt>오답</dt><dd>{game.mistakes}<span>회</span></dd></div></dl>
      <p>{game.reason === "forfeit" ? "기권으로 경기가 끝났어요." : "제한 시간이 끝났어요."}</p>
    </div>
    <div className="result-registration">
      {registered ? <div className="registration-success" role="status">
        <span className="registration-check" aria-hidden="true">↗</span>
        <h2>{registered.pending ? "기기에 기록을 저장했어요" : "랭킹 등록 완료"}</h2>
        {!registered.pending && <strong className="registered-rank">{registered.rank}<span>위</span></strong>}
        <p>{registered.nickname} · {registered.score.toLocaleString()}점</p>
        {registered.pending && <p>연결이 돌아오면 자동으로 등록해요.</p>}
        <button className="button-dark result-primary" onClick={onHome}>전체 랭킹 보기 <span aria-hidden="true">↗</span></button>
      </div> : <form className="result-form" onSubmit={onRegister}>
        <h2>기록을 남겨주세요</h2>
        <p className="registration-intro">닉네임과 전화번호를 입력하고 기록을 등록하세요.</p>
        <div className="registration-field"><label htmlFor="nickname">닉네임</label><input ref={nicknameRef} id="nickname" value={nickname} onChange={(event) => onNickname(event.target.value)} maxLength={12} placeholder="랭킹에 표시할 이름" autoComplete="nickname" required disabled={pending} /></div>
        <div className="registration-field"><label htmlFor="phone">전화번호</label><input id="phone" type="tel" inputMode="tel" value={phone} onChange={(event) => onPhone(event.target.value)} maxLength={25} placeholder="010-1234-5678" autoComplete="tel" required disabled={pending} /></div>
        <p className="contact-note">랭킹에는 닉네임과 점수만 공개돼요.</p>
        {error && <p className="word-error" role="alert">{error}</p>}
        <button className="button-dark result-primary" disabled={pending || !nickname.trim() || !phone.trim()}>{pending ? "기록 저장 중" : "기록 등록하기"}<span aria-hidden="true">↗</span></button>
      </form>}
      <div className="result-secondary"><button className="text-button" disabled={pending} onClick={onRestart}>다시하기 ↗</button><button className="text-button" disabled={pending} onClick={onHome}>홈으로</button></div>
    </div>
  </section>
}

export default ResultScreen
