const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  onPlaylist: (cb) => ipcRenderer.on('playlist', (_e, list) => cb(list)),
  onStatus: (cb) => ipcRenderer.on('status', (_e, text) => cb(text)),
  onVisibility: (cb) => ipcRenderer.on('visibility', (_e, visible) => cb(visible)),
  onPromptSize: (cb) => ipcRenderer.on('prompt-size', () => cb()),
  setSize: (px) => ipcRenderer.send('set-size', px),
  requestMenu: () => ipcRenderer.send('open-context-menu'),
  // 像素穿透:主进程发来窗口内坐标,渲染层回报该点是否命中猫(不透明)。
  onHitTest: (cb) => ipcRenderer.on('hit-test', (_e, x, y) => cb(x, y)),
  hitResult: (opaque) => ipcRenderer.send('hit-result', opaque),
  // 拖动:按下上报抓取点偏移,松开结束(实际移动由主进程轮询光标驱动)。
  dragStart: (offset) => ipcRenderer.send('drag-start', offset),
  dragEnd: () => ipcRenderer.send('drag-end'),
});
