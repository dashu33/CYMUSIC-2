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

**适用场景**：目标接口需要计算签名（如 sign/sec_key/encSecKey），用 MD5/AES 等做加密。

**关键限制**：Cymusic 沙箱里 **`require('crypto-js')` 不可用**——必须把 MD5 等实现**内联**到脚本里。下面给一个完整可用的内联 MD5 实现：

```javascript
const LOG = '[signed-source]'
const APP_SECRET = 'demo-secret'  // 实际值从抓包/逆向得到

// ============ 内联 MD5 实现（沙箱无 crypto-js）============
// 来源：标准 RFC 1321 的 JS 实现，可以放心粘贴使用
function md5(s) {
  function L(k,d){return(k<<d)|(k>>>(32-d))}
  function K(G,k){var I,d,F,H,x;F=(G&2147483648);H=(k&2147483648);I=(G&1073741824);d=(k&1073741824);x=(G&1073741823)+(k&1073741823);if(I&d){return(x^2147483648^F^H)}if(I|d){if(x&1073741824){return(x^3221225472^F^H)}else{return(x^1073741824^F^H)}}else{return(x^F^H)}}
  function r(d,F,k){return(d&F)|((~d)&k)}
  function q(d,F,k){return(d&k)|(F&(~k))}
  function p(d,F,k){return(d^F^k)}
  function n(d,F,k){return(F^(d|(~k)))}
  function u(G,F,aa,Z,k,H,I){G=K(G,K(K(r(F,aa,Z),k),I));return K(L(G,H),F)}
  function f(G,F,aa,Z,k,H,I){G=K(G,K(K(q(F,aa,Z),k),I));return K(L(G,H),F)}
  function D(G,F,aa,Z,k,H,I){G=K(G,K(K(p(F,aa,Z),k),I));return K(L(G,H),F)}
  function t(G,F,aa,Z,k,H,I){G=K(G,K(K(n(F,aa,Z),k),I));return K(L(G,H),F)}
  function e(G){var Z;var F=G.length;var x=F+8;var k=(x-(x%64))/64;var I=(k+1)*16;var aa=Array(I-1);var d=0;var H=0;while(H<F){Z=(H-(H%4))/4;d=(H%4)*8;aa[Z]=(aa[Z]|(G.charCodeAt(H)<<d));H++}Z=(H-(H%4))/4;d=(H%4)*8;aa[Z]=aa[Z]|(128<<d);aa[I-2]=F<<3;aa[I-1]=F>>>29;return aa}
  function B(x){var k="",F="",G,d;for(d=0;d<=3;d++){G=(x>>>(d*8))&255;F="0"+G.toString(16);k=k+F.substr(F.length-2,2)}return k}
  function J(k){k=k.replace(/\r\n/g,"\n");var d="";for(var F=0;F<k.length;F++){var x=k.charCodeAt(F);if(x<128){d+=String.fromCharCode(x)}else if((x>127)&&(x<2048)){d+=String.fromCharCode((x>>6)|192);d+=String.fromCharCode((x&63)|128)}else{d+=String.fromCharCode((x>>12)|224);d+=String.fromCharCode(((x>>6)&63)|128);d+=String.fromCharCode((x&63)|128)}}return d}
  var C=Array();var P,h,E,v,g,Y,M,X,W;var S=7,Q=12,N=17,H=22;var A=5,z=9,y=14,w=20;var o=4,m=11,l=16,j=23;var U=6,T=10,R=15,O=21;s=J(s);C=e(s);Y=1732584193;M=4023233417;X=2562383102;W=271733878;for(P=0;P<C.length;P+=16){h=Y;E=M;v=X;g=W;Y=u(Y,M,X,W,C[P+0],S,3614090360);W=u(W,Y,M,X,C[P+1],Q,3905402710);X=u(X,W,Y,M,C[P+2],N,606105819);M=u(M,X,W,Y,C[P+3],H,3250441966);Y=u(Y,M,X,W,C[P+4],S,4118548399);W=u(W,Y,M,X,C[P+5],Q,1200080426);X=u(X,W,Y,M,C[P+6],N,2821735955);M=u(M,X,W,Y,C[P+7],H,4249261313);Y=u(Y,M,X,W,C[P+8],S,1770035416);W=u(W,Y,M,X,C[P+9],Q,2336552879);X=u(X,W,Y,M,C[P+10],N,4294925233);M=u(M,X,W,Y,C[P+11],H,2304563134);Y=u(Y,M,X,W,C[P+12],S,1804603682);W=u(W,Y,M,X,C[P+13],Q,4254626195);X=u(X,W,Y,M,C[P+14],N,2792965006);M=u(M,X,W,Y,C[P+15],H,1236535329);Y=f(Y,M,X,W,C[P+1],A,4129170786);W=f(W,Y,M,X,C[P+6],z,3225465664);X=f(X,W,Y,M,C[P+11],y,643717713);M=f(M,X,W,Y,C[P+0],w,3921069994);Y=f(Y,M,X,W,C[P+5],A,3593408605);W=f(W,Y,M,X,C[P+10],z,38016083);X=f(X,W,Y,M,C[P+15],y,3634488961);M=f(M,X,W,Y,C[P+4],w,3889429448);Y=f(Y,M,X,W,C[P+9],A,568446438);W=f(W,Y,M,X,C[P+14],z,3275163606);X=f(X,W,Y,M,C[P+3],y,4107603335);M=f(M,X,W,Y,C[P+8],w,1163531501);Y=f(Y,M,X,W,C[P+13],A,2850285829);W=f(W,Y,M,X,C[P+2],z,4243563512);X=f(X,W,Y,M,C[P+7],y,1735328473);M=f(M,X,W,Y,C[P+12],w,2368359562);Y=D(Y,M,X,W,C[P+5],o,4294588738);W=D(W,Y,M,X,C[P+8],m,2272392833);X=D(X,W,Y,M,C[P+11],l,1839030562);M=D(M,X,W,Y,C[P+14],j,4259657740);Y=D(Y,M,X,W,C[P+1],o,2763975236);W=D(W,Y,M,X,C[P+4],m,1272893353);X=D(X,W,Y,M,C[P+7],l,4139469664);M=D(M,X,W,Y,C[P+10],j,3200236656);Y=D(Y,M,X,W,C[P+13],o,681279174);W=D(W,Y,M,X,C[P+0],m,3936430074);X=D(X,W,Y,M,C[P+3],l,3572445317);M=D(M,X,W,Y,C[P+6],j,76029189);Y=D(Y,M,X,W,C[P+9],o,3654602809);W=D(W,Y,M,X,C[P+12],m,3873151461);X=D(X,W,Y,M,C[P+15],l,530742520);M=D(M,X,W,Y,C[P+2],j,3299628645);Y=t(Y,M,X,W,C[P+0],U,4096336452);W=t(W,Y,M,X,C[P+7],T,1126891415);X=t(X,W,Y,M,C[P+14],R,2878612391);M=t(M,X,W,Y,C[P+5],O,4237533241);Y=t(Y,M,X,W,C[P+12],U,1700485571);W=t(W,Y,M,X,C[P+3],T,2399980690);X=t(X,W,Y,M,C[P+10],R,4293915773);M=t(M,X,W,Y,C[P+1],O,2240044497);Y=t(Y,M,X,W,C[P+8],U,1873313359);W=t(W,Y,M,X,C[P+15],T,4264355552);X=t(X,W,Y,M,C[P+6],R,2734768916);M=t(M,X,W,Y,C[P+13],O,1309151649);Y=t(Y,M,X,W,C[P+4],U,4149444226);W=t(W,Y,M,X,C[P+11],T,3174756917);X=t(X,W,Y,M,C[P+2],R,718787259);M=t(M,X,W,Y,C[P+9],O,3951481745);Y=K(Y,h);M=K(M,E);X=K(X,v);W=K(W,g)}var i=B(Y)+B(M)+B(X)+B(W);return i.toLowerCase()
}
// ===========================================================

function buildSign(params) {
  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&')
  return md5(sorted + '&secret=' + APP_SECRET)
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

### 内联依赖参考

Cymusic 沙箱**不能 require 任何模块**。需要的库要内联：

| 需求 | 内联方案 |
|---|---|
| MD5 | 用模板 3 中给的 `md5()` 函数（来源 RFC 1321） |
| SHA1/SHA256 | Web Crypto API：`crypto.subtle.digest('SHA-256', ...)` |
| Base64 | 全局 `btoa`/`atob` |
| URL 参数 | `new URLSearchParams(...).toString()` |
| AES | 复杂，建议改用代理服务 |
| HTML 解析 | 用正则切片，不要尝试用 cheerio |
