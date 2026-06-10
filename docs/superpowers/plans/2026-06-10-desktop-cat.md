# 桌面宠物 Desktop Cat 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个常驻 Windows 桌面的透明悬浮宠物窗口,自动轮播本地文件夹里的宠物视频(用户提供绿幕素材,程序导入时抠绿幕转透明 webm 缓存复用),无边框、置顶、可拖动、尺寸可调,记住位置尺寸,带托盘 + 右键菜单。

**Architecture:** Electron 双进程。主进程 `main.js` 负责透明窗口/托盘/菜单/配置/开机自启,并调用打包的 ffmpeg 把绿幕视频转成带 alpha 的透明 webm 缓存到 userData;渲染进程只认透明 webm 列表做顺序循环播放,完全不知道绿幕的存在。纯逻辑(config / video-scanner)走 TDD 可单测,GUI 集成给完整代码 + 手动验证清单。

**Tech Stack:** Electron, ffmpeg-static, Node.js 内置 test runner(`node:test`),原生 HTML/CSS/JS。

---

## 文件结构

```
desktop_cat/
├── package.json              # Task 1
├── src/
│   ├── config.js             # Task 2  配置读写(可单测)
│   ├── video-scanner.js      # Task 3  扫描+过滤+缓存判定(可单测)
│   ├── converter.js          # Task 4  ffmpeg 绿幕→透明 webm
│   ├── preload.js            # Task 5  IPC 安全桥
│   ├── main.js               # Task 6/7/8  主进程:窗口/托盘菜单/转换编排
│   └── renderer/
│       ├── index.html        # Task 5
│       ├── style.css         # Task 5
│       └── renderer.js       # Task 5  顺序循环播放
├── test/
│   ├── config.test.js        # Task 2
│   └── video-scanner.test.js # Task 3
└── assets/
    └── tray-icon.png         # Task 6(占位图标)
```

每个文件单一职责。`config` 只管配置,`video-scanner` 只管「有哪些视频要播/要转」,`converter` 只管转格式,`renderer` 只管播放。彼此通过纯数据(路径数组、配置对象)通信。

---

## Task 1: 项目初始化

**Files:**
- Create: `D:/open_workspace/desktop_cat/package.json`
- Create: `D:/open_workspace/desktop_cat/.gitignore`

- [ ] **Step 1: 写 package.json**

`D:/open_workspace/desktop_cat/package.json`:

```json
{
  "name": "desktop-cat",
  "version": "0.1.0",
  "description": "桌面宠物:透明悬浮窗轮播绿幕宠物视频",
  "main": "src/main.js",
  "scripts": {
    "start": "electron .",
    "test": "node --test"
  },
  "author": "",
  "license": "MIT",
  "devDependencies": {
    "electron": "^33.0.0"
  },
  "dependencies": {
    "ffmpeg-static": "^5.2.0"
  }
}
```

- [ ] **Step 2: 写 .gitignore**

`D:/open_workspace/desktop_cat/.gitignore`:

```
node_modules/
dist/
.omc/
*.log
```

- [ ] **Step 3: 安装依赖**

Run(后台运行,耗时): `cd /d D:\open_workspace\desktop_cat && npm install`
Expected: 生成 `node_modules/`,electron 和 ffmpeg-static 安装成功,无 ERR。

- [ ] **Step 4: 验证 ffmpeg-static 可用**

Run: `node -e "console.log(require('ffmpeg-static'))"`
Expected: 打印出一个指向 ffmpeg.exe 的绝对路径(在 node_modules 内),路径文件存在。

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore
git commit -m "chore: 初始化 desktop-cat 项目与依赖"
```

---

## Task 2: 配置读写模块(TDD)

**Files:**
- Create: `D:/open_workspace/desktop_cat/src/config.js`
- Test: `D:/open_workspace/desktop_cat/test/config.test.js`

设计:`config.js` 不依赖 Electron(便于单测),把「配置文件所在目录」作为参数传入。提供 `loadConfig(dir)` 和 `saveConfig(dir, config)`,以及 `DEFAULT_CONFIG`。读取时对缺字段用默认值补齐。

- [ ] **Step 1: 写失败测试**

`D:/open_workspace/desktop_cat/test/config.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig, saveConfig, DEFAULT_CONFIG } = require('../src/config');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dcat-'));
}

test('loadConfig 在无文件时返回默认配置', () => {
  const dir = tmpDir();
  const cfg = loadConfig(dir);
  assert.deepStrictEqual(cfg, DEFAULT_CONFIG);
});

test('saveConfig 后 loadConfig 能读回', () => {
  const dir = tmpDir();
  saveConfig(dir, { ...DEFAULT_CONFIG, sourceFolder: 'C:/cats', autoLaunch: true });
  const cfg = loadConfig(dir);
  assert.strictEqual(cfg.sourceFolder, 'C:/cats');
  assert.strictEqual(cfg.autoLaunch, true);
});

test('loadConfig 对缺字段用默认值补齐', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ sourceFolder: 'C:/x' }));
  const cfg = loadConfig(dir);
  assert.strictEqual(cfg.sourceFolder, 'C:/x');
  assert.deepStrictEqual(cfg.windowBounds, DEFAULT_CONFIG.windowBounds);
  assert.strictEqual(cfg.autoLaunch, DEFAULT_CONFIG.autoLaunch);
});

test('loadConfig 对损坏的 JSON 返回默认配置不抛错', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'config.json'), '{ broken json');
  const cfg = loadConfig(dir);
  assert.deepStrictEqual(cfg, DEFAULT_CONFIG);
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /d D:\open_workspace\desktop_cat && node --test test/config.test.js`
Expected: FAIL — `Cannot find module '../src/config'`。

- [ ] **Step 3: 写最小实现**

`D:/open_workspace/desktop_cat/src/config.js`:

```js
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CONFIG = {
  sourceFolder: null,
  windowBounds: { x: null, y: null, width: 300, height: 300 },
  autoLaunch: false,
  chromaColor: '0x00FF00',
};

function configPath(dir) {
  return path.join(dir, 'config.json');
}

function loadConfig(dir) {
  try {
    const raw = fs.readFileSync(configPath(dir), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      windowBounds: { ...DEFAULT_CONFIG.windowBounds, ...(parsed.windowBounds || {}) },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(dir, config) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath(dir), JSON.stringify(config, null, 2), 'utf8');
}

module.exports = { loadConfig, saveConfig, DEFAULT_CONFIG };
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /d D:\open_workspace\desktop_cat && node --test test/config.test.js`
Expected: PASS,4 个用例全过。

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/config.test.js
git commit -m "feat: 配置读写模块(默认值/缺字段容错/损坏JSON容错)"
```

---

## Task 3: 视频扫描与缓存判定模块(TDD)

**Files:**
- Create: `D:/open_workspace/desktop_cat/src/video-scanner.js`
- Test: `D:/open_workspace/desktop_cat/test/video-scanner.test.js`

设计:两个纯函数。
- `listSourceVideos(folder)`:列出文件夹内受支持的视频文件(`.mp4 .mov .webm .mkv .avi`,大小写不敏感),返回绝对路径数组(按文件名排序,保证轮播顺序稳定)。
- `cacheKeyFor(filePath, mtimeMs)`:根据源文件名 + 修改时间算出缓存文件名(纯字符串运算,便于「命中缓存就跳过转换」),返回形如 `<basename>-<mtimeMs>.webm`。
- `planConversions(sourceFiles, statFn, existsFn, cacheDir)`:输入源文件列表,用注入的 `statFn`/`existsFn`(便于单测)判定每个文件「已缓存(命中,直接播)」还是「需转换」,返回 `{ ready: [...webm路径], toConvert: [{ src, outPath }] }`。

- [ ] **Step 1: 写失败测试**

`D:/open_workspace/desktop_cat/test/video-scanner.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listSourceVideos, cacheKeyFor, planConversions } = require('../src/video-scanner');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dcatv-'));
}

test('listSourceVideos 只返回受支持的视频且按名排序', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'b.mp4'), '');
  fs.writeFileSync(path.join(dir, 'a.MOV'), '');
  fs.writeFileSync(path.join(dir, 'note.txt'), '');
  fs.writeFileSync(path.join(dir, 'c.webm'), '');
  const got = listSourceVideos(dir).map((p) => path.basename(p));
  assert.deepStrictEqual(got, ['a.MOV', 'b.mp4', 'c.webm']);
});

test('listSourceVideos 对不存在的文件夹返回空数组', () => {
  assert.deepStrictEqual(listSourceVideos('C:/no/such/dir/xyz'), []);
});

test('cacheKeyFor 由文件名与 mtime 决定,稳定可复现', () => {
  const k1 = cacheKeyFor('C:/cats/kitty.mp4', 1700000000000);
  const k2 = cacheKeyFor('C:/cats/kitty.mp4', 1700000000000);
  assert.strictEqual(k1, k2);
  assert.match(k1, /\.webm$/);
});

test('cacheKeyFor 修改时间变化则 key 变化(触发重转)', () => {
  const k1 = cacheKeyFor('C:/cats/kitty.mp4', 1700000000000);
  const k2 = cacheKeyFor('C:/cats/kitty.mp4', 1700000009999);
  assert.notStrictEqual(k1, k2);
});

test('planConversions 区分已缓存与待转换', () => {
  const cacheDir = 'C:/cache';
  const sources = ['C:/cats/a.mp4', 'C:/cats/b.mp4'];
  const statFn = (p) => ({ mtimeMs: p.endsWith('a.mp4') ? 111 : 222 });
  // a 的缓存已存在,b 的不存在
  const aOut = path.join(cacheDir, cacheKeyFor('C:/cats/a.mp4', 111));
  const existsFn = (p) => p === aOut;
  const { ready, toConvert } = planConversions(sources, statFn, existsFn, cacheDir);
  assert.deepStrictEqual(ready, [aOut]);
  assert.strictEqual(toConvert.length, 1);
  assert.strictEqual(toConvert[0].src, 'C:/cats/b.mp4');
  assert.strictEqual(toConvert[0].outPath, path.join(cacheDir, cacheKeyFor('C:/cats/b.mp4', 222)));
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /d D:\open_workspace\desktop_cat && node --test test/video-scanner.test.js`
Expected: FAIL — `Cannot find module '../src/video-scanner'`。

- [ ] **Step 3: 写最小实现**

`D:/open_workspace/desktop_cat/src/video-scanner.js`:

```js
const fs = require('node:fs');
const path = require('node:path');

const SUPPORTED = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi']);

function listSourceVideos(folder) {
  let entries;
  try {
    entries = fs.readdirSync(folder);
  } catch {
    return [];
  }
  return entries
    .filter((name) => SUPPORTED.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => path.join(folder, name));
}

function cacheKeyFor(filePath, mtimeMs) {
  const base = path.basename(filePath, path.extname(filePath));
  const safe = base.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safe}-${Math.round(mtimeMs)}.webm`;
}

function planConversions(sourceFiles, statFn, existsFn, cacheDir) {
  const ready = [];
  const toConvert = [];
  for (const src of sourceFiles) {
    const { mtimeMs } = statFn(src);
    const outPath = path.join(cacheDir, cacheKeyFor(src, mtimeMs));
    if (existsFn(outPath)) {
      ready.push(outPath);
    } else {
      toConvert.push({ src, outPath });
    }
  }
  return { ready, toConvert };
}

module.exports = { listSourceVideos, cacheKeyFor, planConversions, SUPPORTED };
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /d D:\open_workspace\desktop_cat && node --test test/video-scanner.test.js`
Expected: PASS,5 个用例全过。

- [ ] **Step 5: Commit**

```bash
git add src/video-scanner.js test/video-scanner.test.js
git commit -m "feat: 视频扫描与缓存判定(支持格式过滤/mtime缓存key/转换规划)"
```

---

## Task 4: ffmpeg 绿幕转透明 webm 模块

**Files:**
- Create: `D:/open_workspace/desktop_cat/src/converter.js`

设计:封装一次绿幕→透明 webm 的转换。用 `ffmpeg-static` 给的 ffmpeg 路径,`child_process.spawn` 调用。绿幕抠像用 ffmpeg 的 `chromakey` 滤镜输出带 alpha,编码用 `libvpx-vp9` + `yuva420p`(VP9 支持 alpha 通道)。**先写临时文件,转换成功后再 rename 成最终文件名**,避免半成品被当成成品(对应 spec 错误处理「转换中程序被关」)。无单测(依赖真实 ffmpeg 与视频),通过 Task 9 手动验证。

- [ ] **Step 1: 写 converter.js**

`D:/open_workspace/desktop_cat/src/converter.js`:

```js
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ffmpegPath = require('ffmpeg-static');

/**
 * 把绿幕视频转成带 alpha 通道的透明 webm。
 * @param {string} src 源视频路径(绿幕)
 * @param {string} outPath 目标 webm 路径(最终名)
 * @param {object} [opts]
 * @param {string} [opts.chromaColor='0x00FF00'] 要抠掉的绿幕色
 * @param {number} [opts.similarity=0.18] 颜色相似度阈值
 * @param {number} [opts.blend=0.10] 边缘混合
 * @returns {Promise<string>} 成功后 resolve outPath
 */
function convertGreenScreen(src, outPath, opts = {}) {
  const chromaColor = opts.chromaColor || '0x00FF00';
  const similarity = opts.similarity ?? 0.18;
  const blend = opts.blend ?? 0.10;
  const tmpPath = `${outPath}.tmp.webm`;

  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const filter = `chromakey=${chromaColor}:${similarity}:${blend}`;
    const args = [
      '-y',
      '-i', src,
      '-vf', filter,
      '-c:v', 'libvpx-vp9',
      '-pix_fmt', 'yuva420p',
      '-an',
      tmpPath,
    ];
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        try {
          fs.renameSync(tmpPath, outPath);
          resolve(outPath);
        } catch (e) {
          reject(e);
        }
      } else {
        try { fs.existsSync(tmpPath) && fs.unlinkSync(tmpPath); } catch {}
        reject(new Error(`ffmpeg 转换失败 (code ${code}): ${stderr.slice(-500)}`));
      }
    });
  });
}

module.exports = { convertGreenScreen };
```

- [ ] **Step 2: 冒烟验证模块可加载**

Run: `cd /d D:\open_workspace\desktop_cat && node -e "console.log(typeof require('./src/converter').convertGreenScreen)"`
Expected: 打印 `function`。

- [ ] **Step 3: Commit**

```bash
git add src/converter.js
git commit -m "feat: ffmpeg 绿幕抠像转透明webm(VP9+alpha,临时文件防半成品)"
```

---

## Task 5: 渲染进程(透明播放器)+ preload 桥

**Files:**
- Create: `D:/open_workspace/desktop_cat/src/renderer/index.html`
- Create: `D:/open_workspace/desktop_cat/src/renderer/style.css`
- Create: `D:/open_workspace/desktop_cat/src/renderer/renderer.js`
- Create: `D:/open_workspace/desktop_cat/src/preload.js`

设计:renderer 只认透明 webm 列表,顺序循环播放,一个 `ended` 切下一个,最后一个回到第一个。列表为空时显示占位提示。preload 通过 IPC 暴露两个能力:`onPlaylist(cb)`(主进程推列表)、`onStatus(cb)`(主进程推「转换中 2/5」「无视频」等提示)。右键弹菜单通过 `requestMenu()` 通知主进程。

- [ ] **Step 1: 写 preload.js**

`D:/open_workspace/desktop_cat/src/preload.js`:

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  onPlaylist: (cb) => ipcRenderer.on('playlist', (_e, list) => cb(list)),
  onStatus: (cb) => ipcRenderer.on('status', (_e, text) => cb(text)),
  requestMenu: () => ipcRenderer.send('open-context-menu'),
});
```

- [ ] **Step 2: 写 index.html**

`D:/open_workspace/desktop_cat/src/renderer/index.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div id="drag-region">
    <video id="pet" autoplay muted playsinline></video>
    <div id="hint">右键我 → 选择视频文件夹</div>
  </div>
  <script src="renderer.js"></script>
</body>
</html>
```

- [ ] **Step 3: 写 style.css**

`D:/open_workspace/desktop_cat/src/renderer/style.css`:

```css
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  background: transparent;
  overflow: hidden;
}
#drag-region {
  width: 100vw;
  height: 100vh;
  -webkit-app-region: drag;
  display: flex;
  align-items: center;
  justify-content: center;
}
#pet {
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}
#hint {
  position: absolute;
  color: #fff;
  font: 14px sans-serif;
  text-align: center;
  text-shadow: 0 1px 3px rgba(0,0,0,.8);
  padding: 0 12px;
  -webkit-app-region: no-drag;
}
#pet.has-video + #hint { display: none; }
```

- [ ] **Step 4: 写 renderer.js**

`D:/open_workspace/desktop_cat/src/renderer/renderer.js`:

```js
const video = document.getElementById('pet');
const hint = document.getElementById('hint');

let playlist = [];
let index = 0;

function playCurrent() {
  if (playlist.length === 0) {
    video.removeAttribute('src');
    video.classList.remove('has-video');
    return;
  }
  video.src = playlist[index];
  video.classList.add('has-video');
  video.play().catch(() => {});
}

video.addEventListener('ended', () => {
  if (playlist.length === 0) return;
  index = (index + 1) % playlist.length;
  playCurrent();
});

window.petAPI.onPlaylist((list) => {
  playlist = Array.isArray(list) ? list : [];
  index = 0;
  if (playlist.length === 0) {
    hint.textContent = '该文件夹没有可用视频';
  }
  playCurrent();
});

window.petAPI.onStatus((text) => {
  hint.textContent = text;
});

// 右键交给主进程弹原生菜单(左键拖动由 CSS app-region 处理)
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.petAPI.requestMenu();
});
```

- [ ] **Step 5: 冒烟验证 HTML/JS 无语法错误**

Run: `cd /d D:\open_workspace\desktop_cat && node --check src/renderer/renderer.js && node --check src/preload.js && echo OK`
Expected: 打印 `OK`(无语法错误)。

- [ ] **Step 6: Commit**

```bash
git add src/renderer src/preload.js
git commit -m "feat: 透明播放器渲染进程与IPC桥(顺序循环/占位提示/右键转主进程)"
```

---

## Task 6: 主进程基础 — 透明窗口 + 记住位置尺寸

**Files:**
- Create: `D:/open_workspace/desktop_cat/src/main.js`
- Create: `D:/open_workspace/desktop_cat/assets/tray-icon.png`(占位图标)

设计:本任务先把透明置顶可拖动窗口立起来,并接通 config 的位置尺寸记忆。托盘菜单与转换在后续任务加。

- [ ] **Step 1: 生成一个占位托盘图标(16x16 纯色 PNG)**

Run(在项目根执行):
```
cd /d D:\open_workspace\desktop_cat && node -e "const fs=require('fs');fs.mkdirSync('assets',{recursive:true});const b=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHElEQVR42mNkYPhfz0AEYBxVSF+Fo4qGFwAAuMwD/QYpQ1cAAAAASUVORK5CYII=','base64');fs.writeFileSync('assets/tray-icon.png',b);console.log('icon bytes',b.length)"
```
Expected: 打印 `icon bytes 119` 左右,生成 `assets/tray-icon.png`。

- [ ] **Step 2: 写 main.js(本任务版本:窗口 + 位置尺寸记忆)**

`D:/open_workspace/desktop_cat/src/main.js`:

```js
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { loadConfig, saveConfig } = require('./config');

let win = null;
let config = null;
let userDataDir = null;
let saveTimer = null;

function debounceSaveBounds() {
  if (!win) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    config.windowBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
    saveConfig(userDataDir, config);
  }, 400);
}

function createWindow() {
  const wb = config.windowBounds;
  win = new BrowserWindow({
    width: wb.width || 300,
    height: wb.height || 300,
    x: wb.x ?? undefined,
    y: wb.y ?? undefined,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.on('move', debounceSaveBounds);
  win.on('resize', debounceSaveBounds);
}

app.whenReady().then(() => {
  userDataDir = app.getPath('userData');
  config = loadConfig(userDataDir);
  createWindow();
});

app.on('window-all-closed', () => {
  // 托盘常驻前,先允许关闭即退出;Task 7 接入托盘后改为不退出
  app.quit();
});

module.exports = { __test: { debounceSaveBounds } };
```

- [ ] **Step 3: 启动验证透明窗口**

Run(后台/手动): `cd /d D:\open_workspace\desktop_cat && npm start`
Expected:桌面出现一个 300×300 透明无边框窗口,中间白字提示「右键我 → 选择视频文件夹」,窗口置顶,可用左键按住拖动。拖动后关闭,再 `npm start`,窗口回到上次位置。(手动观察;关闭窗口即退出。)

- [ ] **Step 4: Commit**

```bash
git add src/main.js assets/tray-icon.png
git commit -m "feat: 主进程透明置顶可拖动窗口与位置尺寸记忆"
```

---

## Task 7: 托盘 + 右键菜单(选文件夹/尺寸/显示隐藏/自启/退出)

**Files:**
- Modify: `D:/open_workspace/desktop_cat/src/main.js`(整体替换为含托盘菜单版本)

设计:加托盘图标和菜单构建函数 `buildMenu()`,托盘和右键(渲染进程 `open-context-menu` IPC)弹同一套菜单。尺寸档位直接 `setSize`。开机自启用 `app.setLoginItemSettings`。选文件夹用 `dialog.showOpenDialog`,选中后存配置并触发 `reloadVideos()`(Task 8 实现转换;本任务先留一个会推空列表的占位实现,保证菜单可用)。`window-all-closed` 改为不退出(托盘常驻),退出只能走菜单「退出」。

- [ ] **Step 1: 整体替换 main.js**

`D:/open_workspace/desktop_cat/src/main.js`:

```js
const { app, BrowserWindow, Tray, Menu, dialog, ipcMain } = require('electron');
const path = require('node:path');
const { loadConfig, saveConfig } = require('./config');

let win = null;
let tray = null;
let config = null;
let userDataDir = null;
let saveTimer = null;
let isQuitting = false;

const SIZE_PRESETS = { 小: 200, 中: 300, 大: 450 };

function debounceSaveBounds() {
  if (!win) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    config.windowBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
    saveConfig(userDataDir, config);
  }, 400);
}

function applySize(px) {
  if (!win) return;
  win.setSize(px, px);
  debounceSaveBounds();
}

async function chooseFolder() {
  const res = await dialog.showOpenDialog(win, {
    title: '选择宠物视频文件夹(绿幕)',
    properties: ['openDirectory'],
  });
  if (res.canceled || res.filePaths.length === 0) return;
  config.sourceFolder = res.filePaths[0];
  saveConfig(userDataDir, config);
  reloadVideos();
}

function toggleVisible() {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else win.show();
  buildMenu();
}

function toggleAutoLaunch() {
  config.autoLaunch = !config.autoLaunch;
  app.setLoginItemSettings({ openAtLogin: config.autoLaunch });
  saveConfig(userDataDir, config);
  buildMenu();
}

function buildMenu() {
  const visible = win && win.isVisible();
  const menu = Menu.buildFromTemplate([
    { label: '选择视频文件夹…', click: chooseFolder },
    {
      label: '尺寸',
      submenu: [
        { label: '小 (200)', click: () => applySize(SIZE_PRESETS.小) },
        { label: '中 (300)', click: () => applySize(SIZE_PRESETS.中) },
        { label: '大 (450)', click: () => applySize(SIZE_PRESETS.大) },
      ],
    },
    { label: visible ? '隐藏' : '显示', click: toggleVisible },
    { type: 'separator' },
    { label: '开机启动', type: 'checkbox', checked: !!config.autoLaunch, click: toggleAutoLaunch },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]);
  if (tray) tray.setContextMenu(menu);
  return menu;
}

function createTray() {
  tray = new Tray(path.join(__dirname, '..', 'assets', 'tray-icon.png'));
  tray.setToolTip('桌面宠物 Desktop Cat');
  tray.on('click', () => toggleVisible());
  buildMenu();
}

function createWindow() {
  const wb = config.windowBounds;
  win = new BrowserWindow({
    width: wb.width || 300,
    height: wb.height || 300,
    x: wb.x ?? undefined,
    y: wb.y ?? undefined,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('move', debounceSaveBounds);
  win.on('resize', debounceSaveBounds);
  win.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); win.hide(); buildMenu(); }
  });
}

// 占位:Task 8 用真实扫描+转换替换
function reloadVideos() {
  if (win) win.webContents.send('playlist', []);
}

ipcMain.on('open-context-menu', () => {
  if (win) buildMenu().popup({ window: win });
});

app.whenReady().then(() => {
  userDataDir = app.getPath('userData');
  config = loadConfig(userDataDir);
  if (config.autoLaunch) app.setLoginItemSettings({ openAtLogin: true });
  createWindow();
  createTray();
  reloadVideos();
});

app.on('window-all-closed', () => {
  // 托盘常驻:不退出
});
```

- [ ] **Step 2: 校验语法**

Run: `cd /d D:\open_workspace\desktop_cat && node --check src/main.js && echo OK`
Expected: 打印 `OK`。

- [ ] **Step 3: 手动验证托盘与菜单**

Run: `cd /d D:\open_workspace\desktop_cat && npm start`
Expected:
- 系统托盘出现猫图标,右键托盘弹出菜单(选文件夹/尺寸/隐藏/开机启动/退出)。
- 右键桌面上的窗口也弹出同一菜单。
- 「尺寸 → 小/中/大」即时改变窗口大小;关闭重开记住尺寸。
- 「开机启动」勾选可切换(可在任务管理器→启动 里核对)。
- 关闭窗口(若有方式)不退出,变为隐藏;只有菜单「退出」真正结束进程。

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat: 托盘与右键菜单(选文件夹/尺寸档位/显示隐藏/开机自启/退出)"
```

---

## Task 8: 接通转换编排 — 选文件夹后扫描+转换+轮播

**Files:**
- Modify: `D:/open_workspace/desktop_cat/src/main.js`(替换 `reloadVideos` 占位,接入扫描/转换/状态推送)

设计:用 Task 3 的 `listSourceVideos` / `planConversions` 和 Task 4 的 `convertGreenScreen`,把「选文件夹」串成完整链路:扫描源 → 规划(命中缓存的直接入列表,其余排队转换)→ 边转边推状态「转换中 i/n」→ 全部就绪后推最终 playlist。缓存目录 = `userData/cache`。单个转换失败跳过并记录,不中断整批(对应 spec 错误处理)。

- [ ] **Step 1: 在 main.js 顶部补依赖,替换 reloadVideos**

在 `src/main.js` 顶部 require 区加入:

```js
const fs = require('node:fs');
const { listSourceVideos, planConversions } = require('./video-scanner');
const { convertGreenScreen } = require('./converter');
```

把 Task 7 里的占位 `reloadVideos` 整个替换为:

```js
let reloadToken = 0;

function sendStatus(text) {
  if (win) win.webContents.send('status', text);
}
function sendPlaylist(list) {
  if (win) win.webContents.send('playlist', list);
}
function toFileUrl(p) {
  return 'file:///' + p.replace(/\\/g, '/');
}

async function reloadVideos() {
  const myToken = ++reloadToken; // 防止快速切文件夹时旧任务覆盖新结果
  const folder = config.sourceFolder;
  if (!folder) { sendPlaylist([]); return; }

  const cacheDir = path.join(userDataDir, 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });

  const sources = listSourceVideos(folder);
  if (sources.length === 0) {
    sendStatus('该文件夹没有可用视频');
    sendPlaylist([]);
    return;
  }

  const statFn = (p) => fs.statSync(p);
  const existsFn = (p) => fs.existsSync(p);
  const { ready, toConvert } = planConversions(sources, statFn, existsFn, cacheDir);

  const done = [...ready];
  if (toConvert.length > 0) {
    for (let i = 0; i < toConvert.length; i++) {
      if (myToken !== reloadToken) return; // 已有更新的 reload,放弃
      const { src, outPath } = toConvert[i];
      sendStatus(`转换中 ${i + 1}/${toConvert.length}…`);
      try {
        await convertGreenScreen(src, outPath, { chromaColor: config.chromaColor });
        done.push(outPath);
      } catch (err) {
        console.error('转换失败,跳过:', src, err.message);
      }
    }
  }

  if (myToken !== reloadToken) return;
  if (done.length === 0) {
    sendStatus('没有可播放的视频(转换均失败)');
    sendPlaylist([]);
  } else {
    sendPlaylist(done.map(toFileUrl));
  }
}
```

- [ ] **Step 2: 校验语法**

Run: `cd /d D:\open_workspace\desktop_cat && node --check src/main.js && echo OK`
Expected: 打印 `OK`。

- [ ] **Step 3: 跑全部单测确保未回归**

Run: `cd /d D:\open_workspace\desktop_cat && node --test`
Expected: config + video-scanner 全部用例 PASS。

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat: 选文件夹→扫描→绿幕转透明→缓存复用→轮播 完整链路"
```

---

## Task 9: 端到端手动验证 + README

**Files:**
- Create: `D:/open_workspace/desktop_cat/README.md`

- [ ] **Step 1: 准备一段绿幕测试视频**

把任意一段**纯绿背景**的短视频(.mp4)放进一个测试文件夹,例如 `D:/open_workspace/desktop_cat/sample/`(可用手机拍一段绿色纸板前的物体,或网上找绿幕素材)。

- [ ] **Step 2: 端到端验证清单(逐项勾)**

Run: `cd /d D:\open_workspace\desktop_cat && npm start`,然后逐项确认:
- [ ] 托盘「选择视频文件夹…」选中 `sample/` 后,出现「转换中 1/N…」状态
- [ ] 转换完成后,桌面窗口里宠物出现且**背景透明**(能看到桌面/其它窗口)
- [ ] 一个视频播完**自动切下一个**;最后一个播完**回到第一个**循环
- [ ] 左键按住可拖动窗口;右键弹菜单(不拖动)
- [ ] 尺寸「小/中/大」即时生效
- [ ] 关闭并重开,窗口**位置与尺寸保持上次**
- [ ] 再次选同一文件夹,**秒加载**(命中缓存不重转)
- [ ] 托盘「隐藏/显示」可切换窗口;「退出」真正结束进程
- [ ] (可选)勾「开机启动」,在任务管理器→启动 里看到条目

- [ ] **Step 3: 写 README.md**

`D:/open_workspace/desktop_cat/README.md`:

```markdown
# Desktop Cat 桌面宠物

在桌面悬浮展示透明背景的宠物视频,自动轮播本地文件夹里的素材。

## 特性
- 透明、无边框、置顶、可拖动的桌面宠物窗口
- 右键菜单选本地文件夹,自动轮播里面的视频(一个播完切下一个,循环)
- 提供**绿幕视频**即可:程序首次导入时用内置 ffmpeg 自动抠绿幕、转成透明视频并缓存,之后播放零开销
- 右键菜单调尺寸(小/中/大),记住窗口位置与尺寸
- 系统托盘:显示/隐藏、开机自启开关、退出

## 运行
```bash
npm install
npm start
```

## 使用
1. 启动后右键桌面上的宠物(或右键系统托盘图标)
2. 「选择视频文件夹…」选中放有绿幕宠物视频的文件夹
3. 等待首次转换完成,宠物即出现在桌面
4. 用菜单调尺寸、显示/隐藏、设置开机启动

## 视频素材要求
- 纯绿幕背景(标准绿 `#00FF00` 效果最佳)
- 支持 .mp4 / .mov / .webm / .mkv / .avi
- 转换产物(透明 webm)缓存在用户数据目录,不修改原始文件

## 开发
```bash
npm test   # 运行纯逻辑单测(config / video-scanner)
```
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: 添加 README 与端到端验证说明"
```

---

## Self-Review(规划者自查)

- **Spec 覆盖**:透明置顶可拖动窗口(T6)、绿幕导入转透明缓存复用(T4/T8)、文件夹轮播一个播完切下一个(T5)、托盘+右键菜单全项(T7)、记住位置尺寸(T6)、配置存储(T2)、扫描与缓存判定(T3)、错误处理各项(空文件夹/转换失败跳过/缓存缺失重转/半成品防护 分散在 T3/T4/T8)、测试策略(纯逻辑 TDD in T2/T3 + 手动清单 T9)——均有对应任务。✅
- **占位符扫描**:无 TBD/TODO,每个代码步骤含完整代码。✅
- **类型/命名一致**:`loadConfig/saveConfig/DEFAULT_CONFIG`、`listSourceVideos/cacheKeyFor/planConversions`、`convertGreenScreen`、IPC 频道 `playlist`/`status`/`open-context-menu`、`reloadVideos`——跨任务引用一致。✅
- **依赖顺序**:T1 装依赖 → T2/T3 纯逻辑 → T4 转换 → T5 渲染 → T6 窗口 → T7 菜单(用到 T2 config)→ T8 串联(用到 T3/T4)→ T9 验证。无前向引用未定义符号。✅
