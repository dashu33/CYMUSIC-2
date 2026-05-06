# lx-music 兼容格式

Cymusic 通过 `src/helpers/userApi/lxMusicSourceAdapter.ts` 适配了 lx-music 的脚本格式，让用户可以直接用 lx-music 生态的源。

**重要**：除非用户明确要用/改造 lx-music 脚本，**默认应该用 Cymusic 原生格式**。原生格式简单一倍。

## 何时使用 lx-music 格式

- 用户给了一份现成的 lx-music 脚本，要直接接入
- 用户要复用 lx-music 公益源（如 `ikun-music-source.js`）
- 用户希望脚本同时兼容 lx-music 桌面/移动客户端

## 格式识别（来自 `lxMusicSourceAdapter.ts`）

判定为 lx-music 脚本需同时满足：

```ts
function isLxMusicScript(script: string): boolean {
  const hasHeader = /^\/\*[\s\S]+?\*\//.test(script.trim())  // 顶部块注释
  const hasLxApi  = /\bEVENT_NAMES\b|lx\s*\.\s*(on|send)|globalThis\s*\.\s*lx/.test(script)
  const isCymusic = /module\s*\.\s*exports\s*\.\s*getMusicUrl/.test(script)
  return hasHeader && hasLxApi && !isCymusic
}
```

简言之：**有 `/* */` 头注释 + 用 `lx.on/send`/`EVENT_NAMES`，且没有 `module.exports.getMusicUrl`**。

## 头注释（必须）

```javascript
/*!
 * @name 音源名称
 * @description 描述
 * @version 1.0.0
 * @author 作者
 * @homepage https://example.com
 */
```

支持字段：`@name`、`@description`、`@version`、`@author`、`@homepage`。

## 事件机制（核心）

lx-music 脚本运行在 **QuickJS 原生引擎** 中（不是 Cymusic 的 JS 沙箱），通过事件和 JS-land 通信：

```javascript
// 监听请求
lx.on(EVENT_NAMES.request, (data, sendResponse) => {
  const { source, action, info } = data
  // action: 'musicUrl' | 'lyric' | 'pic' 等
  // info.musicInfo: { id, songmid, title, singer, ... }
  // info.type: 音质（'128k' | '320k' | 'flac'）

  if (action === 'musicUrl') {
    handleGetUrl(source, info.musicInfo, info.type)
      .then(url => sendResponse(null, { action: 'musicUrl', data: { url } }))
      .catch(err => sendResponse(err, null))
  }
})
```

Cymusic 的适配器（`adaptLxMusicScript`）会：

1. 把脚本加载到 QuickJS（`loadScript`）
2. 监听脚本内的 HTTP 请求事件，由 JS-land 的 fetch 代理执行（脚本本身不能直接 fetch）
3. 把 Cymusic 的 `getMusicUrl(title, artist, songmid, quality)` 调用转成 `request` 事件给脚本
4. 拿到脚本的 `response` 事件后取 `result.data.url` 返回给主程序

## 脚本里的 HTTP 请求

lx-music 脚本里 **不能直接 `fetch`**，必须用 lx 的请求 API：

```javascript
const request = lx.request || lx.utils?.request
// 用法
const { body, statusCode } = await request(url, {
  method: 'GET',
  headers: { ... },
  timeout: 5000,
})
```

Cymusic 的 `handleHttpRequest` 函数会代理这个请求并把结果发回脚本。

## 与 Cymusic 原生格式的对照

| 维度 | Cymusic 原生 | lx-music |
|---|---|---|
| 入口 | `module.exports.getMusicUrl` | `lx.on(EVENT_NAMES.request, ...)` |
| 元信息 | `module.exports.{ id, name, author, ... }` | 顶部块注释 `@name` 等 |
| HTTP | 直接用全局 `fetch` | 必须用 `lx.request` |
| 运行时 | 普通 JS 沙箱（Function 构造）| QuickJS 原生引擎 |
| 复杂度 | ★ | ★★★ |

## lx-music → Cymusic 改写步骤

如果用户要把一个 lx-music 脚本改成 Cymusic 原生格式：

1. **去掉 `lx.on(EVENT_NAMES.request, ...)` 的事件监听**
2. **把响应处理函数改成 `getMusicUrl(title, artist, songmid, quality)`**
3. **`lx.request` 全部替换为 `fetch`**：
   ```javascript
   // 旧
   const { body } = await lx.request(url, { headers })
   // 新
   const res = await fetch(url, { headers })
   const body = await res.json()
   ```
4. **去掉头部 `/* @name ... */` 注释，改用 `module.exports`**：
   ```javascript
   module.exports = {
     id: 'xxx',
     name: '...',
     // ...
     getMusicUrl: async (title, artist, songmid, quality) => { ... }
   }
   ```
5. **多源选择**：lx-music 脚本通常返回多个源（kw/kg/tx/wy/mg），改写时选一个目标源即可（或者按 quality 决定走哪个）

## 不要改写的场景

如果 lx-music 脚本里大量使用 `lx.utils.crypto`、`lx.env`、`lx.version` 等专有 API，改写成 Cymusic 原生格式工作量很大，**直接用 Cymusic 的 lx-music 适配器加载更划算**。

判断标准：脚本里 `lx.` 调用超过 5 处 → 不改写，直接用适配器。
