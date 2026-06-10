const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ffmpegPath = require('ffmpeg-static');

/**
 * 探测绿幕视频里"猫"(非绿幕内容)的最大边界框,返回 ffmpeg crop 串 `W:H:X:Y`。
 * 原理:抠像 → alphaextract 把不透明区(猫)变白、透明区(绿幕)变黑 → cropdetect 找白色边界。
 * 取整段视频的并集(猫会动),best-effort:失败/超时返回 null,调用方退回不裁剪。
 * @returns {Promise<string|null>}
 */
function detectCrop(src, chromaColor, similarity, blend, signal) {
  return new Promise((resolve) => {
    const filter = [
      `chromakey=${chromaColor}:${similarity}:${blend}`,
      'format=yuva420p',
      'alphaextract',
      'cropdetect=limit=16:round=2:reset=0',
    ].join(',');
    const proc = spawn(ffmpegPath, [
      '-threads', '2',
      '-t', '3',      // 只扫前 3 秒:绿幕视频通常是固定机位,边界信息在前几帧即可确定
      '-i', src,
      '-vf', filter,
      '-f', 'null', '-',
    ], { windowsHide: true });
    let onAbort = null;
    if (signal) { onAbort = () => proc.kill(); signal.addEventListener('abort', onAbort, { once: true }); }
    // 3 秒兜底:探测只扫前 3 秒视频,不该拖更久。
    const timer = setTimeout(() => proc.kill(), 3000);
    let tail = '';
    proc.stderr.on('data', (d) => { tail += d.toString(); if (tail.length > 65536) tail = tail.slice(-65536); });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      // cropdetect 每帧输出一行,取最后一个非全黑的 crop=W:H:X:Y。
      const matches = tail.match(/crop=(\d+):(\d+):(\d+):(\d+)/g);
      if (!matches || matches.length === 0) { resolve(null); return; }
      resolve(matches[matches.length - 1].slice(5)); // 去掉 'crop=' 前缀
    });
  });
}

/**
 * 把绿幕视频转成带 alpha 通道的透明 webm。
 * @param {string} src 源视频路径(绿幕)
 * @param {string} outPath 目标 webm 路径(最终名)
 * @param {object} [opts]
 * @param {string} [opts.chromaColor='0x00FF00'] 要抠掉的绿幕色
 * @param {number} [opts.similarity=0.18] 颜色相似度阈值
 * @param {number} [opts.blend=0.10] 边缘混合
 * @param {number} [opts.maxHeight=512] 输出最大高度(超过则等比缩小,宠物窗最大仅 450px)
 * @param {boolean} [opts.autoCrop=true] 是否自动裁掉四周绿幕边距,让猫贴边填满
 * @param {AbortSignal} [opts.signal] 取消信号,abort 时杀掉 ffmpeg 进程
 * @returns {Promise<string>} 成功后 resolve outPath
 */
async function convertGreenScreen(src, outPath, opts = {}) {
  if (!ffmpegPath) {
    throw new Error('ffmpeg 未安装,请重新执行 npm install');
  }
  const chromaColor = opts.chromaColor || '0x00FF00';
  const similarity = opts.similarity ?? 0.18;
  const blend = opts.blend ?? 0.10;
  const maxHeight = opts.maxHeight ?? 512;
  const autoCrop = opts.autoCrop !== false;
  const tmpPath = `${outPath}.tmp.webm`;

  // 先探测裁剪框(best-effort);失败则不裁剪。
  let cropExpr = null;
  if (autoCrop) {
    try { cropExpr = await detectCrop(src, chromaColor, similarity, blend, opts.signal); }
    catch { cropExpr = null; }
  }
  if (opts.signal && opts.signal.aborted) throw new Error('aborted');

  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    // 顺序:先裁掉绿幕边距(若探测到)→ 按需缩小 → 抠像。
    // 单引号是 ffmpeg 自身的表达式引用(spawn 不经 shell,故非 shell 引号),用于让内层逗号
    // 不被误解析为 filter 分隔符。
    const filter = [
      ...(cropExpr ? [`crop=${cropExpr}`] : []),
      `scale=-2:'min(ih,${maxHeight})'`,
      `chromakey=${chromaColor}:${similarity}:${blend}`,
      'format=yuva420p',
    ].join(',');
    // threads=2 硬编码:单个 VP9 编码不需要全核;并发由上层 main.js 的进程池控制。
    const args = [
      '-y',
      '-i', src,
      '-vf', filter,
      '-c:v', 'libvpx-vp9',
      '-pix_fmt', 'yuva420p',
      '-auto-alt-ref', '0',
      '-deadline', 'good',
      '-cpu-used', '4',
      '-threads', '2',
      '-an',
      tmpPath,
    ];
    const proc = spawn(ffmpegPath, args, { windowsHide: true });

    if (opts.signal) {
      opts.signal.addEventListener('abort', () => { proc.kill(); }, { once: true });
    }

    // 环形 buffer:stderr 只保留最后 8KB,避免大视频的进度输出填满内存。
    let stderrTail = '';
    proc.stderr.on('data', (d) => {
      stderrTail += d.toString();
      if (stderrTail.length > 8192) stderrTail = stderrTail.slice(-8192);
    });
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
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
        reject(new Error(`ffmpeg 转换失败 (code ${code}): ${stderrTail.slice(-500)}`));
      }
    });
  });
}

module.exports = { convertGreenScreen };
