const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, screen, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { loadConfig, saveConfig } = require('./config');
const { listSourceVideos, planConversions, staleCacheFiles } = require('./video-scanner');
const { convertGreenScreen } = require('./converter');

let win = null;
let tray = null;
let config = null;
let userDataDir = null;
let saveTimer = null;
let isQuitting = false;
let reloadToken = 0;
let abortController = null;

const SIZE_PRESETS = { small: 200, medium: 300, large: 450 };

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
  buildMenu();
  reloadVideos();
}

function toggleVisible() {
  if (!win) return;
  setWindowVisible(!win.isVisible());
  buildMenu();
}

function toggleAutoLaunch() {
  config.autoLaunch = !config.autoLaunch;
  app.setLoginItemSettings({ openAtLogin: config.autoLaunch });
  saveConfig(userDataDir, config);
  buildMenu();
}

function resetPosition() {
  if (!win) return;
  win.center();
  debounceSaveBounds();
}

// 抠像预设:覆盖最常见的几种素材,避免用户因默认纯绿值抠不干净而无从下手。
const CHROMA_PRESETS = [
  { label: '标准绿幕', chromaColor: '0x00FF00', similarity: 0.18, blend: 0.10 },
  { label: '绿幕(更宽松)', chromaColor: '0x00FF00', similarity: 0.30, blend: 0.15 },
  { label: '绿幕(更严格)', chromaColor: '0x00FF00', similarity: 0.10, blend: 0.05 },
  { label: '蓝幕', chromaColor: '0x0000FF', similarity: 0.18, blend: 0.10 },
];

function applyChromaPreset(preset) {
  config.chromaColor = preset.chromaColor;
  config.similarity = preset.similarity;
  config.blend = preset.blend;
  saveConfig(userDataDir, config);
  reloadVideos();
}

function isActivePreset(preset) {
  return config.chromaColor === preset.chromaColor
    && config.similarity === preset.similarity
    && config.blend === preset.blend;
}

function openCacheDir() {
  if (!userDataDir) return;
  const cacheDir = path.join(userDataDir, 'cache');
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch {}
  shell.openPath(cacheDir);
}

function promptCustomSize() {
  if (win && !win.isDestroyed()) win.webContents.send('prompt-size');
}

function buildMenu() {
  const visible = win && win.isVisible();
  const menu = Menu.buildFromTemplate([
    { label: '选择视频文件夹…', click: chooseFolder },
    { label: '重新加载视频', click: reloadVideos, enabled: !!config.sourceFolder },
    {
      label: '抠像',
      submenu: CHROMA_PRESETS.map((preset) => ({
        label: preset.label,
        type: 'radio',
        checked: isActivePreset(preset),
        click: () => applyChromaPreset(preset),
      })),
    },
    {
      label: '尺寸',
      submenu: [
        { label: '小 (200)', click: () => applySize(SIZE_PRESETS.small) },
        { label: '中 (300)', click: () => applySize(SIZE_PRESETS.medium) },
        { label: '大 (450)', click: () => applySize(SIZE_PRESETS.large) },
        { label: '自定义…', click: promptCustomSize },
      ],
    },
    { label: visible ? '隐藏' : '显示', click: toggleVisible },
    { label: '重置位置', click: resetPosition },
    { label: '打开缓存目录', click: openCacheDir },
    { type: 'separator' },
    { label: '开机启动', type: 'checkbox', checked: !!config.autoLaunch, click: toggleAutoLaunch },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]);
  if (tray) tray.setContextMenu(menu);
  return menu;
}

function createTray() {
  const iconPath = path.join(app.getAppPath(), 'assets', 'tray-icon.png');
  tray = new Tray(iconPath);
  tray.setToolTip('桌面宠物 Desktop Pet');
  tray.on('click', () => toggleVisible());
  buildMenu();
}

function isPosOnScreen(x, y) {
  return screen.getAllDisplays().some((d) => {
    const { x: dx, y: dy, width, height } = d.workArea;
    return x >= dx && y >= dy && x < dx + width && y < dy + height;
  });
}

function createWindow() {
  const wb = config.windowBounds;
  const hasPos = wb.x != null && wb.y != null && isPosOnScreen(wb.x, wb.y);
  win = new BrowserWindow({
    width: wb.width || 300,
    height: wb.height || 300,
    x: hasPos ? wb.x : undefined,
    y: hasPos ? wb.y : undefined,
    frame: false,
    transparent: true,
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
    if (!isQuitting) { e.preventDefault(); setWindowVisible(false); buildMenu(); }
  });
}

function sendVisibility(visible) {
  if (win && !win.isDestroyed()) win.webContents.send('visibility', visible);
}
// 统一显隐入口:切换窗口可见性并通知渲染层暂停/恢复视频解码,避免散落的 show/hide 漏发信号。
function setWindowVisible(visible) {
  if (!win) return;
  if (visible) {
    win.show();
    if (!cursorTimer) cursorTimer = setInterval(pollCursor, 30);
  } else {
    win.hide();
    if (cursorTimer) { clearInterval(cursorTimer); cursorTimer = null; }
  }
  sendVisibility(visible);
}

function sendStatus(text) {
  if (win && !win.isDestroyed()) win.webContents.send('status', text);
}
function sendPlaylist(list) {
  if (win && !win.isDestroyed()) win.webContents.send('playlist', list);
}
function toFileUrl(p) {
  return pathToFileURL(p).href;
}

async function reloadVideos() {
  if (abortController) abortController.abort();
  abortController = new AbortController();
  const signal = abortController.signal;
  const myToken = ++reloadToken;
  const folder = config.sourceFolder;
  if (!folder) { sendPlaylist([]); return; }

  const cacheDir = path.join(userDataDir, 'cache');
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch {
    sendStatus('无法创建缓存目录');
    sendPlaylist([]);
    return;
  }

  const sources = listSourceVideos(folder);
  if (sources.length === 0) {
    sendStatus('该文件夹没有可用视频');
    sendPlaylist([]);
    return;
  }

  // 异步批量 stat:避免网络驱动器上逐个同步 stat 卡死主进程。
  const statResults = await Promise.all(
    sources.map(async (src) => {
      try { return { path: src, stat: await fs.promises.stat(src) }; }
      catch { return null; }
    })
  );
  const statMap = new Map();
  for (const r of statResults) {
    if (r) statMap.set(r.path, r.stat);
  }
  const statFn = (p) => statMap.get(p) || null;
  const existsFn = (p) => { try { return fs.existsSync(p); } catch { return false; } };
  const { ready, toConvert } = planConversions(sources, statFn, existsFn, cacheDir);

  if (ready.length === 0 && toConvert.length === 0) {
    sendStatus('源视频文件无法访问');
    sendPlaylist([]);
    return;
  }

  // ready 段已可播,先增量下发让宠物立即开始,后续转好的段按稳定顺序追加。
  const published = [...ready];
  if (published.length > 0) sendPlaylist(published.map(toFileUrl));

  const done = [...ready];
  if (toConvert.length > 0) {
    const total = toConvert.length;
    const convertOpts = {
      chromaColor: config.chromaColor,
      similarity: config.similarity,
      blend: config.blend,
      signal,
    };
    // results 按 toConvert 原始下标保存(成功=outPath,失败/未完成=undefined),
    // publishedCount 只沿连续就绪前缀推进,保证每次下发都是上一次的纯追加(供渲染层无打断合并)。
    const results = new Array(total);
    let publishedCount = 0;
    let next = 0;
    let finished = 0;
    const flush = () => {
      let grew = false;
      while (publishedCount < total && results[publishedCount] !== undefined) {
        if (results[publishedCount]) { published.push(results[publishedCount]); grew = true; }
        publishedCount++;
      }
      if (grew && myToken === reloadToken && !signal.aborted) {
        sendPlaylist(published.map(toFileUrl));
      }
    };
    // 并发池:硬上限 4,避免多进程 × 多线程的资源爆炸(converter 内部固定 -threads 2)。
    const concurrency = Math.min(4, Math.max(1, total));
    const worker = async () => {
      while (next < total) {
        if (myToken !== reloadToken || signal.aborted) return;
        const i = next++;
        const { src, outPath } = toConvert[i];
        try {
          await convertGreenScreen(src, outPath, convertOpts);
          results[i] = outPath;
          done.push(outPath);
        } catch (err) {
          if (signal.aborted) return;
          results[i] = null; // 标记已处理(失败),让前缀能跳过它继续推进
          console.error('转换失败,跳过:', src, err);
        }
        finished++;
        sendStatus(`转换中 ${finished}/${total}…`);
        flush();
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
  }

  if (myToken !== reloadToken || signal.aborted) return;
  cleanCache(cacheDir, done);
  if (done.length === 0) {
    sendStatus('转换均失败,无可播放视频');
    sendPlaylist([]);
  } else {
    sendStatus('');
  }
}

// 删除缓存目录里不再被任何源视频引用的孤儿 .webm(含失败残留的 .tmp.webm),避免磁盘无限增长。
// 仅在本轮 reload 的全部转码结束后调用,确保不会误删正在写入的临时文件。
function cleanCache(cacheDir, keepPaths) {
  let entries;
  try {
    entries = fs.readdirSync(cacheDir);
  } catch {
    return;
  }
  for (const name of staleCacheFiles(entries, keepPaths, cacheDir)) {
    try { fs.unlinkSync(path.join(cacheDir, name)); } catch {}
  }
}

ipcMain.on('open-context-menu', () => {
  if (win) buildMenu().popup({ window: win });
});

ipcMain.on('set-size', (_e, px) => {
  if (typeof px === 'number' && px >= 50 && px <= 2000) applySize(Math.round(px));
});

// ===== 像素级鼠标穿透 + 拖动 =====
// 窗口一旦设为穿透就收不到 DOM mousemove,故用主进程轮询全局光标来决定何时恢复交互。
let ignoringMouse = false; // 当前 setIgnoreMouseEvents 状态
let pendingHit = false;    // 是否在等渲染层的命中回报(防止 IPC 堆积)
let dragGrab = null;       // 拖动中:抓取点相对窗口左上角的偏移 {x,y};null=未拖动
let cursorTimer = null;

function setIgnore(ignore) {
  if (ignore === ignoringMouse || !win || win.isDestroyed()) return;
  ignoringMouse = ignore;
  win.setIgnoreMouseEvents(ignore, { forward: true });
}

function pollCursor() {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  const pt = screen.getCursorScreenPoint();
  const b = win.getBounds();

  // 拖动中:让抓取点始终跟随光标(期间不切穿透,保证能收到 mouseup)。
  if (dragGrab) {
    win.setPosition(pt.x - dragGrab.x, pt.y - dragGrab.y);
    return;
  }

  const inside = pt.x >= b.x && pt.x < b.x + b.width && pt.y >= b.y && pt.y < b.y + b.height;
  if (!inside) {
    // 光标不在窗口上,事件本就不会进来,无需 hit-test;保持穿透态避免边缘误挡。
    setIgnore(true);
    return;
  }
  if (!pendingHit) {
    pendingHit = true;
    win.webContents.send('hit-test', Math.round(pt.x - b.x), Math.round(pt.y - b.y));
  }
}

ipcMain.on('hit-result', (_e, opaque) => {
  pendingHit = false;
  if (!dragGrab) setIgnore(!opaque); // 命中猫=可交互(不穿透);透明=穿透
});

ipcMain.on('drag-start', (_e, offset) => {
  if (offset && typeof offset.x === 'number' && typeof offset.y === 'number') {
    dragGrab = { x: offset.x, y: offset.y };
  }
});
ipcMain.on('drag-end', () => {
  dragGrab = null;
  debounceSaveBounds(); // 拖动结束后保存新位置
});

// 单实例锁:托盘常驻应用避免多开(双进程会争抢同一份 config.json)。
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { setWindowVisible(true); win.focus(); }
  });

  app.whenReady().then(() => {
    userDataDir = app.getPath('userData');
    config = loadConfig(userDataDir);
    if (config.autoLaunch) app.setLoginItemSettings({ openAtLogin: true });
    createWindow();
    createTray();
    reloadVideos();
    cursorTimer = setInterval(pollCursor, 30); // 像素穿透 + 拖动的光标轮询(30ms 延迟基本无感)
  });
}

app.on('before-quit', () => {
  clearTimeout(saveTimer);
  clearInterval(cursorTimer);
});

app.on('window-all-closed', () => {
  // 托盘常驻:不退出
});
