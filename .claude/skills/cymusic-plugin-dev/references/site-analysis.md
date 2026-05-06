# 站点分析方法论

如何在没有 API 文档的情况下，把一个音乐站点变成 Cymusic 插件。

## 核心方法论：观察 → 分析 → 复现 → 验证

```
1. 观察：用 Playwright 加载页面，捕获所有网络请求，全部保存到本地
2. 分析：基于本地缓存做离线分析，找到关键的音频/URL 接口
3. 复现：用 fetch 复现相同的请求（包括完整的 Headers）
4. 验证：在终端测试，失败则对比 Headers 找差异
```

**关键原则**：

- **不要盲猜 URL**——每个端点必须来自实际观察
- **不要重复请求**——每个 URL 只请求一次，结果落盘后基于本地分析
- **不要在 axios 上死磕**——浏览器能访问的，只要复制完整 Headers，fetch 一定也能

## 三种站点类型

### 类型 A：公开 REST API

最简单。表现：

- 文档公开（GitHub 项目、API 文档站）
- 调用 `https://example.com/api/url?id=xxx&quality=320k` 直接返回 JSON `{ url: '...' }`

**对接策略**：直接拿模板 1（直链型）改 URL，跳过下面的抓包流程。

**示例**：lx-music-api-server 项目（`http://api.example.com/url/{source}/{songId}/{quality}`）

### 类型 B：网页内嵌音频

表现：

- 没有 API 文档，是面向网页的服务
- 直接访问 HTML，里面嵌了 `<audio src="...">` 或脚本里有播放数据

**快速预判**：用 `curl https://target.com/song/123 -o page.html` 抓下来，搜索 `mp3`/`audio`/`url`。

**对接策略**：cheerio 在 Cymusic 沙箱里**不可用**，所以用正则/字符串切片提取：

```javascript
const html = await fetch(songPageUrl).then(r => r.text())
const m = /<audio[^>]+src="([^"]+)"/.exec(html)
const url = m?.[1]
```

### 类型 C：SPA + 内部 API（最常见）

表现：

- 现代音乐站点几乎都是这种
- HTML 是骨架，数据通过异步 XHR/fetch 加载
- 接口可能有 `sign`、`sec_key` 等签名参数

**对接策略**：必须用 Playwright 抓包，按下面"Playwright 抓包工作流"操作。

## Playwright 抓包工作流

### 1. 安装 Playwright

```bash
npm install -D playwright
```

**复用用户已有的 Chrome**（不下载 Chromium）：

```javascript
const browser = await chromium.launch({
  channel: 'chrome',  // 用系统 Chrome
  headless: false,
})
```

### 2. 编写抓包脚本

```javascript
// capture.js
const { chromium } = require('playwright')
const fs = require('fs')

const TARGET_URL = 'https://music.example.com/song/12345'

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: false })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  const captured = []

  // 监听所有请求
  page.on('request', req => {
    captured.push({
      type: 'request',
      url: req.url(),
      method: req.method(),
      headers: req.headers(),
      postData: req.postData(),
    })
  })

  // 监听所有响应
  page.on('response', async res => {
    const req = res.request()
    const url = res.url()
    let body = null
    try {
      const ct = res.headers()['content-type'] || ''
      if (ct.includes('json') || ct.includes('text')) body = await res.text()
    } catch {}
    captured.push({
      type: 'response',
      url,
      status: res.status(),
      headers: res.headers(),
      body: body ? body.slice(0, 5000) : null,
    })
  })

  await page.goto(TARGET_URL, { waitUntil: 'networkidle' })

  // 触发播放（如果需要）
  // await page.click('button.play')
  // await page.waitForTimeout(3000)

  fs.writeFileSync('./captured.json', JSON.stringify(captured, null, 2))
  console.log(`保存 ${captured.length} 条请求/响应到 captured.json`)
  await browser.close()
})()
```

### 3. 离线分析

不要再发新请求。所有分析都基于 `captured.json`：

```bash
# 找音频请求
node -e "JSON.parse(require('fs').readFileSync('captured.json')).filter(x=>/\.(mp3|m4a|flac)/.test(x.url)).forEach(x=>console.log(x.url))"

# 找可能的播放接口
node -e "JSON.parse(require('fs').readFileSync('captured.json')).filter(x=>x.type==='response'&&/play|url|song/.test(x.url)).forEach(x=>console.log(x.status,x.url))"
```

### 4. 用 fetch 复现

从 `captured.json` 取出关键请求的 URL 和 Headers，原样复制：

```javascript
const headers = {
  // 从 captured.json 中复制对应请求的 headers
  'user-agent': 'Mozilla/5.0 ...',
  'referer': 'https://music.example.com/',
  'cookie': '...',  // 如果需要
}

const res = await fetch('https://api.example.com/play?id=123', { headers })
const data = await res.json()
console.log(data)
```

### 5. 验证

**如果 fetch 失败但 Playwright 成功**：差别一定在 Headers 上。
对比策略：

1. 取出 Playwright 捕获的请求的全部 headers
2. 取出 fetch 默认发出的 headers（可以临时把请求发到 `https://httpbin.org/headers`）
3. 找差异，逐个补上

**最常见的差异**：`referer`、`user-agent`、`origin`、`x-csrf-token` 类自定义 header。

## 浏览器 DevTools 速查（无 Playwright 时的备选）

| 任务 | 操作 |
|---|---|
| 看播放音频从哪来 | Network → Filter `media` 或 `XHR` → 点击播放 |
| 看请求是怎么生成的 | 右键请求 → Copy → Copy as cURL → 验证 |
| 找加密函数 | Sources → Cmd+P 搜文件 → Cmd+F 搜参数名 |
| 单步调试 | 在 Sources 里给函数打断点，重放一次操作 |
| 看 cookie 影响 | 关掉 cookie 看接口是否仍可用 |

## 验证流程（写代码前）

**先在终端把 API 跑通，再写到插件里**——能省下大量调试时间。

```bash
# 1. 用 curl 复刻浏览器请求
curl 'https://music.example.com/api/play?id=123' \
  -H 'cookie: <复制浏览器里的>' \
  -H 'referer: https://music.example.com/' | jq

# 2. 简化 headers，看哪些是必须的
# 一个个删 header，看接口什么时候开始失败

# 3. 改参数试音质
curl 'https://music.example.com/api/play?id=123&q=flac' | jq
```

确认了"哪些参数必须、哪些 header 必须、响应结构长什么样"之后再开始写。

## 常见加密模式速查

### MD5 签名（最常见）

```javascript
// 场景：参数排序后拼接 + 密钥再 MD5
// Cymusic 沙箱无 crypto-js，需要内联 MD5 实现（见 plugin-template.md 模板 3）
function sign(params, secret) {
  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&')
  return md5(sorted + '&key=' + secret)
}
```

### Base64 + 时间戳

```javascript
// 很多简单签名其实就是 base64(json + ts)
const payload = btoa(JSON.stringify({ ...params, ts: Date.now() }))
```

### AES 加密参数（如网易云的 encSecKey）

复杂度高，建议优先找走代理服务的方案。如必须做：

1. 在浏览器里给加密函数下断点
2. 看输入输出和 key/iv
3. 在脚本里内联 AES 实现（不能 require crypto-js）

## 跨源 ID 反查策略（songmid → 目标源 ID）

Cymusic 给你的是 QQ Music 的 `songmid`。如果目标源不认 QQ ID，按下面策略选一种：

| 策略 | 适用 | 优缺点 |
|---|---|---|
| 用 title+artist 直接搜 | 大多数情况 | ✅ 通用 ❌ 同名歌曲匹配易错 |
| 用 songmid 走代理服务 | 有现成代理 | ✅ 准确 ❌ 依赖第三方稳定性 |
| 用 ISRC/专辑名辅助匹配 | 有元数据 | ✅ 准确 ❌ 大多数源没暴露 ISRC |

**推荐**：策略 1 + 缓存匹配结果。同一首歌反复播放时不重复搜索。

参考 `src/helpers/userApi/getMusicSource.ts` 中：

- `searchMusicInfoByName(title, artist?)` — QQ 反查
- `getKwId(songInfo)` → `getUrlFromKw(kwId, quality)` — 酷我搜索 + 取 URL（典型的两步走）

## 音质参数映射表（参考）

不同源的音质命名不一致，这里是几个常见的对照：

| Cymusic | QQ Music | 网易云 | 酷我 | 酷狗 |
|---|---|---|---|---|
| `128k` | `M500` (mp3 128) | `standard` | `128kmp3` | `mp3-128k` |
| `320k` | `M800` (mp3 320) | `higher` / `exhigh` | `320kmp3` | `mp3-320k` |
| `flac` | `F000` (flac) | `lossless` | `2000kflac` | `flac` |

写插件时建议在脚本顶部维护这张表：

```javascript
const QUALITY_MAP = {
  '128k': '128',
  '320k': '320',
  'flac': '999',
}
```

## 出错排查清单

| 现象 | 可能原因 | 验证方法 |
|---|---|---|
| 导入失败"脚本缺少 getMusicUrl 方法" | 没用 `module.exports`，或者用了 `export default` | 看脚本最后是否 `module.exports = {...}` |
| 播放时 Toast "无法获取音乐 URL" | 三个音质都返回 null/异常 | 看 App 日志找 LOG 前缀 |
| 一直播放 fakeAudioMp3Uri | 同上 | 同上 |
| 部分歌曲能播放、部分不行 | 多半是匹配逻辑问题 | 看日志里的搜索结果 |
| 第一次能播第二次失败 | 大概率是 token 过期没续签 | 检查 token 缓存逻辑 |
| iOS 上能播 Android 不能 | URL 不是 https / 缺少 ATS 例外 | 检查 URL 协议 |
| 终端 Node 测试 OK，App 里失败 | RN 缺少某全局 API（如 `Buffer`） | 用 `console.log(typeof X)` 检查 |
| Playwright 能取，fetch 失败 | Headers 缺失 | 对比两边 headers 找差异 |

## 真实案例参考

项目内已有的脚本（直接打开看实现）：

- **`src/helpers/userApi/ikun-music-source.js`** — 走代理服务的 lx-music 风格脚本
- **`src/helpers/userApi/xiaoqiu.js`** — 直接对接 QQ Music 的脚本（搜索 + URL）
- **`src/helpers/userApi/qq-music-api.js`** — 完整的 QQ Music API 封装，可借鉴搜索 / 加密 / 元数据接口
- **`src/helpers/userApi/getMusicSource.ts`** — 内置的酷我反查实现，参考 `getMusicFromKw`、`searchMusicInfoByName`

打开这些文件看真实实现，比看模板更有用。

> 注意：上面这些是**项目内置文件**（通过 webpack/metro 打包），可以 `require('axios')`/`require('crypto-js')`。
> 用户**导入的插件脚本**走的是沙箱加载，不能 require，要用 fetch + 内联实现。
> 借鉴这些文件的**逻辑思路**而非**依赖方式**。
