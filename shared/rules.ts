const HANGUL_BASE = 0xac00
const HANGUL_END = 0xd7a3
const SYLLABLES_PER_INITIAL = 21 * 28
const NIEUN_INDEX = 2
const RIEUL_INDEX = 5
const IEUNG_INDEX = 11
const NIEUN_TO_IEUNG_VOWELS = new Set([3, 6, 7, 12, 17, 20])

const replaceInitial = (syllable: string, initialIndex: number) => {
    const syllableIndex = syllable.charCodeAt(0) - HANGUL_BASE
    return String.fromCharCode(HANGUL_BASE + initialIndex * SYLLABLES_PER_INITIAL + syllableIndex % SYLLABLES_PER_INITIAL)
}

export const getAllowedInitials = (syllable: string) => {
    const code = syllable.charCodeAt(0)
    if (code < HANGUL_BASE || code > HANGUL_END) return [syllable]

    const syllableIndex = code - HANGUL_BASE
    const initialIndex = Math.floor(syllableIndex / SYLLABLES_PER_INITIAL)
    const vowelIndex = Math.floor((syllableIndex % SYLLABLES_PER_INITIAL) / 28)
    const allowed = [syllable]

    // 넓은 두음법칙: 람 → 남/암처럼 ㄹ은 ㄴ과 ㅇ으로도 이을 수 있다.
    if (initialIndex === RIEUL_INDEX) {
        allowed.push(replaceInitial(syllable, NIEUN_INDEX), replaceInitial(syllable, IEUNG_INDEX))
    } else if (initialIndex === NIEUN_INDEX && NIEUN_TO_IEUNG_VOWELS.has(vowelIndex)) {
        allowed.push(replaceInitial(syllable, IEUNG_INDEX))
    }

    return [...new Set(allowed)]
}

export const isValidWord = (prev: string | undefined, next: string, used: string[]) => {
    const normalizedNext = next.normalize("NFC")

    if (!/^[가-힣]{2,}$/u.test(normalizedNext)) {
        return "두 글자 이상의 한글 단어를 입력해 주세요."
    }
    if (used.some((word) => word.normalize("NFC") === normalizedNext)) {
        return "이미 나온 단어예요. 다른 단어를 입력해 주세요."
    }
    if (prev) {
        const finalSyllable = [...prev.normalize("NFC")].at(-1)!
        const allowedInitials = getAllowedInitials(finalSyllable)
        if (!allowedInitials.includes(normalizedNext[0])) {
            return `‘${allowedInitials.join("·")}’ 중 하나로 시작하는 단어를 입력해 주세요.`
        }
    }
    return null
}

