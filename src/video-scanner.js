const fs = require('node:fs');
const path = require('node:path');

const SUPPORTED = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi']);

function listSourceVideos(folder) {
  let entries;
  try {
    entries = fs.readdirSync(folder);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('扫描视频文件夹失败:', e);
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
    const stat = statFn(src);
    if (!stat) continue; // 源文件已被删除或不可读,跳过
    const outPath = path.join(cacheDir, cacheKeyFor(src, stat.mtimeMs));
    if (existsFn(outPath)) {
      ready.push(outPath);
    } else {
      toConvert.push({ src, outPath });
    }
  }
  return { ready, toConvert };
}

/**
 * 计算缓存目录里应删除的孤儿文件(.webm 中不在 keepPaths 集合内的)。
 * 纯函数:调用方传入当前 readdir 列表与本轮要保留的绝对路径,返回应删除的文件名数组。
 * @param {string[]} cacheEntries cacheDir 下的文件名(非绝对路径)
 * @param {string[]} keepPaths 本轮要保留的缓存文件绝对路径
 * @param {string} cacheDir 缓存目录绝对路径
 * @returns {string[]} 应删除的文件名(相对 cacheDir)
 */
function staleCacheFiles(cacheEntries, keepPaths, cacheDir) {
  const keep = new Set(keepPaths.map((p) => path.basename(p).toLowerCase()));
  return cacheEntries.filter((name) => {
    const lower = name.toLowerCase();
    return lower.endsWith('.webm') && !lower.endsWith('.tmp.webm') && !keep.has(lower);
  });
}

module.exports = { listSourceVideos, cacheKeyFor, planConversions, staleCacheFiles, SUPPORTED };
