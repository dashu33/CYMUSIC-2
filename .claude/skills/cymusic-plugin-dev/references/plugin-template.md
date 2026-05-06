# Cymusic 插件模板集

下面是三种最常见的插件模式。开发时挑最贴近的一种作为骨架，再填充实际逻辑。

---

## 模板 1：直链型（最简单）

**适用场景**：第三方代理服务，传 (songmid, quality) 直接返回 URL。

```javascript
const API_BASE = 'https://your-proxy-server.com/api'
const LOG = '[direct-source]'

module.exports = {
  id: 'direct-proxy-v1',
  name: '直连代理音源',
  author: 'your-name',
  version: '1.0.0',
  srcUrl: 'https://example.com/direct-proxy.js',

  getMusicUrl: async function (title, artist, songmid, quality) {
    const qualityMap = {
      '128k': '128',
      '320k': '320',
      'flac': 'flac',
    }
    const q = qualityMap[quality] || '128'

    try {
      const res = await fetch(`${API_BASE}/url?mid=${songmid}&quality=${q}`)
      if (!res.ok) {
        console.log(LOG, 'http error', res.status)
        return null
      }
      const data = await res.json()
      if (data.code !== 0 || !data.url) {
        console.log(LOG, 'business error', data.code, data.msg)
        return null
      }
      return data.url
    } catch (e) {
      console.log(LOG, 'fetch failed', e.message)
      return null
    }
  },
}
```

---

## 模板 2：搜索匹配型（跨源使用）

**适用场景**：目标数据源不认识 QQ 的 songmid，需要先用 title+artist 搜索匹配再取 URL。

```javascript
const SEARCH_API = 'https://music-api.example.com/search'
const URL_API = 'https://music-api.example.com/song'
const LOG = '[search-match]'

const matchCache = new Map()  // songmid -> { id, expireAt }
const CACHE_TTL = 60 * 60 * 1000  // 1 小时

async function findMatchedId(title, artist, songmid) {
  const cached = matchCache.get(songmid)
  if (cached && Date.now() < cached.expireAt) return cached.id

  const keyword = `${title} ${artist}`.trim()
  const res = await fetch(`${SEARCH_API}?keyword=${encodeURIComponent(keyword)}&limit=10`)
  if (!res.ok) return null
  const data = await res.json()
  const list = data?.data?.songs || []
  if (!list.length) return null

  const normalize = s => String(s || '').toLowerCase().replace(/\s+/g, '')
  const T = normalize(title), A = normalize(artist)
  const exact = list.find(s =>
    normalize(s.name) === T && normalize(s.artist).includes(A.split('、')[0]),
  )
  const matched = exact || list[0]
  if (!matched) return null

  matchCache.set(songmid, { id: matched.id, expireAt: Date.now() + CACHE_TTL })
  return matched.id
}

module.exports = {
  id: 'search-match-v1',
  name: '搜索匹配音源',
  author: 'your-name',
  version: '1.0.0',
  srcUrl: '',

  getMusicUrl: async function (title, artist, songmid, quality) {
    try {
      const targetId = await findMatchedId(title, artist, songmid)
      if (!targetId) {
        console.log(LOG, 'no match for', title, artist)
        return null
      }
      const qMap = { '128k': 'standard', '320k': 'higher', flac: 'lossless' }
      const res = await fetch(`${URL_API}?id=${targetId}&level=${qMap[quality] || 'standard'}`)
      if (!res.ok) return null
      const data = await res.json()
      return data?.data?.[0]?.url || null
    } catch (e) {
      console.log(LOG, 'failed', e.message)
      return null
    }
  },
}
```

---

## 模板 3：加密签名型（接入有反爬的官方接口）

**适用场景**：目标接口需要计算签名（如 sign/sec_key/encSecKey），用 crypto-js 等做加密。

```javascript
const LOG = '[signed-source]'
const APP_SECRET = 'demo-secret'  // 实际值从抓包/逆向得到

function md5Hex(str) {
  // 注：沙箱里若注入了 crypto-js 可直接用，否则需要内联实现
  // eslint-disable-next-line no-undef
  return CryptoJS.MD5(str).toString()
}

function buildSign(params) {
  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&')
  return md5Hex(sorted + '&secret=' + APP_SECRET)
}

let token = null
let tokenExpire = 0
async function ensureToken() {
  if (token && Date.now() < tokenExpire) return token
  const t = Math.floor(Date.now() / 1000)
  const params = { client: 'app', t }
  params.sign = buildSign(params)
  const res = await fetch(`https://api.example.com/token?${new URLSearchParams(params)}`)
  const data = await res.json()
  token = data.token
  tokenExpire = Date.now() + 25 * 60 * 1000
  return token
}

async function searchSongId(title, artist) {
  const tk = await ensureToken()
  const params = { keyword: `${title} ${artist}`, token: tk, t: Math.floor(Date.now() / 1000) }
  params.sign = buildSign(params)
  const res = await fetch(`https://api.example.com/search?${new URLSearchParams(params)}`)
  const data = await res.json()
  return data?.list?.[0]?.song_id || null
}

module.exports = {
  id: 'signed-source-v1',
  name: '签名接口音源',
  author: 'your-name',
  version: '1.0.0',
  srcUrl: '',

  getMusicUrl: async function (title, artist, songmid, quality) {
    try {
      const songId = await searchSongId(title, artist)
      if (!songId) return null

      const tk = await ensureToken()
      const qMap = { '128k': 1, '320k': 2, flac: 3 }
      const params = { song_id: songId, q: qMap[quality] || 1, token: tk, t: Math.floor(Date.now() / 1000) }
      params.sign = buildSign(params)
      const res = await fetch(`https://api.example.com/play?${new URLSearchParams(params)}`)
      if (!res.ok) return null
      const data = await res.json()
      if (data.code !== 0) return null
      return data?.data?.url || null
    } catch (e) {
      console.log(LOG, 'error', e.message)
      return null
    }
  },
}
```

---

## 通用辅助片段

### 多 URL 并发取最快的

```javascript
async function raceFastest(urls) {
  return Promise.any(
    urls.map(async u => {
      const r = await fetch(u, { method: 'HEAD' })
      if (r.ok) return u
      throw new Error('not ok')
    }),
  ).catch(() => null)
}
```

### 字符串相似度（匹配场景常用）

```javascript
function similarity(a, b) {
  const A = String(a || '').toLowerCase()
  const B = String(b || '').toLowerCase()
  if (A === B) return 1
  if (!A || !B) return 0
  const longer = A.length >= B.length ? A : B
  const shorter = A.length >= B.length ? B : A
  const dist = editDistance(longer, shorter)
  return (longer.length - dist) / longer.length
}

function editDistance(s1, s2) {
  const costs = []
  for (let i = 0; i <= s1.length; i++) {
    let last = i
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) costs[j] = j
      else if (j > 0) {
        let nv = costs[j - 1]
        if (s1.charAt(i - 1) !== s2.charAt(j - 1))
          nv = Math.min(Math.min(nv, last), costs[j]) + 1
        costs[j - 1] = last
        last = nv
      }
    }
    if (i > 0) costs[s2.length] = last
  }
  return costs[s2.length]
}
```

### 安全的 JSON 解析

```javascript
function safeJson(text) {
  try { return JSON.parse(text) } catch { return null }
}

function safeJsonp(text) {
  // 处理形如 callback({...}) 的响应
  const m = /^[^{[]*([\s\S]+?)[^}\]]*$/.exec(text)
  return m ? safeJson(m[1]) : null
}
```

### 用户变量占位（让用户填 cookie）

```javascript
// 用户使用前需要修改下面这行
const USER_COOKIE = ''  // TODO: 用户填自己的 cookie

if (!USER_COOKIE) {
  console.log(LOG, 'cookie 未配置，部分音质可能无法播放')
}
```

> Cymusic 原生格式不支持 `userVariables` 字段（那是 MusicFree 的）。如果需要用户配置，让用户编辑脚本顶部常量是最实用的方案。
