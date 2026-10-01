import { useEffect, useRef, useState, type FormEvent } from "react"

import { getWordPoints } from "../shared/game"

type Props = {
  onSubmit: (word: string) => boolean | Promise<boolean>
  disabled: boolean
  error: string
  remainingMs: number
  streak: number
  onEdit: () => void
}

const WordInput = ({ onSubmit, disabled, error, remainingMs, streak, onEdit }: Props) => {
  const [text, setText] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const composingRef = useRef(false)
  const submittingRef = useRef(false)

  useEffect(() => {
    if (!disabled) inputRef.current?.focus({ preventScroll: true })
  }, [disabled])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const word = text.trim()
    if (!word || disabled || submittingRef.current || composingRef.current) return
    submittingRef.current = true
    setIsSubmitting(true)
    try {
      await onSubmit(word)
      setText("")
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    }
  }

  return (
    <form className="word-form" onSubmit={handleSubmit}>
      <div className={`input-row ${error ? "input-row-error" : ""}`}>
        <label className="word-input-wrap">
          <span className="sr-only">단어 입력</span>
          <input
            ref={inputRef}
            value={text}
            onChange={(event) => { setText(event.target.value); onEdit() }}
            maxLength={100}
            onCompositionStart={() => { composingRef.current = true }}
            onCompositionEnd={() => { composingRef.current = false }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || composingRef.current)) event.preventDefault()
            }}
            placeholder="단어를 입력하세요"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={disabled || isSubmitting}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "word-error" : undefined}
          />
        </label>
        <button className="submit-button" type="submit" disabled={disabled || isSubmitting || !text.trim()}>
          <span>{isSubmitting ? "확인 중" : "잇기"}</span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg>
        </button>
      </div>
      {text.trim() && !error && <p className="point-preview">예상 +{getWordPoints(text.trim(), remainingMs, streak).total}점 <span>글자 {getWordPoints(text.trim(), remainingMs, streak).lengthPoints} + 길이 {getWordPoints(text.trim(), remainingMs, streak).lengthBonus} + 시간 {getWordPoints(text.trim(), remainingMs, streak).timePoints} + 연속 {getWordPoints(text.trim(), remainingMs, streak).comboPoints}</span></p>}
      {error && <p className="word-error" id="word-error" role="alert">{error}</p>}
    </form>
  )
}

export default WordInput
