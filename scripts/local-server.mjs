import http from "node:http"
import path from "node:path"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import handler from "../api/dropbox-files.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, "..")
const publicRoot = path.join(projectRoot, "public")
const port = Number(process.env.PORT || 3000)

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
])

function asVercelResponse(res) {
  res.status = (statusCode) => {
    res.statusCode = statusCode
    return res
  }

  res.json = (payload) => {
    if (!res.headersSent) {
      res.setHeader("Content-Type", "application/json; charset=utf-8")
    }
    res.end(JSON.stringify(payload))
  }

  return res
}

async function parseRequestBody(req) {
  const chunks = []

  for await (const chunk of req) {
    chunks.push(chunk)
  }

  if (!chunks.length) return {}

  const rawBody = Buffer.concat(chunks).toString("utf8")
  if (!rawBody.trim()) return {}

  try {
    return JSON.parse(rawBody)
  } catch {
    return rawBody
  }
}

async function servePublicFile(res, url) {
  const pathname = url.pathname === "/" || url.pathname === "/docs"
    ? "/docs.html"
    : url.pathname
  const requestedPath = path.normalize(path.join(publicRoot, pathname))

  if (!requestedPath.startsWith(publicRoot)) {
    res.writeHead(403)
    res.end("Forbidden")
    return
  }

  try {
    const file = await readFile(requestedPath)
    const contentType = mimeTypes.get(path.extname(requestedPath)) || "application/octet-stream"
    res.writeHead(200, { "Content-Type": contentType })
    res.end(file)
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
    res.end("Not found")
  }
}

export function createLocalServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)

    try {
      if (url.pathname === "/api/dropbox-files") {
        req.query = Object.fromEntries(url.searchParams.entries())
        req.body = await parseRequestBody(req)
        await handler(req, asVercelResponse(res))
        return
      }

      await servePublicFile(res, url)
    } catch (error) {
      console.error(error)
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" })
      }
      res.end(JSON.stringify({ error: "Erreur serveur locale" }))
    }
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const server = createLocalServer()

  server.listen(port, () => {
    console.log(`Owlbear backend local: http://localhost:${port}`)
    console.log(`Documentation API:       http://localhost:${port}/docs`)
  })
}
