import http from "http"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.resolve(__dirname, "../public")

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
}

const server = http.createServer((req, res) => {
  let filePath = path.join(
    publicDir,
    req.url!.split("?")[0],
  )
  filePath = path.normalize(filePath)

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403)
    res.end("Forbidden")
    return
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end("Not found")
      return
    }
    const ext = path.extname(filePath)
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" })
    res.end(data)
  })
})

const PORT = 3000
server.listen(PORT, () => {
  console.log(`Web UI at http://localhost:${PORT}`)
})
