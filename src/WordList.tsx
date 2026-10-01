const WordList = ({ words }: { words: string[] }) => {
  if (!words.length) return <div className="empty-history"><span aria-hidden="true">↗</span><p>첫 단어를 기다려요.</p></div>

  return (
    <ol className="word-list" reversed aria-label="최근 단어부터 표시">
      {[...words].reverse().map((word, reverseIndex) => {
        const index = words.length - reverseIndex - 1
        return (
          <li className={`word-entry ${reverseIndex === 0 ? "word-entry-latest" : ""}`} key={`${index}-${word}`}>
            <span className="entry-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <strong className="entry-word">{word.slice(0, -1)}<span>{word.at(-1)}</span></strong>
            <span className="entry-player">{index % 2 === 0 ? "나" : "테이피"}</span>
          </li>
        )
      })}
    </ol>
  )
}

export default WordList
