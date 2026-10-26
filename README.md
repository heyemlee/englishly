# PodEcho 播客精听

用 YouTube 视频或播客逐句练英语听力和口语。贴一个 YouTube 链接或搜一个播客，它会把内容切成句子，供你精听、听写、跟读和复习。不需要 API key，所有处理都在本机完成。

## 功能

- **练习**：逐句精听（循环、放慢、隐藏字幕）、听写自动比对、跟读录音识别
- **中文与重点**：保存的中文翻译，英文原句中高亮值得学的单词、短语和地道表达
- **单词本与复习**：收藏表达，用 FSRS 安排复习（看中文说英文、听音辨义、填空）
- **4/3/2 复述**：同一内容限时说三遍，统计语速和停顿
- **学习记录**：最近学习、已完成和已收藏的节目，点开接着练；误听重练从首页进入
- **素材**：YouTube 字幕、播客 RSS（本机 Whisper 转写）、按节目整理
- **Chrome 插件**：在 YouTube 页面上逐句练；Netflix／Hulu 官网播放时读取字幕、重播、循环、收藏表达

## 技术栈

- 后端：FastAPI + SQLite、yt-dlp、mlx-whisper
- 前端：Next.js 16 + Tailwind
- 插件：Chrome Manifest V3

## 安装

需要 macOS（Apple Silicon）、Python 3.11+、Node.js 20+。

```bash
cd backend && uv venv --python 3.13 .venv && uv pip install --python .venv/bin/python -r requirements.txt
```

```bash
cd web && npm install
```

可选设置见 `backend/.env.example`。

## 启动

双击 `PodEcho.command`，或运行：

```bash
bin/podecho start
```

浏览器会打开 <http://localhost:8811>。服务会常驻后台，登录 Mac 时自动启动。其他命令：`stop`、`restart`、`update`（改代码后重新打包）、`status`、`logs`。

开发前端：`cd web && npm run dev`，打开 <http://localhost:3030>。

**手机访问**：Mac 和手机都装上 [Tailscale](https://tailscale.com)，Mac 上运行 `tailscale serve --bg 8811`，手机打开它给出的地址。

**Chrome 插件**：在 `chrome://extensions` 打开开发者模式，点「加载已解压的扩展程序」，选择 `extension/` 文件夹。

### Netflix / Hulu 官网学习

1. 启动本机 PodEcho，在扩展管理页**重新加载插件**，然后刷新 Netflix／Hulu 网页。新安装时直接加载 `extension/` 即可。
2. 登录你自己的平台账号，打开某一集播放页，选择**英文字幕**。右下角会出现 PodEcho 面板；这一集有可读取的官方中文轨时，会同步显示中英文。
3. 使用「上一句／重播／下一句」、单句循环、句后暂停和倍速；快捷键为 A／S／D／R，输入文字时不触发。全屏使用播放器的网页全屏功能。
4. 选中面板字幕里的表达，点「收藏表达」，填中文意思，即可存入本机单词本，并选择是否加入 FSRS 复习。也可以收藏整句。
5. 本机「学习记录 → 最近学习」会显示 Netflix／Hulu。点开回到官网，再点插件的「继续」恢复位置。

**字幕能力**：优先读取网页提供的英文 TextTrack；否则尝试读取当前画面上的英文字幕，边看边记录。后者只能重播已经读到的内容，时间会标为估计值；还没播放过的下一句不能预先跳转。可导入对应版本的 `.srt`／`.vtt` 获得完整时间轴（最多 5 MB、一万条，字幕必须与影片版本对齐）。网站关闭字幕后，画面读取方式也会失效；插件「字幕」开关只隐藏面板文字。已识别的广告播放期间暂停学习记录和逐句控制。

**官方双字幕**：Netflix 通过页面已解析的字幕清单及播放器字幕轨列表寻找官方中英文轨，支持 WebVTT 和 TTML／DFXP／IMSC；英文和中文按时间重叠对齐，不要求两边句数相同。通用 HTML TextTrack 的双语读取也适用于 Hulu。中文选择器支持优先简体、优先繁体和关闭；只有另一种中文时回退，并在中文的悬停提示中显示实际官方轨名称。

如果提示「中文轨尚未载入」，点「读取双字幕」：必要时会短暂暂停、依次加载两条官方字幕，再恢复原来的官网字幕和播放状态。官方字幕资源只从 Netflix 自有域名读取，地址仅留在页面内存中，读取不附带登录 cookie；不改写播放请求、格式参数或解密逻辑。部分 Netflix 版本不暴露可读字幕清单，字幕格式、跨域限制或缺少中文也可能导致读取失败，会明确提示，不会自动改用机器翻译。

**中文与讲解**：直接显示官方中文不需要 Codex。绿色重点、用法和例句仍由 Codex 处理已捕获／导入的字幕，保存后点「刷新讲解」。已有的 Codex 中文优先显示，官方中文轨单独保存在 `streaming_official_subtitles`，不会覆盖已有中文、英文、时间或练习记录。字幕隐藏时，两种中文和来源提示一并隐藏。可用接口：

- `GET /api/streaming`：最近 30 条官网学习记录。
- `GET /api/streaming/{provider}/{media_id}`：字幕、中文、重点和片段目标，`official_subtitles` 为独立的官方中文时间轴；`provider` 是 `netflix` 或 `hulu`。
- `PUT /api/streaming/{provider}/{media_id}/study`：与普通节目的 study 接口使用同样的 `sentences`／`clips` 结构和 Unicode 位置规则；每条的 `sentence_id` 使用读取结果中的 `id`，片段按 `floor(start / 180)` 划分。
- `DELETE /api/streaming/{provider}/{media_id}`：删除该条官网学习记录及字幕讲解；已收藏到单词本的内容保留。

视频始终由官网播放，不下载、不录制，也不读取账号密码、登录 cookie 或解密信息。字幕和进度存于 Mac 的 SQLite；暂时连不上 PodEcho 时保留浏览器本地缓存，恢复后重试。首次尚未同步时请先保持页面打开；插件不承诺在浏览器强制关闭时完成最后一次写入。

目前覆盖桌面 Chrome 的 `netflix.com/watch/…`、`hulu.com/watch/…` 播放页，不覆盖 Disney+ 内的 Hulu、手机原生 App 或电视。网站播放器、字幕布局、广告时间轴可能变化；模拟页面测试通过不代表已验证所有真实账号、套餐和影片。Netflix 使用独立的页面播放控制适配器，网站改版后可能需要更新。

## 测试

```bash
cd backend && .venv/bin/python -m pytest -q
```

```bash
cd web && npm run lint && npx tsc --noEmit
```

```bash
node --test extension/tests/streaming.test.cjs
```

可选浏览器集成测试：安装 Playwright 及 Chromium，并让 Node 能找到 `playwright` 包后，运行 `node --test extension/tests/browser.test.cjs`。`PODECHO_CHROMIUM` 可指定已有的测试 Chromium 路径。测试加载真实 MV3 插件，使用模拟 Netflix／Hulu 页面和临时 FastAPI 数据库，不连接平台账号，不改现有素材。

双字幕集成测试为 `node --test extension/tests/dual-subtitles.test.cjs`：覆盖官方字幕元数据读取、XML 命名空间／tick／frame 时间、句数不一致、简繁切换、缺少中文、答案隐藏、已有讲解保留、字幕加载后的官网状态恢复及失败恢复。真实账号播放需用户自行登录后另行验证；本次按用户选择未登录。
