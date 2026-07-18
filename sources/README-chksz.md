# ChKSz 门户自适应音源

## 推荐用法

在 CyMusic 设置中：

1. 打开「导入音源」
2. 选择「从 URL 导入」
3. 直接填：

```text
https://api.chksz.com/
```

## 一键刷新

设置 → 自定义音源 → **刷新门户音源**

会重新抓取官网接口列表。  
如果还没有门户音源，会自动安装 `https://api.chksz.com/`。

## 匹配策略（v1.1）

播放时按顺序尝试：

1. QQ mid 直解析
2. QQ 多关键词搜索 + 严格歌手匹配
3. 网易云多关键词搜索 + 音质降级
4. 酷狗多关键词搜索

匹配增强：

- 歌手必须命中，否则丢弃
- 惩罚 cover/remix/live/翻唱/女声等脏结果
- 惩罚 `周杰伦-/A-LNK` 这类污染歌手名
- 多搜索词：`歌名 歌手` / `歌名` / `歌手 歌名`

## 相关文件

- `sources/chksz-portal.js`
- `src/helpers/userApi/chkszPortalSource.ts`
- `src/helpers/userApi/importMusicSource.ts`
- `src/helpers/trackPlayerIndex.ts`
- `src/app/(modals)/settingModal.tsx`
