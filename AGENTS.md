# PodEcho 项目偏好

## AI 字幕处理与重点高亮（用户于 2026-10-25 确认）

- 后续实现 AI 字幕处理时，除了中文翻译，还要识别值得学习的**单词、短语、地道表达**，直接在英文字幕原句中的对应位置高亮。
- 用户喜欢 SpeakVlog 截图里的样式：**浅绿色底色 + 更明显的绿色下划线**。多词短语作为一个整体标注，保留原句的文字、标点和时间信息。
- 截图中的参考包括 `fall`、`transformation`、`out of the way`、`around the corner`、`in the mood for`；实际标注应依据当前字幕语境选择，避免整句或每个词都高亮。
- 三类标注应与对应句子及准确的原文位置关联，方便后续展示和学习使用；不要只在独立的词汇列表里列出重点。
- 保持现有练习的答案隐藏规则：字幕隐藏、听写检查前等状态，不得通过高亮泄露原文答案。

高亮、点击讲解、一键收藏和片段学习目标已实现；内容由助手在聊天中处理后导入。

## 中文翻译工作流（用户于 2026-10-25 确认）

- 用户选择导入素材后，直接在 Codex 聊天中让助手翻译并保存回项目；PodEcho 不配置 API key，也不自行调用外部翻译模型。
- 优先使用 `GET /api/episodes/{id}` 读取原文，通过 `PUT /api/episodes/{id}/study` 一次保存中文、重点讲解和片段学习目标。也可在 backend/ 运行 `tools/study_material.py export/import`。接口会校验原文与位置，整批成功才保存。
- 每个 sentence 条目包含 `sentence_id`、完整原文 `text`、可选 `translation_zh`、可选 `annotations`；标注包含 `kind`（word/phrase/expression）、`start`、`end`、原文 `text`、`meaning_zh`，以及可选 `usage_zh`、`example_en`、`example_zh`。位置按 Unicode 字符计数，左闭右开；同句标注不重叠，多次出现的词要选定具体位置。未提供某字段就保留已有值；空 annotations 列表才会清除该句标注。
- `clips` 条目包含从零开始的 `clip`、`title`、`summary`、`goal`。每段优先选择 3–5 个最值得迁移使用的表达，避免把每个单词都标亮；翻译时保留上下文。
- 保留英文原文、句子 ID、时间信息和已有练习记录。不要为了加入重点而重新切句或重置复习卡。
- 保留已保存中文的展示和开关。不要重新引入密钥配置、模型选择、连接测试或需要外部翻译接口的按钮。

## 手动单词本（用户于 2026-10-25 确认）

- 用户可把其他地方学到的单词、短语和表达手动加入单词本，不要求关联节目句子。支持中文释义、例句及中文、来源和笔记。
- 支持保存时加入复习或仅记录；仅记录的词条不应因重启或升级自动生成卡片。以后可从单词本加入复习，重复加入不重置 FSRS 排期和复习记录。
- 手动词条与字幕收藏共用 `saved_chunks`，以 `entry_source` 区分；通过 `POST /api/chunks/manual` 添加，通过 `POST /api/chunks/{id}/review` 加入复习。`in_review` 根据实际关联卡片判断。

## 简洁视频播放器（用户于 2026-10-25 确认）

- 练习页采用用户截图 1 的样式：完整视频画面，下面只有播放／暂停、当前时间、可拖动进度条和总时长。不要在画面内显示 YouTube 标题、推荐、Logo 或自带工具栏，也不要用静态封面代替播放。
- 本机首次打开素材时准备 H.264/AAC MP4（最高 720p），保存在数据库旁的 `video/`；后续直接用原生 video 播放。视频准备不重新转写或改动字幕、标注及练习记录。
- 进度条支持暂停和播放中跳转，跳转时取消原句循环边界，按新的位置继续；逐句重播、片段播放、倍速、字幕定位和实际收听记录共用播放时钟。

## 前端视觉风格（用户于 2026-10-25 提出）

- OpenAI 式的简洁黑白 + 液态玻璃。颜色和玻璃效果集中在 `web/app/globals.css`（`glass` 卡片、`glass-strong` 浮动栏、`fill` 填充、`muted`/`subtle` 次要文字）；主按钮黑底白字，暗色模式反过来。新界面沿用 `components/ui.tsx`（Btn、IconBtn、Segmented、Toggle、SelectChip、Composer、Card）和 `components/icons.tsx`，不要再加彩色强调色。
- 只有三处保留颜色：字幕重点的浅绿底 + 绿色下划线、对错反馈的绿/红、数据图表的蓝/橙两色。
- 页面尽量不放解释、引导文字；确实需要的说明放进按钮的 title 提示。快捷键说明只在桌面端（`pointer-fine`）显示一行。
- 手机端：底部是玻璃标签栏；练习页换成「上一句 / 重播 / 下一句」浮动控制条。输入框字号不小于 16px（避免 iOS 放大），筛选和选项放成可横向滑动的一行。

## 本机常驻服务（用户于 2026-10-25 确认）

- 不做云端部署，视频和数据只存在 Mac 上。Mac 用 `bin/podecho start`（或双击 `PodEcho.command`）常驻运行：launchd 登录自启、崩溃重启；后端在 8811 同时提供接口和 `web/out` 的静态网页（`backend/app/pages.py`），手机用 `tailscale serve --bg 8811` 访问。
- 改了代码后运行 `bin/podecho update`（重新打包网页并重启后端）；只改后端可以 `bin/podecho restart`。开发前端时可以开 `cd web && npm run dev`（3030，接口仍是 8811）。
- 只听不看的地方（复习的听音卡、单词本回放、误听重练）没有下载音频时，`/api/media/{id}` 直接放准备好的 MP4，这三处的 `has_audio` 也把 MP4 算进去；练习页和节目列表的 `has_audio` 仍然只指下载的音频。
- 前端要能静态导出：不加动态路由段（练习页是 `/episode?id=…&s=…`，链接用 `episodeHref`），不用需要服务器的功能（route handler、路由的 `dynamic` 配置、服务端读 cookie／headers）；`next.config.ts` 里的 rewrites／redirects 只在开发服务器上生效。
