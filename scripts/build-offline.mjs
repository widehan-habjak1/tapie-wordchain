import { readdir, readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { createServiceWorker } from "./service-worker.mjs"

const root = new URL("../dist/client/", import.meta.url)
const assets = ["/", "/index.html", "/favicon.svg", "/dictionary.json", "/dictionary-v3.json", ...(await readdir(new URL("assets/", root))).map((file) => `/assets/${file}`)]
const digest = createHash("sha256")
for (const path of assets.filter((path) => path !== "/")) digest.update(await readFile(new URL(path.slice(1), root)))
digest.update(await readFile(new URL(import.meta.url)))
digest.update(await readFile(new URL("service-worker.mjs", import.meta.url)))
const version = digest.digest("hex").slice(0, 16)
await writeFile(new URL("sw.js", root), createServiceWorker(`tapie-shell-${version}`, assets))
console.log(`Offline shell: ${assets.length} assets, ${version}`)
