---
name: cymusic-plugin-dev
description: 为 Cymusic 音乐播放器（React Native + Expo）编写音源插件。Cymusic 插件以 JS 脚本形式动态加载，唯一职责是根据 (title, artist, songmid, quality) 返回可播放的音频 URL，搜索/歌词/专辑等元数据由内置 QQ Music 接口提供。覆盖 Cymusic 原生格式、lx-music 兼容格式、站点分析方法论、测试流程。
---

# Cymusic 音源插件开发

## 何时使用本 Skill

当用户提出以下任一需求时，**自动**进入本 Skill：

- "帮我写一个 Cymusic 的音源/插件"
- "把 XXX 站点/API 适配成 Cymusic 音源"
- "我有一个音乐 API，能不能给 Cymusic 用"
- "把这个 lx-music 脚本改成 Cymusic 格式"
- "Cymusic 插件 getMusicUrl 怎么写"
- 用户提供了一个音乐网站链接或 API 文档，希望接入

## Cymusic 插件的核心定位（非常重要）

**Cymusic 的插件协议比 MusicFree 简单得多——插件只做一件事：返回 URL。**

```
┌─────────────────────────────────────────────┐
│  Cymusic 主程序                              │
│  ├─ 搜索 / 专辑 / 歌词 → 内置 QQ Music API   │
│  └─ 拿到歌曲后调用 plugin.getMusicUrl(...)   │
│                          ↓                  │
│            插件返回可播放的 URL              │
└─────────────────────────────────────────────┘
```

**对比 MusicFree**：MusicFree 插件实现 14+ 个方法（search、getAlbumInfo、getLyric...）。
**Cymusic 插件**：只需要 1 个方法（`getMusicUrl`）。

这意味着：
- 即使一个网站只有"按 ID 取 URL"的接口，也能写成 Cymusic 插件
- 写插件的门槛极低，复用性极高
- 但插件依赖 Cymusic 内置元数据（用 QQ Music 的 songmid 作为主键去外部源换 URL）

## 支持的两种脚本格式

| 格式 | 适用场景 | 复杂度 |
|---|---|---|
| **Cymusic 原生** | 新插件、单一站点接入 | ★ 简单 |
| **lx-music 兼容** | 复用 lx-music 生态脚本 | ★★★ 复杂（事件机制） |

**默认使用 Cymusic 原生格式**。除非用户明确给出 lx-music 脚本要改造，否则不要用 lx-music 格式。

## 协议规范（Cymusic 原生格式）

```javascript
module.exports = {
  // —— 元信息 ——
  id: 'unique-plugin-id',         // 必填，全局唯一
  name: '音源名称',                // 必填，展示给用户
  author: '作者名',                // 可选
  version: '1.0.0',                // 可选，语义化版本
  srcUrl: 'https://.../plugin.js', // 可选，远程更新地址

  // —— 核心方法 ——
  getMusicUrl: async function (title, artist, songmid, quality) {
    // 参数：
    //   title:   string   歌曲名 (e.g. "晴天")
    //   artist:  string   歌手名 (e.g. "周杰伦")
    //   songmid: string   QQ Music 的 songmid（Cymusic 内部主键）
    //   quality: string   '128k' | '320k' | 'flac'
    //
    // 返回：
    //   string  可直接播放的 URL（http/https，mp3/flac 等格式）
    //   null/'' 表示获取失败，Cymusic 会自动降级到下一档音质重试
    //
    // 注意：
    //   - 不要抛错，错误用 null/'' 表达，否则会污染日志
    //   - 超时 5 秒（current 请求）/ 12 秒（preload 请求）
    //   - 沙箱内可用：fetch、axios、crypto-js、Buffer、btoa/atob
    //   - 沙箱内禁用：require（除非显式注入）、process、fs
    return 'https://example.com/play/...'
  }
}
```

## 工作流程

每次为用户开发插件时，**按顺序**执行下面的步骤：

### Step 1: 厘清数据源

主动询问/确认（如果用户没说清）：

- 数据源是 **公开 API** / **网页爬取** / **第三方代理服务**？
- 接口需要 **登录态/Cookie** 吗？需要让用户填什么？
- 支持哪些 **音质**（128k/320k/flac）？
- 用什么作为 **匹配主键**（songmid? 标题+艺人模糊匹配?）

### Step 2: 分析接口（详见 `references/site-analysis.md`）

- **API 已知**：直接看文档/示例
- **API 未知，要爬网站**：用 `curl`/浏览器 DevTools 抓包
- **加密参数**：看 `references/site-analysis.md` 的逆向思路

**输出物**：明确的"输入(songmid/title/artist) → 请求步骤 → URL"的映射关系。

### Step 3: 写插件

- 拷贝 `references/plugin-template.md` 中匹配的模板作为骨架
- 根据 Step 2 的分析填充逻辑
- **优先返回 null 而不是抛错**
- 不需要写注释解释每行代码（用户能读 JS）；只在加密/魔数等非显然的地方加一行 why

**写在哪个文件**：
- 演示/调试：直接生成一个 `.js` 文件，让用户在 App 设置里"导入音源"
- 内置参考实现：可以放到 `src/helpers/userApi/<source-name>.js`

### Step 4: 测试

提供给用户清晰的测试步骤：

1. 在 Cymusic App → 设置 → 音乐源 → 导入音源 → 选择本地文件 / 粘贴远程 URL
2. 确认导入后该音源显示为"已选中"
3. 在搜索页搜任意热门歌曲，点击播放
4. 看日志：导入的脚本会通过 `logInfo`/`logError` 输出（详见 `references/plugin-protocol.md` 的"调试技巧"段）

### Step 5: 迭代

如果不工作：

- 让用户回报 Cymusic 内的报错（一般是 "无法获取音乐 URL" Toast）
- 让用户提供日志（设置 → 日志）
- 根据日志定位是 **网络层失败**（响应码、超时） / **解析层失败**（JSON 字段不对） / **音质不匹配**（返回了空 URL 但没换音质）

## 关键约束（容易踩坑）

1. **`getMusicUrl` 必须返回字符串 URL，不是对象**。即使想返回 headers 也不支持——这是 Cymusic 比 MusicFree 弱的地方。需要 referer/UA 的资源建议在插件内部转换/代理。

2. **沙箱限制**：`new Function('module', 'exports', 'require', script)` 执行，`require` 是空函数。这意味着：
   - 不能 `require('axios')`，要用全局 `fetch`（推荐）或 `axios`（如果环境注入了）
   - 不能 `require('crypto-js')`，要用全局 `btoa/atob/TextEncoder` 或 Cymusic 注入的 crypto
   - 复杂依赖请在脚本里**内联**（拷贝必要函数）

3. **音质降级是自动的**：插件不需要自己处理"flac 失败回退到 320k"，Cymusic 的 `MusicSourceResolver` 会按 `['flac', '320k', '128k']` 顺序逐档调用。插件只需要：拿不到当前音质就返回 `null`。

4. **超时严格**：`current` 请求 5 秒、`preload` 请求 12 秒。耗时操作要并发或缓存。

5. **`songmid` 是 QQ Music 的主键**。如果你的数据源不是 QQ 系，需要做"用 songmid 反查标题艺人，再到目标源搜索"的两步走（参考 `getMusicSource.ts` 中 `searchMusicInfoByName`）。

## 参考资料

按需查阅 `references/` 下的文档：

- **`references/plugin-protocol.md`** — 协议详细规范、所有可用 API、返回值约定、错误处理、调试技巧
- **`references/plugin-template.md`** — 三种常见模式的可粘贴模板（直链 / 搜索匹配 / 加密签名）
- **`references/site-analysis.md`** — 如何分析一个音乐站点：抓包步骤、常见模式、加密参数逆向思路
- **`references/lxmusic-compat.md`** — lx-music 格式协议、与 Cymusic 原生格式的对照、改写指南

仅在需要相关信息时才打开对应文件，避免一次性加载全部参考文档。

## 输出准则

- **代码风格**：遵循项目现有风格（tabs 缩进、单引号、无分号 — 看 `src/helpers/userApi/*.js` 已有的脚本）
- **直接给可用脚本**，不要堆砌伪代码
- **不要内置真实 cookie/token**：如果接口需要凭据，用脚本顶部 `const COOKIE = ''` 占位，让用户填
- **不要主动新增搜索/歌词等接口**：Cymusic 的协议不需要这些，加了也没用
- **测试时使用真实歌曲**：用"周杰伦 晴天"或"Taylor Swift Love Story"等大众曲目验证，不要用冷门歌
- **法律提示**：脚本内不要硬编码绕开版权的逻辑；写完后简短提醒用户"仅供学习交流，遵守当地法律"

## 不要做的事

- ❌ 不要让插件调用 React Native API（AsyncStorage、Alert 等）—— 沙箱里没有
- ❌ 不要写 ES Module（`export default`）—— 必须 CommonJS（`module.exports = { ... }`）
- ❌ 不要在插件里实现搜索/歌单/歌词 —— Cymusic 协议不识别这些方法
- ❌ 不要假定 `axios`/`crypto-js` 可用 —— 优先用全局 `fetch` 和 Web 标准 API
- ❌ 不要在每首歌都重新登录/取 token —— 把 token 缓存到模块作用域
