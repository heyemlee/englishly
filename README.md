# PodEcho 播客精听

用 YouTube 视频或播客逐句练英语听力和口语。贴一个 YouTube 链接或搜一个播客，它会把内容切成句子，供你精听、听写、跟读和复习。不需要 API key，所有处理都在本机完成。

## 功能

- **练习**：逐句精听（循环、放慢、隐藏字幕）、听写自动比对、跟读录音识别
- **中文与重点**：保存的中文翻译，英文原句中高亮值得学的单词、短语和地道表达
- **单词本与复习**：收藏表达，用 FSRS 安排复习（看中文说英文、听音辨义、填空）
- **4/3/2 复述**：同一内容限时说三遍，统计语速和停顿
- **学习记录**：最近学习、已完成和已收藏的节目，点开接着练；误听重练从首页进入
- **素材**：YouTube 字幕、播客 RSS（本机 Whisper 转写）、按节目整理
- **Chrome 插件**：在 YouTube 页面上逐句练

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

## 测试

```bash
cd backend && .venv/bin/python -m pytest -q
```

```bash
cd web && npm run lint && npx tsc --noEmit
```
