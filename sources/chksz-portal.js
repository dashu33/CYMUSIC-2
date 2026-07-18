/**
 * ChKSz 门户自适应音源
 *
 * 用法：
 * 1. 在 CyMusic 设置中选择「从 URL 导入」
 * 2. 填入：https://api.chksz.com/
 * 3. 软件会把门户页解析成可用接口，并在启动/重载时自动刷新
 *
 * 也可直接导入本文件。
 */
const PORTAL_URL = 'https://api.chksz.com/'
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 8000

const FALLBACK_PATHS = {
  qq: '/api/qq_music',
  search163: '/api/163_search',
  music163: '/api/163_music',
  lyric163: '/api/163_lyric',
  kugou: '/api/kugou_music',
}

const QUALITY_MAP = {
  '128k': ['standard', 'exhigh', 'lossless'],
  '320k': ['exhigh', 'standard', 'lossless'],
  flac: ['lossless', 'hires', 'exhigh', 'standard', 'jyeffect', 'sky', 'jymaster'],
}

const COVER_HINTS = [
  'cover',
  'remix',
  'live',
  '伴奏',
  '翻唱',
  '片段',
  '纯音乐',
  'instrumental',
  'karaoke',
  'dj',
  '加速',
  '剪辑',
  '女声',
  '男声',
  '合唱版',
]

let catalogCache = null
let catalogFetchedAt = 0

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u3000\s]+/g, ' ')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/【/g, '[')
    .replace(/】/g, ']')
    .replace(/\[[^\]]*\]|\([^\)]*\)/g, ' ')
    .replace(/feat\.?|ft\.?|with/gi, ' ')
    .replace(/[·・,，、/\\&＆\-_.+:：|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function compactText(value) {
  return normalizeText(value).replace(/\s+/g, '')
}

function splitArtists(value) {
  return String(value || '')
    .split(/[\/,，、&＆]|feat\.?|ft\.?|with/i)
    .map((item) => compactText(item))
    .filter(Boolean)
}

function uniqueStrings(list) {
  return Array.from(new Set((list || []).filter(Boolean)))
}

function isPlayableUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

function preferHttps(url) {
  if (typeof url !== 'string') return url
  if (url.startsWith('http://')) return 'https://' + url.slice(7)
  return url
}

function hasCoverHint(text) {
  const raw = String(text || '').toLowerCase()
  return COVER_HINTS.some((hint) => raw.includes(hint))
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('request timeout')), ms)),
  ])
}

async function requestJson(url) {
  const response = await withTimeout(
    fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    }),
    REQUEST_TIMEOUT_MS,
  )

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return response.json()
}

function extractPaths(html) {
  const matches = String(html || '').match(/\/api\/[a-z0-9_]+/gi) || []
  return Array.from(new Set(matches.map((item) => item.toLowerCase())))
}

function pickPath(paths, pattern, fallback) {
  const found = paths.find((item) => pattern.test(item))
  return found || fallback
}

async function discoverCatalog(force) {
  if (!force && catalogCache && Date.now() - catalogFetchedAt < CATALOG_TTL_MS) {
    return catalogCache
  }

  try {
    const response = await withTimeout(
      fetch(PORTAL_URL, {
        method: 'GET',
        headers: {
          Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        },
      }),
      REQUEST_TIMEOUT_MS,
    )

    if (!response.ok) {
      throw new Error(`portal HTTP ${response.status}`)
    }

    const html = await response.text()
    const paths = extractPaths(html)
    const origin = new URL(PORTAL_URL).origin

    catalogCache = {
      origin,
      portalUrl: PORTAL_URL,
      qq: pickPath(paths, /qq[_-]?music/, FALLBACK_PATHS.qq),
      search163: pickPath(paths, /163[_-]?search|netease[_-]?search/, FALLBACK_PATHS.search163),
      music163: pickPath(paths, /163[_-]?music|netease[_-]?music/, FALLBACK_PATHS.music163),
      lyric163: pickPath(paths, /163[_-]?lyric|netease[_-]?lyric/, FALLBACK_PATHS.lyric163),
      kugou: pickPath(paths, /kugou[_-]?music|kg[_-]?music/, FALLBACK_PATHS.kugou),
      fingerprint: paths.sort().join('|') || 'fallback',
      discoveredAt: Date.now(),
    }
    catalogFetchedAt = Date.now()
    console.log('[chksz-portal] catalog refreshed', catalogCache.fingerprint)
    return catalogCache
  } catch (error) {
    console.warn('[chksz-portal] discover failed, use fallback', error && error.message)
    if (catalogCache) return catalogCache

    const origin = new URL(PORTAL_URL).origin
    catalogCache = {
      origin,
      portalUrl: PORTAL_URL,
      ...FALLBACK_PATHS,
      fingerprint: 'fallback',
      discoveredAt: Date.now(),
    }
    catalogFetchedAt = Date.now()
    return catalogCache
  }
}

function apiUrl(catalog, path, query) {
  const params = new URLSearchParams()
  Object.keys(query || {}).forEach((key) => {
    const value = query[key]
    if (value === undefined || value === null || value === '') return
    params.set(key, String(value))
  })
  const qs = params.toString()
  return `${catalog.origin}${path}${qs ? `?${qs}` : ''}`
}

function scoreSong(candidateName, candidateArtist, songname, artist) {
  const name = compactText(candidateName)
  const expectName = compactText(songname)
  if (!name || !expectName) return 0

  let score = 0
  if (name === expectName) score += 120
  else if (name.includes(expectName) || expectName.includes(name)) score += 55
  else return 0

  const expectArtists = splitArtists(artist)
  const candidateArtists = splitArtists(candidateArtist)

  if (expectArtists.length) {
    let matched = 0
    expectArtists.forEach((token) => {
      if (candidateArtists.some((item) => item === token || item.includes(token) || token.includes(item))) {
        matched += 1
      }
    })

    if (matched === 0) {
      // 搜索结果经常混入翻唱，没有歌手命中时直接丢弃
      return 0
    }

    score += Math.round((matched / expectArtists.length) * 80)
    if (matched === expectArtists.length) score += 20

    const exactArtistSet =
      candidateArtists.length === expectArtists.length &&
      expectArtists.every((token) => candidateArtists.includes(token))
    if (exactArtistSet) score += 35

    const unmatched = candidateArtists.filter(
      (item) =>
        !expectArtists.some(
          (token) => item === token || item.includes(token) || token.includes(item),
        ),
    )
    // 周杰伦-/A-LNK、周杰伦./Asasblue 这类污染名会落到这里
    score -= unmatched.length * 45
  } else {
    score += 10
  }

  const queryHasCover = hasCoverHint(songname) || hasCoverHint(artist)
  const candidateHasCover = hasCoverHint(candidateName) || hasCoverHint(candidateArtist)
  if (candidateHasCover && !queryHasCover) score -= 45

  // 额外脏数据惩罚：明显英文字段污染中文歌手
  if (/[a-z0-9]{3,}/i.test(String(candidateArtist || '')) && expectArtists.length === 1) {
    score -= 20
  }

  return score
}

function pickBestSong(list, songname, artist, mapper) {
  let best = null
  let bestScore = 0

  ;(list || []).forEach((item, index) => {
    const mapped = mapper(item, index)
    if (!mapped || !mapped.id) return
    const score = scoreSong(mapped.name, mapped.artists, songname, artist)
    if (score > bestScore) {
      bestScore = score
      best = { ...mapped, score: bestScore }
    }
  })

  const requireArtist = Boolean(compactText(artist))
  const minScore = requireArtist ? 140 : 100
  if (best && bestScore >= minScore) return best
  return null
}

function buildSearchQueries(songname, artist) {
  return uniqueStrings([
    [songname, artist].filter(Boolean).join(' '),
    songname,
    artist && songname ? `${artist} ${songname}` : '',
    artist && songname ? `"${songname}" ${artist}` : '',
  ])
}

async function resolveByQqMid(catalog, songmid) {
  if (!songmid || !catalog.qq) return null
  const data = await requestJson(
    apiUrl(catalog, catalog.qq, {
      mid: songmid,
      type: 'json',
    }),
  )
  const url = data && (data.url || (data.data && data.data.url))
  return isPlayableUrl(url) ? preferHttps(url) : null
}

async function resolveByQqSearch(catalog, songname, artist) {
  if (!catalog.qq) return null
  const queries = buildSearchQueries(songname, artist)
  let best = null

  for (const keyword of queries) {
    const data = await requestJson(
      apiUrl(catalog, catalog.qq, {
        msg: keyword,
        num: 12,
        type: 'json',
      }),
    )
    const list = (data && data.list) || (data && data.data && data.data.list) || []
    const matched = pickBestSong(list, songname, artist, (item) => ({
      id: item.id || item.mid || item.songmid,
      name: item.name || item.songname || item.title,
      artists: item.artists || item.singer || item.singerName,
    }))
    if (matched && (!best || matched.score > best.score)) best = matched
    if (best && best.score >= 180) break
  }

  if (!best || !best.id) return null
  return resolveByQqMid(catalog, best.id)
}

async function resolveByNetEase(catalog, songname, artist, quality) {
  if (!catalog.search163 || !catalog.music163) return null
  const queries = buildSearchQueries(songname, artist)
  let best = null

  for (const keyword of queries) {
    const search = await requestJson(
      apiUrl(catalog, catalog.search163, {
        keyword,
        limit: 15,
        offset: 0,
      }),
    )
    const songs =
      (search && search.data && search.data.songs) ||
      (search && search.songs) ||
      (search && search.result && search.result.songs) ||
      []

    const matched = pickBestSong(songs, songname, artist, (item) => ({
      id: item.id,
      name: item.name || item.songname,
      artists:
        item.artists ||
        (Array.isArray(item.ar) ? item.ar.map((a) => a.name).join('/') : item.artist),
    }))
    if (matched && (!best || matched.score > best.score)) best = matched
    if (best && best.score >= 180) break
  }

  if (!best || !best.id) return null

  const levels = QUALITY_MAP[quality] || QUALITY_MAP['320k']
  for (const level of levels) {
    try {
      const data = await requestJson(
        apiUrl(catalog, catalog.music163, {
          id: best.id,
          level,
          type: 'json',
        }),
      )
      const url = data && data.data && data.data.url
      if (isPlayableUrl(url)) return preferHttps(url)
    } catch (error) {
      console.warn('[chksz-portal] netease level failed', level, error && error.message)
    }
  }

  return null
}

async function resolveByKugou(catalog, songname, artist) {
  if (!catalog.kugou) return null
  const queries = buildSearchQueries(songname, artist)
  let best = null

  for (const keyword of queries) {
    const search = await requestJson(
      apiUrl(catalog, catalog.kugou, {
        msg: keyword,
        num: 12,
        type: 'json',
      }),
    )
    const list = (search && search.list) || (search && search.data && search.data.list) || []
    const matched = pickBestSong(list, songname, artist, (item) => ({
      id: item.id || item.hash || item.FileHash,
      name: item.SongName || item.songName || item.name,
      artists: item.SingerName || item.singerName || item.artists,
    }))
    if (matched && (!best || matched.score > best.score)) best = matched
    if (best && best.score >= 180) break
  }

  if (!best || !best.id) return null

  const data = await requestJson(
    apiUrl(catalog, catalog.kugou, {
      id: best.id,
      type: 'json',
    }),
  )

  const url = (data && data.data && data.data.url) || (data && data.url) || null
  if (!isPlayableUrl(url)) return null

  const httpsUrl = preferHttps(url)
  if (httpsUrl.startsWith('https://')) return httpsUrl

  // 某些环境禁止明文 HTTP，这里仍返回；播放失败时由其它源兜底
  return url
}

async function getMusicUrl(songname, artist, songmid, quality) {
  const safeQuality = quality || '320k'
  let catalog = await discoverCatalog(false)

  const runners = [
    async () => resolveByQqMid(catalog, songmid),
    async () => resolveByQqSearch(catalog, songname, artist),
    async () => resolveByNetEase(catalog, songname, artist, safeQuality),
    async () => resolveByKugou(catalog, songname, artist),
  ]

  for (const run of runners) {
    try {
      const url = await run()
      if (isPlayableUrl(url)) return url
    } catch (error) {
      console.warn('[chksz-portal] resolve step failed', error && error.message)
    }
  }

  // 接口变更时强制重发现一次再试
  catalog = await discoverCatalog(true)
  for (const run of runners) {
    try {
      const url = await run()
      if (isPlayableUrl(url)) return url
    } catch (error) {
      console.warn('[chksz-portal] retry failed', error && error.message)
    }
  }

  return null
}

module.exports = {
  id: 'chksz-portal',
  author: 'CYMUSIC-mod',
  name: 'ChKSz 门户自适应',
  version: '1.1.0',
  srcUrl: PORTAL_URL,
  getMusicUrl,
}

