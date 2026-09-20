# egg rolls JLPT N1–N5 卡组

- 作者：egg rolls
- 原卡组发布页：https://github.com/5mdld/anki-jlpt-decks
- 来源文件：`egg_rollsJLPT_N1N5__v35NO_ENGLISH.apkg`，用户提供的 v3.5 / NO ENGLISH 版本
- 许可：[Creative Commons Attribution-NonCommercial 4.0 International（CC BY-NC 4.0）](https://creativecommons.org/licenses/by-nc/4.0/)
- 许可正文：https://creativecommons.org/licenses/by-nc/4.0/legalcode

本卡组由 egg rolls 制作，内容来源于公开互联网资源及个人创作。可自由使用、修改和分享，但需遵守以下条件：

1. 署名：清晰注明原作者 egg rolls，提供原卡组发布链接，并说明是否修改过内容。
2. 非商业性使用：不得将卡组用于商业目的，包括直接售卖卡组、整合进付费产品或服务、商业广告或市场推广。
3. 无附加限制：不得施加额外法律条款或技术措施，限制他人行使本许可允许的权利。

## 日语敲敲中的修改

`src/data/egg-rolls.json` 是从原卡组提取并转换的日语跟打内容：

- 保留日语原句、简体中文翻译、可对齐的假名注音、来源词汇、笔记标识和 JLPT 等级。
- 将 Anki 注音转换为结构化 ruby 片段，移除展示用 HTML 标签及注音分词空格；不改变跟打目标的汉字、假名或标点。
- 从 10,635 条词条中提取并保留 15,891 条例句与短语；排除 2,193 条关联词 / 反义词、95 条重复日中句对。
- 15,403 条附有假名注音；另有 1 条原注音无法对齐，已保留原句并回退为无注音显示。
- 未导入音频、图片、卡片模板或 Anki 复习进度。

以上许可和署名适用于这份卡组数据，不代表项目内其他第三方软件依赖采用相同许可。各软件包保留其各自许可文件。

## ts-fsrs

记忆复习使用 [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) 5.4.2（FSRS 调度库）。Copyright (c) 2026 Open Spaced Repetition，MIT 许可。完整许可随网站发布，见 [public/licenses/ts-fsrs.txt](public/licenses/ts-fsrs.txt)。
