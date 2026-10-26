# PodEcho 播客精听

用 YouTube 视频或播客逐句练英语听力和口语。贴一个 YouTube 链接，或者搜一个播客选一集，它把内容切成句子，你可以：

**听（练习页）**
1. **精听**：一句一句放，循环、放慢、隐藏字幕，或者不看字幕把整段盲听一遍
2. **听写**：把听到的打出来，自动标出漏听、听错的词
3. **跟读**：录音后和原声对比，用浏览器的语音识别标出没读清楚的词
4. **中文和重点讲解**：导入素材后，在 Codex 聊天里告诉助手要处理哪一集。助手结合上下文保存中文，并标出值得学的单词、短语、地道表达。英文原句里的重点用浅绿底色和绿色下划线显示，点一下就能看语境释义、用法和例句，听原句，或一键收藏进入复习。中文按 <kbd>Z</kbd> 开关；隐藏字幕或听写检查前会隐藏答案和重点。
5. **单词本**：点击高亮表达可直接收藏；也可展开「收藏表达」，点选第一个词和最后一个词、填写中文意思。在「单词本」点「添加」还能记录其他地方学到的单词、短语或表达：英文和中文释义必填，例句、例句翻译、来源、笔记选填。默认加入复习，也可取消勾选只保存记录，以后再点「加入复习」。可搜索英文、释义、例句、来源和笔记，按来源、复习状态筛选，修改释义和回放节目原句；修改释义会同步更新复习卡，保留原有复习进度。

**说**
6. **复习**：加入复习的词条生成看中文说英文、听音辨义卡；有匹配原句或例句时再生成填空卡。手动添加的内容使用设备朗读，不需要关联视频或配置密钥。按 1–4 打分，用 [FSRS](https://github.com/open-spaced-repetition/py-fsrs) 算下次什么时候复习。每天最多 20 张新卡（`NEW_CARDS_PER_DAY`）。在复习页勾选要练哪几种。
   - **看中文说英文**：看你写的中文意思，用英文说出这个表达（或打字），和答案逐词比对。想不起来按 H，提示是原句、把这个表达挖掉。
   - **听音辨义**：放这个表达所在的原句（视频或播客的原声），听出它、想想意思，可以先写下来再看答案。
   - **填空**：原句里这个表达挖空，按顺序填出来，自动标出对错、给出建议的打分。

   同一个表达的几张卡一天只出一张，其余的留到以后，免得刚看过答案马上又考。
7. **4/3/2 复述**：同样的内容说三遍，每遍限时更短（默认 2 → 1.5 → 1 分钟，也可以选标准的 4 → 3 → 2）。自动统计每遍的词数、语速和 1 秒以上的停顿，三遍对比。可以复述视频片段，也可以自选话题。

**看进度**
8. **数据**：连续练习天数、练过的句子、听写和跟读的近 7 天平均分（和上周比）、记住了多少表达，每天的练习量和分数变化，4/3/2 每次的语速提升
9. **误听本和专项重练**：把听写里漏听、听错的词汇总起来，标出虚词和听成了什么。可重练最多十句，也能只练某个词；题目来自每句最近一次仍有错误的听写。练完显示前后正确率，完全练对的句子会移出重练队列。

**素材**
- **简洁视频播放器（本机）**：练习页直接播放视频文件，画面里没有 YouTube 的标题、推荐或工具栏；画面下只有播放／暂停按钮、时间和一条可拖动进度条。首次打开 YouTube 素材会准备最高 720p 的 H.264/AAC MP4（约几十到几百 MB），保存在 `backend/data/video/`；之后直接播放。可点击画面暂停／继续，拖动或用方向键调整进度；跳转后字幕定位同步，原有逐句重播、循环和倍速保留。视频准备失败可以重试，不会修改字幕或练习记录。
- **YouTube**：用视频自带的字幕。人工字幕的文字配上 YouTube 语音识别给每个词的时间，所以句子的开头结尾基本是准的；只有自动字幕的视频直接用自动字幕和它的逐词时间。新一些的自动字幕本身带标点；没标点的会先按长度粗切，这种视频导入后、开始练之前点「下载音频」，Whisper 会按标点重新切。
- **下载音频**：YouTube 视频在练习页点「下载音频」，后台下载音频（一小时约 60 MB），再用本机的 Whisper 把每句的时间对准。之后可以选用下载的音频播放（手机锁屏也能放）。句子的文字和练习记录都不变，只是时间更准。YouTube 的条款其实不允许下载，所以只在自己电脑上个人学习用，别把音频分享出去。
- **播客（RSS）**：用 Apple Podcasts 搜节目或直接贴 RSS 地址，选一集导入，后台下载音频、用本机的 Whisper 转写（Apple Silicon 的 Mac）。句子边界精确到词，不用再微调。很多 YouTube 上的播客也有 RSS。
- **按节目整理（窄听）**：首页默认按节目（YouTube 频道、播客）分组，每个节目一张卡，点「继续」接着练做到一半的那集，没有的话开始最新一集没练过的；点「更多集」直接打开这个节目的单集列表（YouTube 频道列出最新 30 个视频，不含 Shorts），挑一集导入。在 YouTube 导入框里贴频道地址（比如 `https://www.youtube.com/@TED`）也能列出来。研究里叫 narrow listening：挑 1–2 个节目长期听，熟悉了主播的口音、语速和常用说法以后会越听越轻松。想看所有单集就切到「全部」。
- **YouTube 插件**：在 youtube.com 上看视频时右下角出一个小面板，逐句重播、单句循环、每句后暂停，句子来自 PodEcho（没导入的视频一键导入）。见下面「Chrome 插件」。

PodEcho 不需要配置 API key：字幕、下载、Whisper 转写都在你自己的 Mac 上跑；跟读和复述用 Chrome 自带的语音识别。中文翻译通过 Codex 聊天处理后保存，日常练习直接读取已保存的结果。

**打开后怎么学**：首页前置继续学习和今日复习，素材可按标题／节目、来源、时长和学习状态筛选。练习页的「本段目标」展示助手整理的学习目标；「本段重点」按单词、短语、地道表达分组，可跳回原句。尚未处理的片段仍可正常精听、听写和跟读。

**听过、练过和掌握分开记录**：实际播放会累计收听时间，每句听到原声八成以上才计入「听过」；反复听同一小段不会算作整句听完。听写／跟读计入「练过」，表达的掌握情况沿用复习数据。学习位置保存在后端，同一个 PodEcho 服务在电脑和手机上可接着练；浏览器也保留位置备份。

## 启动

需要 Python 3.11+ 和 Node.js 20+（yt-dlp 要用 Node.js 解 YouTube 的播放器脚本，装了 Node.js 就行）。第一次先装依赖：

```bash
cd backend && uv venv --python 3.13 .venv && uv pip install --python .venv/bin/python -r requirements.txt
```

```bash
cd web && npm install
```

可调的设置（片段长度、每天新卡数、Whisper 模型）都是可选的，要改的话把 `backend/.env.example` 复制成 `backend/.env`，修改后重启后端。中文翻译无需在 PodEcho 里配置模型或密钥。

**一键启动**：双击项目文件夹里的 `PodEcho.command`（或者在终端运行 `bin/podecho start`），浏览器会打开 <http://localhost:8811>。第一次会先打包网页，要一两分钟。之后它一直在后台运行：关掉终端也不停，登录 Mac 时自动启动，崩了会自己重启，日志在 `~/Library/Logs/podecho.log`。

```bash
bin/podecho update     # 改了代码以后：重新打包网页并重启（只改了后端用 bin/podecho restart）
bin/podecho stop       # 先停掉（下次登录会再自动启动）
bin/podecho status     # 看看在不在运行
bin/podecho logs       # 看日志
bin/podecho uninstall  # 停掉，登录时也不再启动
```

**录音和语音识别请用 Chrome**：Chrome 的语音识别会把声音发给 Google 处理，需要联网。录音时浏览器会问麦克风权限，点允许。

**改前端时**：`cd web && npm run dev`，打开 <http://localhost:3030>，改了马上能看到（接口还是用 8811 的常驻服务）。改完运行 `bin/podecho update`，8811 上的网页才会更新。

端口：常驻服务 8811（接口和网页都在这），前端开发服务器 3030（你电脑上 8000、3000 已经被别的程序占了）。常驻服务只监听本机，手机通过 Tailscale 访问（见下面）。

**每个月更新一次 yt-dlp**：YouTube 经常改接口，yt-dlp 跟着改。哪天导入、下载音频突然失败，先更新它：

```bash
cd backend && uv pip install --python .venv/bin/python -U "yt-dlp[default]"
```

## 在手机上用

用 [Tailscale](https://tailscale.com)（个人用免费）：Mac 和手机都装上、登同一个账号，Mac 上运行一次

```bash
tailscale serve --bg 8811
```

手机打开它给出的 `https://<电脑名>.<xxx>.ts.net` 地址。在家用 Wi-Fi、在外面用流量都能连回 Mac；是 https，跟读、复述这些录音功能也能用；只有登录了你 Tailscale 账号的设备能打开。视频和数据都在 Mac 上，不放到任何云端。加到主屏幕（iPhone：Safari 分享 → 添加到主屏幕；Android：Chrome 菜单 → 添加到主屏幕）以后像 App 一样全屏打开。

- **Mac 要醒着**：插着电，在「系统设置 → 电池 → 选项」里打开「使用电源适配器时，防止在显示器关闭时自动进入睡眠」。MacBook 合上盖子会睡眠，盖子要开着（或者接外接显示器）。Mac 关机、睡眠或断网时手机打不开。
- **流量**：在外面看 720p 视频大约每小时 1 GB。

## Chrome 插件

`extension/` 是一个 Chrome 插件，在 YouTube 上直接逐句练：

1. Chrome 打开 `chrome://extensions`，右上角打开「开发者模式」。
2. 点「加载已解压的扩展程序」，选这个项目里的 `extension` 文件夹。
3. 打开任意 YouTube 视频，右下角会出现 PodEcho 面板（PodEcho 要在运行，见上面「一键启动」）。

面板里：<kbd>A</kbd> 上一句、<kbd>S</kbd> 重播这句、<kbd>D</kbd> 下一句、<kbd>R</kbd> 单句循环开关；还能勾「每句后暂停」、遮住字幕。点「在 PodEcho 里练这句」会在 PodEcho 里打开同一句，做听写、跟读、收藏表达。在搜索框、评论框里打字时这几个键不起作用。

插件默认连 `http://localhost:8811`（常驻服务）。之前在插件里存过 `http://localhost:3030` 的话，点工具栏里的插件图标改成 8811（或者 Tailscale 地址），会顺便测试能不能连上。改了 `extension/` 里的代码后，在 `chrome://extensions` 点插件上的刷新按钮，再刷新 YouTube 页面。

## 快捷键（练习页）

| 键 | 作用 |
|---|---|
| 空格 | 重播当前句 |
| ← / → | 上一句 / 下一句 |
| Esc | 停止播放 |
| S | 显示/隐藏字幕（精听模式） |
| Z | 显示/隐藏中文翻译 |
| R | 开始/停止录音（跟读模式） |
| 1 / 2 / 3 | 精听 / 听写 / 跟读 |
| 听写框里 Enter / Tab | 检查（再按一次到下一句）/ 重播 |

复习页，所有卡片都用 <kbd>1</kbd>–<kbd>4</kbd> 打分：
- 看中文说英文：<kbd>R</kbd> 开始/停止说、<kbd>空格</kbd> 看答案、<kbd>H</kbd> 提示、<kbd>P</kbd> 朗读答案
- 听音辨义：<kbd>P</kbd> 再听一遍、<kbd>空格</kbd> 看答案（在输入框里按 Enter 也行）
- 填空：输入框里 Enter 检查、<kbd>P</kbd> 朗读整句

## 工作原理

- **字幕**：用 [yt-dlp](https://github.com/yt-dlp/yt-dlp) 拉英文字幕（json3 格式），优先用人工字幕；同时拉 YouTube 的自动字幕，里面每个词都有开始时间。yt-dlp 出问题时退回 [youtube-transcript-api](https://github.com/jdepoix/youtube-transcript-api)（只有每行字幕的时间），导入页会提示。两个都是非官方接口，在自己电脑上用没问题；部署到云服务器上基本会被 YouTube 拦截，所以这是个本地工具。
- **切句**：先给每个词定时间。人工字幕只有每行的时间，先按字符长度分给行里的词，再用 difflib 把这些词和自动字幕（或 Whisper）的词对上，对上的直接用识别出来的时间；没对上的词（比如笑声里识别漏掉的）按字幕自己的时间比例放在前后两个对上的词之间。为了一小时的节目也快，按 200 个词一段、只和附近 15 秒内的词比。然后按标点切句；没有标点就每 12 个词左右切一刀，尽量切在字幕换行处。时间还是不对的话，可以在练习页点滑块图标「调整这句的时间」微调。
- **播放**：练习页用简洁播放器（原生 `<video>`）放本机准备好的 MP4（`app/video.py`，第一次打开时下载，存在 `data/video/`），逐句播放靠轮询 `currentTime`、播到句尾就暂停；播放时间只在播放条里刷新，整页不会跟着每秒重绘几次。下载了音频的视频可以改用 `<audio>` 播放。复习的听音卡、单词本回放和误听重练用 `<audio>` 放本机的音频，没有音频就放这个 MP4 的声音（都走 `/api/media`）；两样都没有时才用 YouTube 官方嵌入播放器（`seekTo` + 轮询 `getCurrentTime()`）。
- **下载音频**：yt-dlp 只下载音轨（优先 m4a，所有浏览器都能放），存在 `data/audio/`，然后 Whisper 转写出带时间的词，用上面同样的对齐办法给已有的句子换上新时间（句子的 id 和文字不变，所以听写记录、收藏的表达都还在）。如果句子是按长度粗切的、而且还没练过，就直接换成 Whisper 按标点切的句子。和播客转写共用一个队列，一次只跑一个 Whisper。本机跑不了 Whisper 时只下载音频，不重新对齐。频道列表用 yt-dlp 的 flat 模式，只列视频不逐个打开，不到一秒。
- **中文翻译**：由 Codex 助手读取本地已导入的字幕，结合上下文翻译，将中文按句子 ID 写入 `sentences.translation_zh`。英文原文、句子 ID 和时间信息保留不变；后端随单集详情返回已保存的中文，前端只在答案已揭示、且中文开关打开时显示。PodEcho 本身不调用外部翻译模型。
- **重点和学习目标**：`sentence_annotations` 保存单词／短语／地道表达及其原文位置、语境释义、用法和例句；位置按 Unicode 字符计数，左闭右开。`clip_lessons` 保存每段的标题、摘要、目标。通过 `PUT /api/episodes/{id}/study` 原子写入，逐句校验原文未变、位置匹配且标注不重叠。遗漏的字段保留已有内容，避免处理一段时清掉其他内容。
- **实际收听与位置**：播放器采样实际推进的播放时间，排除暂停、跳转和无法确定的长时间后台间隔；合并每句听过的区间，覆盖八成才算听过。收听事件带唯一编号，失败会重试，重复提交不重复累计；页面位置单独保存，单纯打开页面不计为听过。
- **跟读打分**：浏览器 Web Speech API 识别你说的话，和原文逐词比对（LCS），测的是「能不能被听懂」，不做音素级的发音评分。
- **播客**：RSS 用 defusedxml 解析；音频存在 `data/audio/`（跟着数据库目录走），本机 Whisper（mlx-whisper，默认 `whisper-large-v3-turbo`，第一次用会从 Hugging Face 下载约 1.6 GB）在后台一集一集地转写，带词级时间戳；Whisper 自己会加标点，所以直接按标点切句。没装 ffmpeg 也行，用的是 imageio-ffmpeg 自带的。后端重启时正在转写的节目会标成失败，点「重试」就行。播放用 `<audio>` 加后端的 Range 请求。
- **数据和误听本**：都是从练习记录里现算的。按本机时区算「今天」和连续天数；复习卡片的记忆稳定度（FSRS stability）≥ 21 天算「记住了」。
- **复习**：卡片的 FSRS 状态存在 `cards.fsrs`（JSON）里，目标记忆保持率 90%。新卡先走 1 分钟、10 分钟两个学习步骤；没有别的卡到期时，20 分钟内到期的学习中卡片会提前拿出来。
- **三种卡片**：一个收藏的表达是一条「笔记」（`cards.note`），下面挂三张卡（`cards.kind`：produce / listen / cloze），各自独立排期。同一条笔记今天复习过一张，别的卡今天就不出（新卡不出，已经进入长期复习的也不出；还在 1 分钟、10 分钟学习步骤里的照常出）。听音辨义和填空都用收藏时的原句。填空挖的是你选的词：在原句里找最长的一串能对上的词（允许 ended 对 end 这种变形），对不上（比如你把表达改成了原句里没有的写法）就不出填空卡，看中文说英文的提示也改成整句原句。
- **数据库升级**：用 `PRAGMA user_version` 记版本，后端启动时自动升级。v7 去掉了 AI 功能：升级时删掉对话、我想说的数据和 AI 讲解、点评，复习卡片和复习记录都保留；v8 给句子加上中文翻译；v10 在收藏表添加手动来源、例句和笔记。仅记录的词条不生成卡片，重启也不会自动加入复习；重复加入复习不重置排期。
- **手机（PWA）**：前端带 Web App Manifest 和图标，可以加到主屏幕全屏打开。常驻服务时后端自己提供打包好的静态网页和接口（`app/pages.py`），手机、插件都只连 8811 一个地址，后端只监听本机；开发时 `next dev` 用 rewrites 把 `/api` 转给后端。
- **插件**：Manifest V3。content script 在 YouTube 页面里用 Shadow DOM 画面板（和 YouTube 的样式互不影响），跟着 `<video>` 的播放时间走：画面刷新时检查一次，切到别的标签页后靠 `timeupdate` 继续检查，所以后台听也能循环、暂停。请求由插件的 background service worker 发给 PodEcho，不受 youtube.com 跨域限制，PodEcho 不用改配置。YouTube 是单页应用，换视频时会监听 `yt-navigate-finish` 重新加载句子。
- **语音**：说话识别都用浏览器的 Web Speech API（Chrome 识别一段时间没声音会自己停，代码里会自动重启）；复习时朗读答案用浏览器自带的 TTS。
- **4/3/2 的停顿**：用 Web Audio 实时测麦克风音量，自适应噪声底，音量低于阈值超过 1 秒、而且前后都在说话，才算一次停顿。语速 = 识别出的词数 ÷ 这一遍的总时长。

```
backend/   FastAPI + SQLite（data/app.db）
  app/youtube.py         用 yt-dlp 拉字幕（带逐词时间）、频道视频列表、下载音频，解析链接
  app/youtube_extras.py  频道「更多集」接口、下载音频 + Whisper 对齐的后台任务
  app/segment.py         单词时间、和识别结果对齐、切句、分片段
  app/main.py            视频、句子（含中文与重点）、收藏表达的 API
  app/learning.py        字幕学习内容导入、实际收听、学习位置、误听重练队列
  tools/study_material.py  为助手导出字幕、导入已整理的中文／重点／片段目标
  app/auth.py            访问密码、云端模式关掉导入（PODECHO_PASSWORD、PODECHO_MODE=cloud）
  app/pages.py           常驻服务时提供 web/out 里打包好的网页
  app/review.py          复习卡片和 FSRS 调度
  app/retell.py          4/3/2 复述
  app/podcasts.py        播客搜索、RSS、下载和 Whisper 转写任务、音频接口
  app/video.py           练习页用的 MP4：第一次打开时下载（最高 720p），支持拖动进度
  app/media.py           ffmpeg 解码、Whisper
  app/stats.py           数据面板和误听本
web/       Next.js 16 + Tailwind
  next.config.ts                开发时把 /api 转给后端（BACKEND_URL）；npm run build:static 打包成静态网页
  public/manifest.webmanifest   PWA（加到主屏幕）
  components/Practice.tsx       练习页（含中文翻译、收藏表达）
  components/SimpleVideoPlayer.tsx  简洁视频播放器（播放／暂停、时间、进度条）
  components/StudyText.tsx      英文原句里的重点高亮
  components/ReviewCards.tsx    三种复习卡片
  components/Shows.tsx          首页按节目分组
  components/ChannelVideos.tsx  YouTube 频道的视频列表
  components/charts.tsx         数据面板的图表
  lib/useRangePlayback.ts       逐句循环播放（视频、音频和 YouTube 共用）
  lib/useVideoPlayer.ts         本机 MP4 播放
  lib/useAudioPlayer.ts         音频播放（播客、下载的音频，复习和单词本回放）
  lib/useYouTubePlayer.ts       YouTube 播放器（本机没有音频和视频时）
  lib/useLearningProgress.ts    实际收听时间（合并区间，失败会重试）
  lib/useRecorder.ts            录音、语音识别、停顿统计
  lib/tts.ts                    浏览器朗读
  lib/diff.ts                   逐词比对
extension/ Chrome 插件（YouTube 上的逐句面板）
  content.js       面板和跟着视频走的逻辑
  background.js    转发请求给 PodEcho
  options.html/js  设置 PodEcho 的地址和访问密码
bin/podecho  一键启动／常驻后台（launchd）；PodEcho.command 双击启动
```

## 测试

```bash
cd backend && .venv/bin/python -m pytest -q
```

想随便点一遍又不碰真实数据：用测试数据另开一个后端，常驻服务不用停（端口 8812，数据库和下载的音频都存在单独的 `data/fake/`，Whisper 用小模型 whisper-tiny；`PORT=...` 可以换端口），前端开发服务器连它：

```bash
cd backend && .venv/bin/python tests/dev_server.py
```

```bash
cd web && BACKEND_URL=http://127.0.0.1:8812 npm run dev
```

```bash
cd web && npm run lint && npx tsc --noEmit
```
