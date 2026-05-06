# Cymusic 插件协议详细规范

## 加载机制

Cymusic 通过 `createMusicApiFromScript` 函数加载插件（`src/helpers/userApi/importMusicSource.ts`）：

```ts
const module = { exports: {} }
const require = () => {}                                    // require 被设为 noop
const moduleFunc = new Function('module', 'exports', 'require', script)
moduleFunc(module, module.exports, require)

if (typeof module.exports.getMusicUrl !== 'function') {
  throw new Error('脚本缺少 getMusicUrl 方法')
}
```

含义：

- 脚本在 **隔离的函数作用域** 中执行，不污染全局
- 脚本必须用 `module.exports = { ... }` 导出（不是 `export default`）
- **`require` 是空函数**——所有依赖必须是脚本内可用的全局/Web API
- **唯一硬约束**：`module.exports.getMusicUrl` 必须是函数，否则导入失败

## 沙箱内可用的 API

| 类别 | 可用 | 不可用 |
|---|---|---|
| 网络 | `fetch`, `axios`（项目级别注入）| - |
| 编码 | `btoa`, `atob`, `TextEncoder`, `TextDecoder` | - |
| Buffer | `Buffer`（来自 polyfill） | - |
| Promise/异步 | `Promise`, `async/await`, `setTimeout` | - |
| JSON | `JSON.parse`, `JSON.stringify` | - |
| URL | `URL`, `URLSearchParams` | - |
| 字符串 | 全部 ES 标准 | - |
| 加密 | `crypto-js`（项目注入）| Node `crypto` |
| RN | - | `AsyncStorage`, `Alert`, `Platform` |
| Node | - | `fs`, `path`, `process`, `child_process` |

**经验法则**：能用 Web 标准 API 就用 Web 标准 API。`fetch` 比 `axios` 更稳。

## 字段定义（元信息）

```javascript
module.exports = {
  id: 'string',         // 必填。全局唯一，建议用 域名+功能 形式：'kw-public-v1'
  name: 'string',       // 必填。展示给用户的名字
  author: 'string',     // 可选
  version: 'string',    // 可选。语义化版本，便于更新检测
  srcUrl: 'string',     // 可选。远程更新地址（直链 .js）
  getMusicUrl: Function // 必填。详见下文
}
```

## getMusicUrl 详细规范

### 签名

```typescript
async function getMusicUrl(
  title: string,        // 歌曲名
  artist: string,       // 歌手名（可能含分隔符 "、"）
  songmid: string,      // QQ Music 的 songmid（注意不是 id）
  quality: string,      // '128k' | '320k' | 'flac'
  // 第 5 个参数 requestContext 在 lx-music 适配器里有用，
  // Cymusic 原生格式可以忽略
): Promise<string | null>
```

### 返回值约定

| 返回 | 含义 | Cymusic 行为 |
|---|---|---|
| `'https://....mp3'` | 成功 | 立即播放 |
| `''`（空字符串）| 当前音质无 | 自动降级到下一档音质重试 |
| `null` | 当前音质无 | 自动降级到下一档音质重试 |
| `throw Error` | 异常 | 当前音质失败，降级重试 |
| 非 http(s) 字符串 | 视为失败 | 降级重试 |

**最佳实践**：用 `null` 表示"无此音质"，用 `throw` 表示"接口完全挂了"。前者降级更安静，后者会留日志。

### 音质降级流程（来自 `MusicSourceResolver.ts`）

```
用户当前选 flac
  ├─ 调用 getMusicUrl(..., 'flac')   → null 或异常
  ├─ 调用 getMusicUrl(..., '320k')   → null 或异常
  └─ 调用 getMusicUrl(..., '128k')   → 仍 null/异常 → 提示"无法获取音乐"
```

降级触发后会 Toast "已自动切换至 XXX 音质" 并把全局音质设置同步降低。

## 调用上下文

每次播放会调用插件至少一次：

```
用户点歌 → MusicSourceResolver.resolveSource(item)
            ├─ 检查本地缓存 / 预加载缓存
            ├─ 没命中 → 调用 nowMusicApi.getMusicUrl(title, artist, songmid, quality)
            └─ 拿到 URL → 交给 react-native-track-player 播放
```

预加载（preload）模式会提前调用 `getMusicUrl`，**插件应该是幂等的**——同样的输入应返回同样的 URL（或一致的失败）。

## 错误处理与日志

### 推荐模式

```javascript
module.exports.getMusicUrl = async function (title, artist, songmid, quality) {
  try {
    const res = await fetch(buildUrl(songmid, quality))
    if (!res.ok) return null   // 网络层失败 → 返回 null 让系统降级
    const data = await res.json()
    if (data.code !== 0) return null  // 业务层失败 → 同上
    return data.url             // 成功 → 字符串 URL
  } catch (e) {
    console.log('[my-plugin]', e.message)  // 日志会被 Cymusic 转发
    return null
  }
}
```

### 日志输出

脚本中的 `console.log` / `console.error` 会被 Cymusic 内部 logger 转发到 App 内日志页（设置 → 日志）。

**调试小技巧**：在脚本里加唯一前缀方便过滤：

```javascript
const LOG_PREFIX = '[my-source]'
console.log(LOG_PREFIX, 'fetching', songmid)
```

## 性能与超时

| 请求类型 | 超时 | 触发场景 |
|---|---|---|
| `current` | 5 秒 | 用户点击播放当下 |
| `preload` | 12 秒 | 后台预加载下一首 |

**优化策略**：

- token/cookie 缓存到模块顶层变量（不要每次重新登录）
- 第一次成功的 URL 可以做内存缓存（用 songmid+quality 做 key）
- 多个候选 URL 并发请求，用 `Promise.race` 取最快的

```javascript
let cachedToken = null
let tokenExpire = 0

async function getToken() {
  if (cachedToken && Date.now() < tokenExpire) return cachedToken
  const r = await fetch('https://.../auth')
  const d = await r.json()
  cachedToken = d.token
  tokenExpire = Date.now() + 30 * 60 * 1000  // 30 分钟
  return cachedToken
}
```

## 跨源主键转换（重要）

Cymusic 的 `songmid` 来自 **QQ Music**。如果你接入的源不是 QQ 系（比如酷我、网易云），需要"用 songmid 反查歌名歌手，再到目标源搜索"。

**方案 A**：用 title + artist 直接搜目标源（最常用）

```javascript
async function getMusicUrl(title, artist, songmid, quality) {
  // 1. 用 title + artist 搜目标源
  const searchUrl = `https://target-source/search?keyword=${encodeURIComponent(title + ' ' + artist)}`
  const res = await fetch(searchUrl)
  const list = (await res.json()).data
  // 2. 找到最相似的（title + artist 都匹配）
  const matched = list.find(s => s.title === title && s.artist.includes(artist))
  if (!matched) return null
  // 3. 拿到目标源的 ID 后取 URL
  return await getUrlFromTargetSource(matched.id, quality)
}
```

**方案 B**：用 songmid 走代理服务（如果代理服务支持）

```javascript
async function getMusicUrl(title, artist, songmid, quality) {
  return await fetch(`${API_BASE}/by-qqmid/${songmid}/${quality}`)
    .then(r => r.json())
    .then(d => d.url)
}
```

参考 `src/helpers/userApi/getMusicSource.ts` 中的 `getMusicFromKw`、`searchMusicInfoByName` 已经实现了"QQ → 酷我"的反查，可以借鉴。

## 调试技巧

1. **导入测试**：把脚本保存为 `.js` 文件，从 App 设置导入
2. **日志查看**：设置 → 日志，搜索你的 LOG_PREFIX
3. **快速迭代**：把脚本放在 GitHub Gist，App 里用 URL 导入并设置自动更新
4. **接口验证**：先在浏览器 DevTools / curl 里跑通 API，再写到脚本里

## 安全注意事项

- 脚本是用户级代码，**不要硬编码 token / 个人 cookie**——要让用户填
- 如果脚本会被分发，请在脚本头注释声明数据来源、协议、维护者
- 遵循 Cymusic 协议（README 中"项目协议"段）：免费、非商业、用户 24 小时清理版权数据
