# TypeLingo

通过跟打日语例句，联结汉字、读音与语义，熟悉助词和句型。

**[在线使用](https://wjin999.github.io/Typelingo/)** · 无需注册，建议先开启日语输入法。

## 使用

- 内置 egg rolls JLPT N5–N1 卡组，共 15,891 条例句与短语，支持中文翻译和假名注音。
- **记忆复习**：先尝试回忆读音，完成跟打后显示注音并锁定输入；按 **1 重来 / 2 困难 / 3 良好 / 4 简单** 评分。使用 FSRS 安排到期复习，每天默认最多引入 10 个新句，可调整。
- **自由跟打**：随机选句、默认显示注音，完成后按 Enter 继续，不改变记忆复习计划。
- 自动记住上次选择的卡组及各卡组的练习范围；跟打时按 Tab 切换汉字注音。
- 可导入自己的 Anki `.apkg` 卡组，需包含日语和中文字段；仅提取文本及已有注音，不导入媒体或复习进度。
- 学习记录长期保存在当前浏览器，不再限制为 20 轮；评分后逐句保存。可导出／恢复包含成绩、复习计划和逐句记录的 JSON，兼容旧备份；单文件上限 256 MB。清除网站数据会丢失本地记录，请定期备份并保留原始 `.apkg` 文件。

## 本地运行

需要 Node.js 24 或更高版本。

```bash
npm ci
npm run dev
```

`npm test` 运行测试，`npm run build` 构建网页。推送到 `main` 后自动发布至 GitHub Pages。

## 卡组来源

默认卡组由 **[egg rolls](https://github.com/5mdld/anki-jlpt-decks)** 制作，采用 [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/deed.zh-hans) 许可。本项目提取文本、整理注音并去重，改变了数据格式与呈现方式。卡组内容限非商业使用，完整署名和修改说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
