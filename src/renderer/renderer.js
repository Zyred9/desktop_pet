const stage = document.getElementById('stage');
const hint = document.getElementById('hint');
const videos = Array.from(document.querySelectorAll('.pet'));

let playlist = [];
let index = 0;
let activeIdx = 0; // 当前显示的 video 在 videos 中的下标

function activeVideo() { return videos[activeIdx]; }
function spareVideo() { return videos[1 - activeIdx]; }

// 把某段加载到指定 video 并(可选)开始播放。
function load(video, src, { play } = {}) {
  video.loop = false;
  video.src = src;
  if (play) video.play().catch(() => {});
  else video.load();
}

// 预热下一段到备用 video(只缓冲,不播),让衔接处无需现场解码首帧。
function preloadNext() {
  if (playlist.length < 2) return;
  const nextSrc = playlist[(index + 1) % playlist.length];
  load(spareVideo(), nextSrc, { play: false });
}

function showEmpty() {
  for (const v of videos) {
    v.removeAttribute('src');
    v.loop = false;
    v.classList.remove('active');
    v.load();
  }
  stage.classList.remove('has-video');
}

// 从头开始播放当前 playlist(用于列表内容变化、首次加载)。
function startPlayback() {
  if (playlist.length === 0) { showEmpty(); return; }
  showEmpty();
  activeIdx = 0;
  index = 0;
  const a = activeVideo();
  a.loop = playlist.length === 1;
  a.src = playlist[0];
  a.classList.add('active');
  stage.classList.add('has-video');
  a.play().catch((e) => {
    hint.textContent = `视频播放失败: ${e.message}`;
    stage.classList.remove('has-video');
  });
  preloadNext();
}

// 切到下一段:备用 video 已由 preloadNext 预热好,readyState≥3 时直接同步 swap;
// 若预热未完成(如刚启动/切文件夹),等 canplay 后再 swap,旧 video 最后一帧保持显示不会黑屏。
function advance() {
  if (playlist.length <= 1) return;
  index = (index + 1) % playlist.length;
  const spare = spareVideo();
  if (spare.src !== playlist[index]) {
    spare.src = playlist[index];
  }

  function doSwap() {
    spare.play().catch(() => {});
    activeIdx = 1 - activeIdx;
    videos.forEach((v, i) => v.classList.toggle('active', i === activeIdx));
    preloadNext();
  }

  if (spare.readyState >= 3) {
    doSwap();
  } else {
    spare.addEventListener('canplay', doSwap, { once: true });
  }
}

for (const v of videos) {
  v.addEventListener('ended', () => {
    // 仅当前显示中的 video 播完才推进;loop=true(单视频)不会触发 ended。
    if (v === activeVideo()) advance();
  });
}

// 新列表与当前列表前缀的关系:'same'(完全相同)/'append'(纯尾部追加)/'changed'(内容变化)。
function listRelation(next) {
  const common = Math.min(next.length, playlist.length);
  for (let i = 0; i < common; i++) {
    if (next[i] !== playlist[i]) return 'changed';
  }
  if (next.length === playlist.length) return 'same';
  if (next.length > playlist.length) return 'append';
  return 'changed'; // 变短(前缀相同但有删减)按内容变化处理
}

window.petAPI.onPlaylist((list) => {
  const next = Array.isArray(list) ? list : [];
  if (next.length > 0 && playlist.length > 0) {
    const rel = listRelation(next);
    // 完全相同:不打断、不重播(防御重复下发导致的画面跳变)。
    if (rel === 'same') return;
    // 纯追加:保留当前播放位置,仅扩充列表(单→多时解除 loop 并补预热下一段)。
    if (rel === 'append') {
      const wasSingle = playlist.length === 1;
      playlist = next;
      if (wasSingle) { activeVideo().loop = false; preloadNext(); }
      return;
    }
  }
  // 内容变化(换文件夹/首次):从头播。空列表的提示文案由主进程 status 负责。
  playlist = next;
  startPlayback();
});

window.petAPI.onStatus((text) => {
  hint.textContent = text;
});

// 窗口隐藏时暂停视频停止解码(后台不再烧 CPU/GPU),显示时恢复播放。
window.petAPI.onVisibility((visible) => {
  if (playlist.length === 0) return;
  if (visible) activeVideo().play().catch(() => {});
  else activeVideo().pause();
});

// 右键交给主进程弹原生菜单(左键拖动由 CSS app-region 处理)
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.petAPI.requestMenu();
});

window.petAPI.onPromptSize(() => {
  const input = prompt('输入尺寸（像素，50-2000）', '300');
  if (input) {
    const px = parseInt(input, 10);
    if (px >= 50 && px <= 2000) window.petAPI.setSize(px);
  }
});

// ===== 像素级鼠标穿透:只有猫(不透明像素)上可交互,透明区让鼠标穿透到下层 =====
// 主进程轮询全局光标并发来窗口内坐标,这里读当前帧该点的 alpha 回报是否命中猫。
const hitCanvas = document.createElement('canvas');
const hitCtx = hitCanvas.getContext('2d', { willReadFrequently: true });
let lastHitFrameTime = -1;   // 上一次 drawImage 时的 video.currentTime,用于判断帧是否变化
let lastHitVw = 0;
let lastHitVh = 0;

// 仅当视频帧变化时才重绘 canvas(drawImage 是 GPU→CPU 的昂贵操作);同帧内的多次 hit-test 直接复用。
function refreshHitCanvas(v) {
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  if (!vw || !vh) return false;
  if (v.currentTime === lastHitFrameTime && hitCanvas.width === vw && hitCanvas.height === vh) return true;
  if (hitCanvas.width !== vw || hitCanvas.height !== vh) {
    hitCanvas.width = vw;
    hitCanvas.height = vh;
  }
  try {
    hitCtx.drawImage(v, 0, 0, vw, vh);
    lastHitFrameTime = v.currentTime;
    lastHitVw = vw; lastHitVh = vh;
    return true;
  } catch {
    return false;
  }
}

// 判断窗口内坐标 (x,y) 是否落在猫的不透明像素上(考虑 object-fit:contain 的留白与缩放)。
function isOpaqueAt(x, y) {
  const v = activeVideo();
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  if (!vw || !vh) return false;
  const rect = v.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  // contain:视频按比例缩放居中,计算实际绘制区与边距。
  const scale = Math.min(rect.width / vw, rect.height / vh);
  const drawW = vw * scale;
  const drawH = vh * scale;
  const offX = rect.left + (rect.width - drawW) / 2;
  const offY = rect.top + (rect.height - drawH) / 2;
  // 落在绘制区之外(letterbox 留白)= 透明。
  if (x < offX || x >= offX + drawW || y < offY || y >= offY + drawH) return false;
  // 映射回视频原始像素坐标。
  const sx = Math.floor((x - offX) / scale);
  const sy = Math.floor((y - offY) / scale);
  if (!refreshHitCanvas(v)) return false;
  try {
    return hitCtx.getImageData(sx, sy, 1, 1).data[3] > 16;
  } catch {
    return false;
  }
}

window.petAPI.onHitTest((x, y) => {
  window.petAPI.hitResult(isOpaqueAt(x, y));
});

// ===== 拖动:在猫身上(精确像素)按下左键拖动窗口 =====
// 与穿透判定一致(都用 isOpaqueAt):猫身上既能右键又能拖,猫以外完全穿透,二者无冲突。
// 拖动期间窗口可能因光标滑过透明区而被设为穿透并丢失 mousemove,故移动由主进程
// 轮询全局光标驱动:这里只在按下时上报"抓取点相对窗口左上角的偏移",松开时结束。
window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (!isOpaqueAt(e.clientX, e.clientY)) return; // 只有点在猫身上才拖
  // e.clientX/Y 即相对窗口内容区左上角的偏移,正是拖动时要保持的"抓取点"。
  window.petAPI.dragStart({ x: Math.round(e.clientX), y: Math.round(e.clientY) });
});
window.addEventListener('mouseup', () => {
  window.petAPI.dragEnd();
});
