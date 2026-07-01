import { readFile } from "node:fs/promises"
import { createLocalServer } from "./local-server.mjs"

const openApiText = await readFile("public/openapi.json", "utf8")
JSON.parse(openApiText)

const server = createLocalServer()

await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", resolve)
})

try {
  const { port } = server.address()
  const docsResponse = await fetch(`http://127.0.0.1:${port}/docs`)
  const docsHtml = await docsResponse.text()
  const specResponse = await fetch(`http://127.0.0.1:${port}/openapi.json`)
  const specJson = await specResponse.json()

  if (!docsResponse.ok || !docsHtml.includes("Owlbear Soundboard API")) {
    throw new Error("/docs ne retourne pas la page attendue")
  }

  if (!specResponse.ok || !specJson.paths?.["/api/dropbox-files"]) {
    throw new Error("/openapi.json ne contient pas la route /api/dropbox-files")
  }

  console.log("docs ok")
  console.log("openapi ok")
} finally {
  await new Promise((resolve) => {
    server.close(resolve)
  })
}
