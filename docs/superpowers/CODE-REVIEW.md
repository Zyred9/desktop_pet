# Desktop Pet — 代码审查报告

审查范围：`src/main.js`、`src/preload.js`、`src/config.js`、`src/video-scanner.js`、`src/converter.js`、`src/renderer/renderer.js`、`src/renderer/index.html`、`src/renderer/style.css`、`package.json`。

已自动验证通过（未重复）：纯逻辑单测、透明窗口+托盘启动、绿幕→透明 webm→缓存复用 E2E 链路。本审查聚焦代码质量、安全与潜在 bug。

---

## Critical

无。

> 说明：没有发现会导致数据损坏、远程代码执行或必然崩溃的问题。下面 High 级别的「文件名 file:// 未编码」在含特殊字符场景下会让功能完全失效，接近 Critical，但因为不影响进程安全、仅功能性失效，归入 High。

---

## High

### H1. `toFileUrl` 未做 URL 编码，含空格/中文/`#`/`%` 等字符的文件名会加载失败
- 文件:行号：`src/main.js:123-125`
- 问题描述：
  ```js
  function toFileUrl(p) {
    return 'file:///' + p.replace(/\\/g, '/');
  }
  ```
  只把反斜杠换成正斜杠，没有对路径分量做百分号编码。Chromium 在解析 `file://` URL 时会按 URL 规则处理特殊字符：
  - `#` 会被当作 fragment 分隔符，`#` 之后的路径被截断 → 文件找不到；
  - `%` 会被当作百分号转义的引导符，`视频%20.webm` 会被错误解码；
  - 空格、中文等虽然多数 Chromium 版本能容忍，但属于未定义行为，不应依赖。
  
  缓存输出文件名经过 `cacheKeyFor` 的 `replace(/[^a-zA-Z0-9_-]/g, '_')` 清洗（`video-scanner.js:21`），所以**缓存 webm 的文件名是安全的**；但 `userDataDir`（即 `app.getPath('userData')`）的完整路径不受控——Windows 上通常是 `C:\Users\<用户名>\AppData\...`，**用户名含空格（如 `John Smith`）或中文是极常见的**，整条 `file://` URL 因此可能损坏。这会让"换台电脑/换用户就播不出来"成为难以复现的线上问题。
- 建议修复：用 Node 内置的 `url.pathToFileURL` 生成规范、已编码的 file URL：
  ```js
  const { pathToFileURL } = require('node:url');
  function toFileUrl(p) {
    return pathToFileURL(p).href;
  }
  ```
  它会正确处理盘符、分隔符与百分号编码，跨平台且无需手写正则。

### H2. 缺少单实例锁，托盘程序会被多开
- 文件:行号：`src/main.js:174-181`（`app.whenReady`，全文件无 `requestSingleInstanceLock`）
- 问题描述：这是一个托盘常驻、关窗不退出（`main.js:112-114`）的应用。用户再次双击图标或开机自启与手动启动叠加时，会拉起第二个进程，出现两个置顶宠物窗 + 两个托盘图标，且两个进程同时读写同一份 `config.json`（`config.js:29-31` 无锁写），后写覆盖先写，位置/尺寸记忆互相打架。需求文档也明确把"缺单实例锁导致多开"列为关注点。
- 建议修复：在 `app.whenReady()` 之前加单实例守卫，并在 `second-instance` 事件里把已有窗口显示出来：
  ```js
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (win) { win.show(); win.focus(); }
    });
    app.whenReady().then(() => { /* 现有逻辑 */ });
  }
  ```

---

## Medium

### M1. 渲染进程未设置 CSP，且未禁用导航/新窗口
- 文件:行号：`src/renderer/index.html:1-14`（无 CSP meta）、`src/main.js:89-115`（`createWindow` 未加 `will-navigate` / `setWindowOpenHandler`）
- 问题描述：当前 `contextIsolation:true` + `nodeIntegration:false`（`main.js:104-105`）配置正确，这是首要防线，做得好。但仍缺两层纵深防御：
  1. 没有 `Content-Security-Policy`。本应用所有资源都是本地的，理应锁成最严策略。Electron 安全清单明确建议为加载本地内容的窗口定义 CSP。
  2. 没有导航守卫。万一未来 `video.src` 或 hint 文案被某种方式注入了外链，页面可能被导航走或弹出新窗口。
  
  风险级别为 Medium 而非 High：因为不加载任何远程内容、不开 `nodeIntegration`，当前实际可利用面很小；这是"最佳实践 + 纵深防御"层面的缺失。
- 建议修复：
  - 在 `index.html` 的 `<head>` 加：
    ```html
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; img-src 'self'; media-src 'self' file:; style-src 'self'; script-src 'self'">
    ```
    （`media-src` 需允许 `file:` 以播放缓存 webm；可按实际加载方式收紧。）
  - 在 `createWindow` 里加：
    ```js
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    ```

### M2. 转换全部失败时，`hint` 提示文案会被清空，用户看到空白窗
- 文件:行号：`src/renderer/renderer.js:25-32` 与 `src/main.js:162-167`
- 问题描述：主进程在转换全失败时先 `sendStatus('没有可播放的视频(转换均失败)')`，紧接着 `sendPlaylist([])`。渲染端 `onStatus` 把 `hint` 设成该提示文案；但 `onPlaylist([])` 回调里有这样一段：
  ```js
  if (playlist.length === 0) {
    hint.textContent = '该文件夹没有可用视频';
  }
  ```
  由于 IPC 消息按序到达，`playlist` 事件在 `status` 之后处理，会**把刚显示的"转换均失败"覆盖成"该文件夹没有可用视频"**，提示语义与实际不符（明明有视频，只是转换失败了）。两条消息职责重叠且互相打架。
- 建议修复：让 `onPlaylist` 不要无条件改写 hint——空列表时不再硬写文案，统一由 `onStatus` 负责文案；或者给 status 和"空列表默认提示"分别用不同元素 / 加时间戳判优先级。最简做法：删掉 `onPlaylist` 里那段 `hint.textContent = ...`，因为主进程在每条空 playlist 之前都已发送了对应 status（`main.js:137`、`163`）。

### M3. `reloadVideos` 并发 token 能防"结果覆盖"，但不取消正在跑的 ffmpeg 子进程
- 文件:行号：`src/main.js:127-168`、`src/converter.js:37`
- 问题描述：`reloadToken` 的设计是对的——快速切文件夹时，旧任务在每次循环迭代前用 `if (myToken !== reloadToken) return`（`main.js:149`、`161`）放弃后续工作，避免旧结果覆盖新结果。这部分逻辑正确。但有两点资源/竞态问题：
  1. **`await convertGreenScreen` 期间无法中断**：token 检查只在每个文件转换"之间"发生。如果当前正有一个大文件在 ffmpeg 里转（可能数秒到数十秒），切了新文件夹后，旧的 ffmpeg 子进程仍跑完才退出，期间占用 CPU/IO。`convertGreenScreen` 没有暴露取消句柄（无法 `proc.kill()`）。
  2. **`cache` 目录与 tmp 文件竞争**：若新旧两次 reload 处理到**同一个源文件**（同名同 mtime → 同 `outPath`），两个 ffmpeg 会写同一个 `${outPath}.tmp.webm`（`converter.js:20`），`-y` 覆盖 + `renameSync` 存在交错写/改名竞争。实际多为同文件夹快速重选，概率不高，但存在。
- 建议修复：让 `convertGreenScreen` 返回 `{ promise, proc }` 或接受 `AbortSignal`，在 token 失效时 `proc.kill()`；或在 `reloadVideos` 入口记录"当前活动子进程"并在新 reload 启动时杀掉旧的。tmp 文件名可加入 token/随机后缀避免同名竞争。鉴于实际触发概率，可作为后续优化项。

### M4. 转换中途切换文件夹/全部转换失败时，`<video>` 可能停留在上一组画面
- 文件:行号：`src/renderer/renderer.js:7-17`、`src/main.js:130`
- 问题描述：当新文件夹 `sourceFolder` 为空或无视频，主进程发 `sendPlaylist([])`，渲染端 `playCurrent()` 会 `removeAttribute('src') + load()` 正确清屏，这条 OK。但当 `reloadVideos` 因 token 失效提前 `return`（`main.js:149/161`）时，**不会发送任何新的 playlist**，渲染端继续播放旧 playlist。这在"切到新文件夹但旧转换还没轮到被放弃"的窗口期内，表现为短暂播放旧宠物，属可接受的过渡态，但建议在 `chooseFolder` 选中新文件夹后立即 `sendPlaylist([])` 或发一个"加载中"status，给用户即时反馈。
- 建议修复：`chooseFolder`（`main.js:35-44`）在 `reloadVideos()` 之前先 `sendStatus('正在加载…')`，提升反馈即时性。低优先，体验类。

---

## Low

### L1. `package.json` 没有 electron-builder / 打包配置，"打包的 ffmpeg-static"承诺无法兑现
- 文件:行号：`package.json:1-20`
- 问题描述：项目目标描述"程序用打包的 ffmpeg-static"，但 `package.json` 只有 `electron` devDep 和 `ffmpeg-static` dep，没有任何打包器（electron-builder/electron-forge）配置。打包成 asar 后，`require('ffmpeg-static')` 返回的二进制路径会指向 asar 内部，ffmpeg 无法直接被 `spawn`（需 `asarUnpack`）。当前开发模式能跑，但分发时会因 ffmpeg 路径在 asar 内而启动失败。
- 建议修复：引入 electron-builder，在 `build.asarUnpack` 中加入 `node_modules/ffmpeg-static/**`，并在 `converter.js` 里把路径做 `.replace('app.asar', 'app.asar.unpacked')` 兜底（社区常见写法）。属打包阶段问题，开发期不阻塞。

### L2. `convertGreenScreen` 失败时清理 tmp 用了表达式短路写法
- 文件:行号：`src/converter.js:50`
- 问题描述：`fs.existsSync(tmpPath) && fs.unlinkSync(tmpPath);` 用 `&&` 短路当语句，可读性差且易被 lint 规则（no-unused-expressions）拦下。功能正确。
- 建议修复：改成显式 `if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);`。整段已被 `try/catch {}` 包裹，逻辑无碍。

### L3. `app.on('window-all-closed')` 空实现可省略，但需注意 macOS dock 行为
- 文件:行号：`src/main.js:183-185`
- 问题描述：托盘常驻不退出，所以这里留空是对的。但项目无 `activate` 事件处理（macOS dock 点击重建窗口），且窗口 close 走的是 `hide()`。如果后续要支持 macOS，需要补 `app.on('activate')`。当前若仅 Windows 目标，可忽略。
- 建议修复：若仅 Windows，加注释说明"仅 Windows"；若跨平台，补 `activate` 处理。

### L4. 配置写入无原子性 / 无容错于磁盘满
- 文件:行号：`src/config.js:29-32`
- 问题描述：`saveConfig` 直接 `writeFileSync` 覆盖 `config.json`。若写到一半进程被杀或磁盘满，配置文件会损坏。`loadConfig` 有 `try/catch` 回退到默认值（`config.js:24-26`），所以损坏不会崩溃、只是丢配置，影响可控。
- 建议修复：可选——写临时文件 + `renameSync` 原子替换（与 converter 的 tmp→rename 思路一致）。低优先。

### L5. `chromaColor` 等转换参数从 config 透传给 ffmpeg 命令，存在理论注入面
- 文件:行号：`src/main.js:153`、`src/converter.js:25`
- 问题描述：`config.chromaColor` 被拼进 ffmpeg `-vf` filter 字符串。由于用 `spawn`（数组参数，非 shell），不存在 shell 注入；且 chromaColor 来自本地 config 文件、非外部输入，风险极低。但若未来 chromaColor 走 UI 输入，畸形值会让 ffmpeg 报错（已被 try/catch 跳过）。仅作记录。
- 建议修复：无需立即处理；若开放 UI 编辑该值，加格式校验（`/^0x[0-9A-Fa-f]{6}$/`）。

---

## 亮点（做得好的地方）

- `webPreferences` 配置正确：`contextIsolation:true` + `nodeIntegration:false`，preload 通过 `contextBridge` 暴露**最小** API 面（仅 3 个方法，无通用 `invoke` 透传），IPC 暴露面克制。
- `cacheKeyFor` 用 `basename + mtimeMs` 做缓存键并清洗非法字符，缓存失效与文件名安全两件事一起解决，设计干净。
- converter 用 tmp 文件 + `renameSync` 保证缓存产物的原子可见性，失败时清理 tmp，处理周到；`-auto-alt-ref 0` 与 `format=yuva420p` 的注释解释了 alpha 通道的关键坑，工程素养好。
- `reloadToken` 防覆盖、`debounceSaveBounds`（400ms）防抖保存、`win.isDestroyed()` 守卫、退出用 `isQuitting` 区分 hide/真退出——这些边界都考虑到了。
- `loadConfig` 对损坏/缺失配置 try/catch 回退默认值，健壮。

---

## 总体结论

**需修改后合并（Approve with required changes）。**

代码整体结构清晰、职责分层合理，安全基线（contextIsolation / nodeIntegration）正确，无 Critical 问题。但合并前**至少应修复两个 High**：

1. **H1（`toFileUrl` 未编码）** — 直接影响功能正确性，Windows 用户名含空格/中文时播放失效，改成 `pathToFileURL` 一行即可，必须修。
2. **H2（缺单实例锁）** — 托盘常驻应用的标配，避免多开与 config 写竞争，需求文档点名要求，必须加。

Medium 项（CSP/导航守卫、hint 文案覆盖、ffmpeg 取消）建议同批处理或紧随其后；Low 项可作为后续迭代。修掉两个 High 后即可合并。
