import dotenv from "dotenv"
dotenv.config()

const DROPBOX_API = "https://api.dropboxapi.com"
const DROPBOX_CONTENT_API = "https://content.dropboxapi.com"
const DROPBOX_TOKEN_URL = `${DROPBOX_API}/oauth2/token`
const DROPBOX_LIST_FOLDER = `${DROPBOX_API}/2/files/list_folder`
const DROPBOX_LIST_SHARED_LINKS = `${DROPBOX_API}/2/sharing/list_shared_links`
const DROPBOX_CREATE_LINK = `${DROPBOX_API}/2/sharing/create_shared_link_with_settings`

async function getAccessToken() {
  const credentials = Buffer.from(`${process.env.DROPBOX_APP_KEY}:${process.env.DROPBOX_APP_SECRET}`).toString("base64")
  const response = await fetch(DROPBOX_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: process.env.DROPBOX_REFRESH_TOKEN,
    }),
  })

  const data = await response.json()
  if (!data.access_token) {
    console.error("❌ Impossible d'obtenir un access_token :", data)
    throw new Error("Échec lors de l’obtention de l'access_token Dropbox")
  }
  return data.access_token
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")

  if (req.method === "OPTIONS") return res.status(200).end()

  // ---------------- LECTURE DES DOSSIERS & FICHIERS (GET) ----------------
  if (req.method === "GET") {
    try {
      const token = await getAccessToken()
      const currentPath = req.query.path && req.query.path !== "/" ? req.query.path : "/owlbear"

      // 1. Lister le contenu du répertoire cible
      const listRes = await fetch(DROPBOX_LIST_FOLDER, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: currentPath }),
      })

      const listData = await listRes.json()
      if (listData.error) return res.status(500).json({ error: listData.error })

      const isAudio = (file) => file[".tag"] === "file" && (file.name.endsWith(".mp3") || file.name.endsWith(".wav"))
      const isFolder = (file) => file[".tag"] === "folder"

      const folders = listData.entries.filter(isFolder).map(folder => ({
        name: folder.name,
        path: folder.path_lower,
        isFolder: true,
      }))

      const rawAudioEntries = listData.entries.filter(isAudio)

      // 2. OPTIMISATION : Récupérer d'un seul coup tous les liens existants dans ce dossier
      const sharedLinksRes = await fetch(DROPBOX_LIST_SHARED_LINKS, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: currentPath, direct_only: true }),
      })
      
      const sharedLinksData = await sharedLinksRes.json()
      const existingLinks = sharedLinksData?.links || []

      // Créer une map des liens existants indexée par le chemin en minuscules
      const linksMap = new Map(
        existingLinks.map(link => [link.path_lower, link.url])
      )

      // 3. Associer le lien existant ou créer un nouveau lien uniquement si absent
      const audioFiles = await Promise.all(
        rawAudioEntries.map(async (file) => {
          try {
            // Si le lien existe déjà, on l'utilise directement (Évite un appel API)
            if (linksMap.has(file.path_lower)) {
              const url = linksMap.get(file.path_lower)
              return {
                name: file.name,
                url: url.replace(/\?dl=0$/, "?raw=1"),
                isFolder: false,
                path: file.path_lower,
              }
            }

            // Fallback : On crée le lien individuellement uniquement pour les nouveaux fichiers téléversés
            const linkRes = await fetch(DROPBOX_CREATE_LINK, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ path: file.path_lower }),
            })

            const linkData = await linkRes.json()
            const url = linkData?.url || 
                        (linkData?.error?.[".tag"] === "shared_link_already_exists" && 
                         linkData.error.shared_link_already_exists.metadata.url)

            if (!url) return null

            return {
              name: file.name,
              url: url.replace(/\?dl=0$/, "?raw=1"),
              isFolder: false,
              path: file.path_lower,
            }
          } catch (e) {
            return null
          }
        })
      )

      return res.status(200).json([...folders, ...audioFiles.filter(Boolean)])
    } catch (err) {
      console.error("❌ Dropbox GET error:", err)
      return res.status(500).json({ error: "Erreur Dropbox" })
    }
  }

  // ---------------- TELEVERSEMENT DE FICHIERS (POST) ----------------
  if (req.method === "POST") {
    try {
      const token = await getAccessToken()
      const { name, fileData, path } = req.body

      if (!name || !fileData) {
        return res.status(400).json({ error: "Données manquantes (name ou fileData)" })
      }

      const cleanPath = path === "/owlbear" ? `/owlbear/${name}` : `${path}/${name}`
      const fileBuffer = Buffer.from(fileData, "base64")

      const uploadRes = await fetch(`${DROPBOX_CONTENT_API}/2/files/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Dropbox-API-Arg": JSON.stringify({
            path: cleanPath,
            mode: "add",
            autorename: true,
            mute: false,
            strict_conflict: false
          }),
          "Content-Type": "application/octet-stream",
        },
        body: fileBuffer,
      })

      const uploadData = await uploadRes.json()

      if (uploadData.error) {
        console.error("❌ Dropbox upload API error:", uploadData.error)
        return res.status(500).json({ error: uploadData.error })
      }

      return res.status(200).json({ success: true, metadata: uploadData })
    } catch (err) {
      console.error("❌ Dropbox POST error:", err)
      return res.status(500).json({ error: "Erreur lors du téléversement" })
    }
  }
}