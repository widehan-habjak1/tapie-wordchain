import { readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

const KKUTU_COMMIT = "a2c240bc31fe2dea31d26fb1cf7625b4645556a6"
const OKT_COMMIT = "74cc4ae7d3dab232747cd5ddb723e4b73c476e4f"
const themes = new Set("IMS VOC KRR KTV NSK KOT DOT DRR DGM RAG LVL LOL MRN MMM MAP MKK MNG MOB HYK CYP HRH STA KGR ESB ELW OIM OVW NEX YRY KPO JLN JAN ZEL POK HAI HSS KMV HDC HOS 30 40 60 80 90 140 150 160 170 190 220 230 240 270 310 320 350 360 420 430 450 490 530 1001".split(" "))
export const normalizeEntry = (raw) => {
  if (typeof raw !== "string") return null
  const word = raw.trim().normalize("NFC")
  return /^[가-힣]{2,100}$/u.test(word) ? word : null
}

export const parseKkutuWords = (sql) => {
  const header = /COPY (?:public\.)?kkutu_ko \(_id, type, mean, hit, flag, theme\) FROM stdin;\r?\n/u.exec(sql)
  if (!header) throw new Error("KKuTu Korean COPY section is missing")
  const start = header.index + header[0].length
  const end = sql.indexOf("\n\\.", start)
  if (end < 0) throw new Error("KKuTu Korean COPY terminator is missing")
  const words = new Set()
  const excluded = new Set()
  for (const row of sql.slice(start, end).split(/\r?\n/u)) {
    const [rawWord, type, , , rawFlag, rawThemes = ""] = row.split("\t")
    if (!/^\d+$/u.test(rawFlag ?? "")) continue
    const word = normalizeEntry(rawWord)
    const flag = Number(rawFlag)
    if (!word || !Number.isInteger(flag)) continue
    if ((flag & 32) !== 0) { excluded.add(word); continue }
    const isNoun = /(^|,)1(,|$)/u.test(type) && (flag & (4 | 8 | 16)) === 0
    const isRecognizedTheme = rawThemes.split(",").some((theme) => themes.has(theme))
    if (isNoun || isRecognizedTheme) words.add(word)
  }
  for (const word of excluded) words.delete(word)
  return { words, excluded }
}

const download = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw new Error(`Source download failed: ${response.status} ${url}`)
  return response.text()
}
const hash = (text) => createHash("sha256").update(text).digest("hex")
const writeList = (file, header, words) => writeFile(new URL(`../${file}`, import.meta.url), `${header.join("\n")}\n${[...words].sort((a, b) => a.localeCompare(b, "ko")).join("\n")}\n`)

const main = async () => {
  // Source retrieval is explicit; normal builds use only checked-in lists.
  const { legacyDictionaryWords, excludedDictionaryWords } = await import("../dictionary.js")
  const legacy = new Set(legacyDictionaryWords)
  const kkutuUrl = `https://raw.githubusercontent.com/JJoriping/KKuTu/${KKUTU_COMMIT}/db.sql`
  const sourceSql = process.argv[2] ? await readFile(resolve(process.argv[2]), "utf8") : await download(kkutuUrl)
  const { words: kkutu, excluded } = parseKkutuWords(sourceSql)
  for (const word of excludedDictionaryWords) excluded.add(word)
  for (const word of excluded) kkutu.delete(word)
  for (const word of legacy) kkutu.delete(word)

  const files = ["nouns", "entities", "foreign", "fashion", "brand", "company_names", "geolocations", "kpop", "lol", "pokemon", "wikipedia_title_nouns"]
  const sources = await Promise.all(files.map(async (name) => {
    const url = `https://raw.githubusercontent.com/open-korean-text/open-korean-text/${OKT_COMMIT}/src/main/resources/org/openkoreantext/processor/util/noun/${name}.txt`
    const content = await download(url)
    return { name, url, content, sha256: hash(content) }
  }))
  const okt = new Set()
  for (const { content } of sources) for (const line of content.split(/\r?\n/u)) {
    const word = normalizeEntry(line)
    if (word && !legacy.has(word) && !kkutu.has(word) && !excluded.has(word)) okt.add(word)
  }
  await writeList("kkutu_extended_words.txt", ["# KKuTu recognized-theme and noun supplement", `# Source: https://github.com/JJoriping/KKuTu/tree/${KKUTU_COMMIT}`, "# All recognized Korean themes except OIJ; 2-100 NFC Hangul syllables; no North Korean entries"], kkutu)
  await writeList("open_korean_words.txt", ["# Open Korean Text noun supplement", `# Source: https://github.com/open-korean-text/open-korean-text/tree/${OKT_COMMIT}`, "# Apache-2.0; 2-100 NFC Hangul syllables; duplicates and North Korean entries removed", `# Files: ${files.join(", ")}`], okt)
  const removedLegacyWords = [...legacy].filter((word) => excluded.has(word))
  const manifest = { legacyWords: legacy.size, removedLegacyWords, kkutuAdded: kkutu.size, openKoreanAdded: okt.size, totalWords: legacy.size - removedLegacyWords.length + kkutu.size + okt.size, sources: [{ url: kkutuUrl, sha256: hash(sourceSql) }, ...sources.map(({ url, sha256 }) => ({ url, sha256 }))] }
  await writeFile(new URL("../dictionary-sources.json", import.meta.url), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(JSON.stringify(manifest, null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
