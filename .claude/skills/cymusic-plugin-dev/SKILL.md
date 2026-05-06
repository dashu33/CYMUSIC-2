---
name: cymusic-plugin-dev
description: >
  从零开始开发 Cymusic 音乐播放器（React Native + Expo）音源插件的完整指南。
  当用户要求编写、创建、开发 Cymusic 插件，或要求将某个音乐网站、API 适配为 Cymusic 音源时触发。
  Cymusic 插件协议非常简单——唯一职责是根据 (title, artist, songmid, quality) 返回可播放的音频 URL，
  搜索 / 歌词 / 专辑等元数据由 Cymusic 内置 QQ Music 接口提供。
  涵盖：Cymusic 原生格式与 lx-music 兼容格式、沙箱限制、站点分析方法论、本地测试、发布更新等完整流程。
  本 Skill 面向 AI 执行，指导 AI 与零基础用户协作完成插件开发。
---

# Cymusic 音源插件开发

## 严格行为准则

以下规则在整个插件开发过程中**始终生效**，违反将导致开发失败：

1. **禁止盲猜 URL**：不要凭空试 `/api/song`、`/v1/url`、`/play/123` 等路径。每个 URL 必须来自页面内容或 Playwright 捕获的网络请求
2. **禁止搜索网络寻找 API**：不要搜索"XX音乐 API"、"免费音乐接口"等。所有数据来源必须通过对目标站点的直接观察获得，不能来自网络搜索
3. **禁止批量探测**：不要同时发多个请求试不同的参数组合、音质、ID
4. **禁止重复请求**：每个 URL 只请求一次，结果保存到本地文件后基于本地数据分析
5. **禁止放弃说"需要浏览器环境"**：axios 失败但浏览器可以访问，差别一定在请求头上，用 Playwright 捕获真实请求头后在 axios 中补全
6. **禁止用 `require` 引入第三方库**：Cymusic 插件沙箱里 `require` 是 noop，所有依赖必须是全局可用的 Web API（详见"沙箱环境"段）。MusicFree 风格的 `require('axios')`/`require('cheerio')` 在 Cymusic **不可用**
7. **禁止返回对象**：`getMusicUrl` 必须返回字符串 URL（或 `null`/`''`），不要返回 `{ url, headers }`——这是 Cymusic 比 MusicFree 弱的地方，不支持 headers 透传

**当遇到困难时，唯一正确的做法是：用 Playwright 观察浏览器的真实行为。不要猜测，不要搜索，去观察。**

## 角色与协作模式

- **AI（你）**：分析目标站点、编写插件代码、编写并执行测试脚本、迭代修复
- **用户**：提供目标站点/API 信息，仅在 AI 无法独立完成时执行辅助操作（如登录、提供 Cookie、在真机上测试导入）

### 核心原则：最小化用户操作

**能自己做的，绝不让用户做。** 遵循以下优先级：

1. **AI 独立完成**：直接用工具抓取页面、分析 HTML/JS、在终端运行脚本
2. **AI 做 + 用户确认**：AI 分析后给出结论，请用户确认是否正确
3. **用户操作（最后手段）**：仅当 AI 的工具无法获取到所需数据时（需要登录、设备指纹、真机环境等），才让用户在浏览器或 App 中操作

### 与用户交互原则

- 用户可能是零基础，**不要使用未解释的技术术语**
- 需要用户操作时，给出**精确到按键级别的逐步指令**，每次只下达一个操作
- 主动告知用户当前进度和下一步计划
- **不确定时必须询问**：当对站点行为、API 含义、数据字段映射不确定时，先问再做

## Cymusic 插件的核心定位（非常重要）

**Cymusic 的插件协议比 MusicFree 简单一个数量级——插件只做一件事：返回 URL。**

```
┌─────────────────────────────────────────────┐
│  Cymusic 主程序                              │
│  ├─ 搜索 / 专辑 / 歌词 → 内置 QQ Music API   │
│  └─ 拿到歌曲后调用 plugin.getMusicUrl(...)   │
│                          ↓                  │
│            插件返回可播放的 URL              │
└─────────────────────────────────────────────┘
```

| 维度       | MusicFree                                | **Cymusic**                       |
| ---------- | ---------------------------------------- | --------------------------------- |
| 插件方法数 | 14+（search、getAlbumInfo、getLyric...） | **仅 1 个**（`getMusicUrl`）      |
| 元数据来源 | 由插件提供                               | 由内置 QQ Music API 提供          |
| 主键       | 插件自定义                               | **固定为 QQ 的 songmid**          |
| 沙箱依赖   | axios/cheerio/crypto-js 注入             | **只有全局 fetch + Web 标准 API** |
| `require`  | 白名单注入                               | **noop（不可用）**                |
| 返回值     | `{ url, headers, ... }` 对象             | **字符串 URL**                    |
| 多格式     | 单一                                     | **Cymusic 原生 + lx-music 兼容**  |

含义：

- 即使一个网站只有"按 ID 取 URL"的接口，也能写成 Cymusic 插件
- 写插件门槛极低，但能力上限也低（不能透传 headers、不能自定义元数据）
- 插件依赖 Cymusic 内置元数据（用 QQ Music 的 songmid 作为主键去外部源换 URL）

## 工作流程

```
1. 检查环境 → 2. 收集信息 → 3. 判断路径 → 4. 分析数据源
→ 5. 编写插件 → 6. 本地测试 → 7. 真机验证 → 8. 输出最终插件
```

### 步骤 1：检查开发环境

**先检查环境**（在做任何其他事之前）：

1. 检查 Node.js 是否可用：`node --version`
2. 询问用户：电脑上是否安装了 Chrome 或 Edge 浏览器？安装路径是什么？（Playwright 可以复用已安装的浏览器，避免下载 Chromium）
3. 如需站点抓包，安装 Playwright：`npm install -D playwright`（用 `channel: 'chrome'` 复用用户的 Chrome）

### 步骤 2：收集信息

主动询问/确认：

- 目标是什么？（公开 API 文档？某个音乐网站？已有的代理服务？lx-music 脚本要改写？）
- 数据源**是否需要 Cookie/登录态**？
- 支持哪些**音质**（128k/320k/flac）？
- 插件**作者名**（写入 `author` 字段）

### 步骤 3：判断路径

根据收集到的信息，选择对应路径：

**路径 A：用户提供了 API 文档或代理服务接口**
→ 阅读文档 → 直接编写 `getMusicUrl` → 跳到步骤 5

**路径 B：用户给了 lx-music 脚本**
→ 判断是改写为 Cymusic 原生格式，还是直接走 lx-music 兼容适配器
→ 详见 [references/lxmusic-compat.md](references/lxmusic-compat.md)

**路径 C：用户提供了网站 URL（页面内容直接可抓取）**
→ 用工具抓取页面 HTML → 分析音频 `<audio>` 标签或嵌入数据
→ 详见 [references/site-analysis.md](references/site-analysis.md) "静态站点分析"

**路径 D：用户提供了网站 URL（需逆向分析内部 API）**
页面通过内部 API 异步加载音频，没有公开文档。需要**观察浏览器的实际行为，然后用 fetch 精确复现**。

核心方法论——**观察 → 分析 → 复现 → 验证**：

1. **观察**：用 Playwright 加载页面，捕获所有网络请求，保存到本地
2. **分析**：基于本地缓存的数据做离线分析，找到关键的音频/URL 接口
3. **复现**：用 fetch 复现相同的请求（包括完整的 Headers）
4. **验证**：在终端测试，如果失败则对比 Playwright 捕获的请求头与 fetch 请求头的差异

→ 详见 [references/site-analysis.md](references/site-analysis.md)

### 步骤 4：分析数据源

**快速预判站点类型**：抓取目标 URL 的 HTML，检查内容：

- HTML 中包含直接的音频链接（`<audio src="...">`、`<source>`、嵌入的 `mp3` URL）→ 静态站点
- HTML 很小（骨架）、大量 `<script>` 标签、核心内容区域为空 → SPA 站点，**直接用 Playwright**
- 看到明显的 API 调用（如 `/api/play?id=xxx`）→ 用 Playwright 抓完整请求

遵循"**观察-分析-复现-验证**"方法论。

关键规则：

- **所有抓取内容先保存到本地文件**，后续基于本地文件分析，避免重复请求
- **不要盲猜 URL**——每个 API 端点必须来自页面内容或网络请求的实际观察
- 推断出的 API 和数据结构不确定时 → **向用户确认**

### 步骤 5：编写插件

- 拷贝下面"插件骨架"作为起点
- 按 [references/plugin-template.md](references/plugin-template.md) 中匹配的模式（直链型/搜索匹配型/加密签名型）填充逻辑
- **优先返回 `null` 而不是抛错**（让 Cymusic 自动降级到下一档音质重试）
- 不需要写注释解释每行代码（用户能读 JS）；只在加密/魔数等非显然的地方加一行 why

### 步骤 6：本地测试

写完后**先在 Node.js 里跑通**，再让用户进 App 测试。详见下文"测试流程"。

### 步骤 7：真机验证

让用户在 Cymusic App 里实际导入并播放：

1. 把脚本保存为 `.js` 文件（可以是本地路径或 GitHub Raw 链接）
2. App → 设置 → 音乐源 → 导入音源
3. 搜索一首大众歌曲（如"周杰伦 晴天"）→ 点击播放
4. 看 App 内日志（设置 → 日志）排查问题

### 步骤 8：输出最终插件

- 一个独立的 `.js` 文件
- 含完整的元信息（id/name/author/version/srcUrl）
- 顶部注释清晰标注数据来源、需要的 Cookie/Token、维护者
- 提示用户保存路径和导入方式

## 插件骨架（Cymusic 原生格式）

```javascript
// ===== 元信息 =====
const PLUGIN_ID = 'unique-plugin-id' // 必填，全局唯一
const PLUGIN_NAME = '音源名称' // 必填，展示给用户
const PLUGIN_VERSION = '1.0.0'
const PLUGIN_AUTHOR = '作者名'

// ===== 用户配置（如需 Cookie/Token，让用户在脚本顶部填写）=====
const USER_COOKIE = '' // TODO: 用户填自己的 Cookie

// ===== 日志前缀（方便在 App 日志里过滤）=====
const LOG = '[' + PLUGIN_NAME + ']'

// ===== 业务逻辑 =====
async function getMusicUrlImpl(title, artist, songmid, quality) {
	// 你的实现
	return null
}

// ===== 导出（必须用 module.exports，不能用 export default）=====
module.exports = {
	id: PLUGIN_ID,
	name: PLUGIN_NAME,
	author: PLUGIN_AUTHOR,
	version: PLUGIN_VERSION,
	srcUrl: '', // 远程更新地址（GitHub Raw URL）

	getMusicUrl: async function (title, artist, songmid, quality) {
		try {
			return await getMusicUrlImpl(title, artist, songmid, quality)
		} catch (e) {
			console.log(LOG, 'failed:', e.message)
			return null // 让 Cymusic 自动降级到下一档音质
		}
	},
}
```

## 协议速查

### 元信息字段

| 字段      | 必填 | 说明                                                  |
| --------- | ---- | ----------------------------------------------------- |
| `id`      | 是   | 全局唯一 ID，建议 `域名+功能` 形式，如 `kw-public-v1` |
| `name`    | 是   | 展示给用户的名字                                      |
| `author`  | 否   | 作者                                                  |
| `version` | 否   | 语义化版本，便于更新检测                              |
| `srcUrl`  | 否   | 远程更新地址（GitHub Raw URL）                        |

### `getMusicUrl` 签名

```typescript
async function getMusicUrl(
	title: string, // 歌曲名
	artist: string, // 歌手名（可能含分隔符 "、"）
	songmid: string, // QQ Music 的 songmid（Cymusic 内部主键）
	quality: string, // '128k' | '320k' | 'flac'
): Promise<string | null>
```

### 返回值约定

| 返回                | 含义       | Cymusic 行为             |
| ------------------- | ---------- | ------------------------ |
| `'https://....mp3'` | 成功       | 立即播放                 |
| `null` 或 `''`      | 当前音质无 | 自动降级到下一档音质重试 |
| `throw Error`       | 异常       | 同上，会留日志           |
| 非 http(s) 字符串   | 视为失败   | 降级重试                 |

**最佳实践**：用 `null` 表示"无此音质"，用 `throw` 表示"接口完全挂了"。前者降级安静，后者会留日志便于排查。

完整规范详见 [references/plugin-protocol.md](references/plugin-protocol.md)。

## 沙箱环境

Cymusic 通过 `new Function('module', 'exports', 'require', script)` 加载插件。

### 全局可用 API（来自 React Native 运行时）

| 类别         | 可用                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------- |
| 网络         | `fetch`                                                                                  |
| 编码         | `btoa`, `atob`, `TextEncoder`, `TextDecoder`, `encodeURIComponent`, `decodeURIComponent` |
| Buffer       | `Buffer`（来自 polyfill）                                                                |
| Promise/异步 | `Promise`, `async/await`, `setTimeout`, `setInterval`                                    |
| JSON         | `JSON.parse`, `JSON.stringify`                                                           |
| URL          | `URL`, `URLSearchParams`                                                                 |
| 字符串/对象  | 全部 ES 标准                                                                             |
| 日志         | `console.log`, `console.warn`, `console.error`（会被 Cymusic 转发到 App 日志）           |

### 不可用

| 类别      | 不可用                                   | 替代方案                                                 |
| --------- | ---------------------------------------- | -------------------------------------------------------- |
| 模块系统  | `require()` 是 noop                      | 把所有依赖代码内联到脚本                                 |
| 加密      | `crypto-js`、Node `crypto`               | 自己内联 MD5/SHA1 实现，或用 `crypto.subtle`（如果可用） |
| HTML 解析 | `cheerio`                                | 用正则/字符串切片，或在远端做解析                        |
| Node API  | `fs`, `path`, `process`, `child_process` | —                                                        |
| RN API    | `AsyncStorage`, `Alert`, `Platform`      | —                                                        |

**经验法则**：能用 Web 标准 API 就用 Web 标准 API。`fetch` 比 `axios` 更稳。

## 开发模式示例

### 模式一：直链型（最简单）

第三方代理服务，传 `(songmid, quality)` 直接返回 URL：

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
		const qMap = { '128k': '128', '320k': '320', flac: 'flac' }
		try {
			const res = await fetch(`${API_BASE}/url?mid=${songmid}&quality=${qMap[quality] || '128'}`)
			if (!res.ok) return null
			const data = await res.json()
			return data?.url || null
		} catch (e) {
			console.log(LOG, e.message)
			return null
		}
	},
}
```

### 模式二：搜索匹配型（跨源使用）

目标源不认 QQ 的 songmid，需要用 title+artist 搜索匹配后再取 URL：

```javascript
const SEARCH_API = 'https://music-api.example.com/search'
const URL_API = 'https://music-api.example.com/song'
const LOG = '[search-match]'

const matchCache = new Map() // songmid -> { id, expireAt }

async function findMatchedId(title, artist, songmid) {
	const cached = matchCache.get(songmid)
	if (cached && Date.now() < cached.expireAt) return cached.id

	const res = await fetch(
		`${SEARCH_API}?keyword=${encodeURIComponent(title + ' ' + artist)}&limit=10`,
	)
	if (!res.ok) return null
	const list = (await res.json())?.data?.songs || []
	const norm = (s) =>
		String(s || '')
			.toLowerCase()
			.replace(/\s+/g, '')
	const matched =
		list.find(
			(s) => norm(s.name) === norm(title) && norm(s.artist).includes(norm(artist).split('、')[0]),
		) || list[0]
	if (!matched) return null
	matchCache.set(songmid, { id: matched.id, expireAt: Date.now() + 60 * 60 * 1000 })
	return matched.id
}

module.exports = {
	id: 'search-match-v1',
	name: '搜索匹配音源',
	// ...
	getMusicUrl: async function (title, artist, songmid, quality) {
		try {
			const targetId = await findMatchedId(title, artist, songmid)
			if (!targetId) return null
			const qMap = { '128k': 'standard', '320k': 'higher', flac: 'lossless' }
			const res = await fetch(`${URL_API}?id=${targetId}&level=${qMap[quality] || 'standard'}`)
			const data = await res.json()
			return data?.data?.[0]?.url || null
		} catch (e) {
			console.log(LOG, e.message)
			return null
		}
	},
}
```

### 模式三：加密签名型

接入有反爬的官方接口（如需 token + sign），详见 [references/plugin-template.md](references/plugin-template.md) "模板 3"。

## 测试流程

### 第一阶段：Node.js 本地测试

完成插件编写后，**先在 Node 里跑通核心逻辑**（避免反复进 App 调试）。

由于 Cymusic 用 `new Function('module', 'exports', 'require', script)` 加载脚本，本地测试时也用同样方式加载，更接近真实运行环境：

```javascript
// test-plugin.js
const fs = require('fs')

const script = fs.readFileSync('./my-plugin.js', 'utf-8')
const module = { exports: {} }
const require_noop = () => {} // 模拟 Cymusic 沙箱里 require 是 noop
const moduleFunc = new Function('module', 'exports', 'require', script)
moduleFunc(module, module.exports, require_noop)

const plugin = module.exports

async function test() {
	console.log('=== 插件元信息 ===')
	console.log('  id:', plugin.id)
	console.log('  name:', plugin.name)
	console.log('  version:', plugin.version)

	if (typeof plugin.getMusicUrl !== 'function') {
		console.error('✗ getMusicUrl 不是函数')
		return
	}

	console.log('\n=== 测试 getMusicUrl ===')
	const testCases = [
		{ title: '晴天', artist: '周杰伦', songmid: '0039MnYb0qxYhV', quality: '320k' },
		{ title: 'Love Story', artist: 'Taylor Swift', songmid: '004edRdg0Yot7q', quality: '128k' },
	]

	for (const tc of testCases) {
		console.log(`\n  ▶ ${tc.title} - ${tc.artist} (${tc.quality})`)
		try {
			const url = await plugin.getMusicUrl(tc.title, tc.artist, tc.songmid, tc.quality)
			if (typeof url === 'string' && /^https?:/.test(url)) {
				console.log('  ✓ URL:', url.substring(0, 80) + '...')
			} else {
				console.log('  ✗ 返回值不合法:', url)
			}
		} catch (e) {
			console.log('  ✗ 异常:', e.message)
		}
	}
}

test()
```

执行：

```bash
node test-plugin.js
```

**测试要点**：

- 至少跑两首大众歌曲（避免冷门歌找不到）
- 验证返回值是 http(s) 字符串
- 测试音质降级逻辑：故意传 `flac`，看是否会优雅返回 `null` 而不是抛错
- 注意：本地 Node 没有 React Native 的 polyfill（`Buffer`/`btoa` 等可能行为略不同）

### 第二阶段：App 内真机测试

Node 测试通过后，让用户在 App 里导入：

1. 提供给用户脚本文件（保存为 `.js` 或上传到 GitHub 取 Raw 链接）
2. 用户操作：Cymusic App → 设置 → 音乐源 → 导入音源 → 选文件 / 粘贴 URL
3. 确认导入后该音源显示为"已选中"
4. 搜索"周杰伦 晴天"→ 点击播放
5. 看 App 内日志（设置 → 日志），过滤插件的日志前缀

**真机失败的常见原因**：

- 缺少 RN 没有的全局 API（如某些 polyfill）
- iOS ATS 拒绝 http URL（必须 https）
- Cookie/Token 过期
- 网络环境差异（移动网络 vs 公司网络）

## 发布与更新

### 托管到 GitHub

1. 创建一个 GitHub 仓库（或使用已有仓库）
2. 将插件 `.js` 文件上传到仓库
3. 获取文件的 Raw 链接（格式：`https://raw.githubusercontent.com/<用户>/<仓库>/<分支>/<文件>.js`）
4. 将此链接填入插件的 `srcUrl` 字段（启用 App 内自动更新检测）

### 用户安装

用户在 Cymusic 中通过 "设置 → 音乐源 → 导入音源 → 输入 URL" 功能，粘贴 Raw 链接即可安装。

### 版本更新

1. 修改 `version` 字段（语义化版本，如 `"1.0.0"` → `"1.0.1"`）
2. 提交并推送到 GitHub
3. 用户在 App 内重新导入或点击更新即可获取新版本

## 注意事项

- **错误处理**：用 `null`/`''` 表达"无此音质"（让系统优雅降级），用 `throw` 表达"完全挂了"（会留日志）
- **不要硬编码用户凭据**：脚本顶部用 `const USER_COOKIE = ''` 占位，让用户填
- **音质降级是自动的**：插件不需要自己尝试不同音质，Cymusic 的 `MusicSourceResolver` 会按 `['flac', '320k', '128k']` 顺序逐档调用
- **超时严格**：`current` 请求 5 秒、`preload` 请求 12 秒。耗时操作要并发或缓存 token
- **Token 缓存**：把 token/cookie 缓存到模块顶层变量，不要每次重新登录
- **iOS 必须 https**：iOS App Transport Security 默认禁止明文 http
- **法律提示**：脚本头部注释标注数据来源、协议、维护者。提醒用户"仅供学习交流，遵守当地法律"
- **不要做 RN 调用**：沙箱里没有 `AsyncStorage`、`Alert`、`Platform` 等
- **不要写 ESM**：必须 `module.exports = { ... }`，不能 `export default`

## 不要做的事

- ❌ 不要让插件实现搜索/歌单/歌词 —— Cymusic 协议不识别这些方法
- ❌ 不要 `require('axios')` 之类 —— 沙箱 `require` 是 noop
- ❌ 不要返回 `{ url, headers, ... }` 对象 —— 必须返回字符串
- ❌ 不要假定 `crypto-js` 全局可用 —— 需要内联实现
- ❌ 不要在每首歌都重新登录/取 token —— 把 token 缓存到模块作用域
- ❌ 不要用 ES Module 语法（`import`/`export`） —— 必须 CommonJS

## 参考资料

按需查阅 `references/` 下的文档（仅在需要相关信息时打开，避免一次性加载全部）：

- **[references/plugin-protocol.md](references/plugin-protocol.md)** — 协议详细规范、沙箱内可用 API、返回值约定、错误处理、调试技巧
- **[references/plugin-template.md](references/plugin-template.md)** — 三种常见模式的可粘贴模板（直链 / 搜索匹配 / 加密签名）+ 通用辅助片段
- **[references/site-analysis.md](references/site-analysis.md)** — 站点分析方法论：Playwright 抓包步骤、常见模式、加密参数逆向思路、出错排查清单
- **[references/lxmusic-compat.md](references/lxmusic-compat.md)** — lx-music 格式协议、与 Cymusic 原生格式的对照、改写指南
