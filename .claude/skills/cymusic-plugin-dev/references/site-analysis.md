# 音乐站点分析方法论

如何在没有现成 API 文档的情况下，把一个音乐站点变成 Cymusic 插件。

## 总体思路

```
1. 找到"播放" → 抓 URL 接口的请求
2. 看请求是公开 API 还是需要签名
3. 用 (songmid → title/artist) 反查（如果该站不识别 QQ mid）
4. 处理音质参数映射
5. 拼装 getMusicUrl 函数
```

## 三种站点类型

### 类型 A：公开 REST API

最简单。表现：

- 文档公开（GitHub 项目、API 文档站）
- 调用 `https://example.com/api/url?id=xxx&quality=320k` 直接返回 JSON `{ url: '...' }`

**对接策略**：直接拿模板 1（直链型）改 URL。

**示例**：lx-music-api-server 项目（`http://api.example.com/url/{source}/{songId}/{quality}`）

### 类型 B：网页解析

表现：

- 没有文档，是面向网页的服务
- 直接访问 HTML，里面嵌了播放数据 / 加载脚本里调 XHR 取 URL

**对接策略**：

1. 浏览器开 DevTools → Network → 过滤 `media` 或 `mp3`
2. 点击"播放"按钮，看 mp3 请求是从哪个 XHR 触发的
3. 看那个 XHR 的请求参数和响应结构
4. 翻译成 fetch 调用

**抓包示例**：

```bash
# 在浏览器 DevTools 把请求复制为 cURL，再粘到终端验证
curl 'https://music.example.com/api/play?id=12345&q=high' \
  -H 'referer: https://music.example.com/' \
  -H 'user-agent: Mozilla/5.0 ...'
```

### 类型 C：加密签名 / 私有协议

表现：

- 请求包含 `sign`、`sec_key`、`enc_params` 等参数
- 参数变化无规律，看似随机
- 没有 cookie 时返回 401/403

**对接策略**（按难度递增）：

1. **找开源实现**：先 GitHub 搜 `<站点名> reverse` / `<站点名> api`，多半已有人写过 Node 库
2. **定位签名生成代码**：
   - DevTools → Sources → Search 搜 `sign:` 或参数名
   - 给可疑函数下断点，单步调试
   - 拿到加密函数后，**直接拷贝 JS 实现到插件里**（一般是 MD5/AES/RSA 组合）
3. **实在搞不定**：放弃直连，找个第三方代理服务（参考类型 A）

## 浏览器 DevTools 速查

| 任务 | 操作 |
|---|---|
| 看播放音频从哪来 | Network → Filter `media` 或 `XHR` → 点击播放 |
| 看请求是怎么生成的 | 右键请求 → Copy → Copy as cURL → 验证 |
| 找加密函数 | Sources → Cmd+P 搜文件 → Cmd+F 搜参数名 |
| 单步调试 | 在 Sources 里给函数打断点，重放一次操作 |
| 看 cookie 影响 | 关掉 cookie 看接口是否仍可用 |

## 验证流程（写代码前）

**先在终端里把 API 跑通，再写到插件里**——能省下大量调试时间。

```bash
# 1. 用 curl 复刻浏览器请求
curl 'https://music.example.com/api/play?id=123' \
  -H 'cookie: <复制浏览器里的>' | jq

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
function sign(params, secret) {
  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&')
  return CryptoJS.MD5(sorted + '&key=' + secret).toString()
}
```

### AES 加密参数

```javascript
// 场景：网易云的 encSecKey 等
const key = CryptoJS.enc.Utf8.parse('010001')
const text = CryptoJS.enc.Utf8.parse(JSON.stringify(params))
const encrypted = CryptoJS.AES.encrypt(text, key, {
  mode: CryptoJS.mode.CBC,
  padding: CryptoJS.pad.Pkcs7,
}).toString()
```

### Base64 + 时间戳

```javascript
// 场景：很多简单签名其实就是 base64(json + ts)
const payload = btoa(JSON.stringify({ ...params, ts: Date.now() }))
```

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

| 现象 | 可能原因 |
|---|---|
| 导入失败"脚本缺少 getMusicUrl 方法" | 没用 `module.exports`，或者用了 `export default` |
| 播放时 Toast "无法获取音乐 URL" | 三个音质都返回 null/异常，看日志定位 |
| 一直播放 fakeAudioMp3Uri | 同上 |
| 部分歌曲能播放、部分不行 | 多半是匹配逻辑问题，看日志里的搜索结果 |
| 第一次能播第二次失败 | 大概率是 token 过期没续签 |
| iOS 上能播 Android 不能 | 检查 URL 是否 https（RN 默认禁用 cleartext） |

## 真实案例参考

项目内已有的脚本：

- **`src/helpers/userApi/ikun-music-source.js`** — 走代理服务的 lx-music 风格脚本
- **`src/helpers/userApi/xiaoqiu.js`** — 直接对接 QQ Music 的脚本（搜索 + URL）
- **`src/helpers/userApi/qq-music-api.js`** — 完整的 QQ Music API 封装，可借鉴搜索 / 加密 / 元数据接口

打开这些文件看真实实现，比看模板更有用。
