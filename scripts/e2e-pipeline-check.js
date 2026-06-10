// 端到端验证「扫描→转换→缓存复用」链路(不依赖 GUI/人眼)。
// 用 ffmpeg 合成两个绿幕样本视频,跑两遍 planConversions + convertGreenScreen,
// 断言:首轮全部转换并产出带 alpha 的 webm;次轮全部命中缓存、0 转换。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert');
const ffmpeg = require('ffmpeg-static');
const { listSourceVideos, planConversions } = require('../src/video-scanner');
const { convertGreenScreen } = require('../src/converter');

function makeGreenSample(out, offset) {
  execFileSync(ffmpeg, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=0x00FF00:s=160x120:d=1:r=10',
    '-f', 'lavfi', '-i', 'color=c=red:s=40x40:d=1:r=10',
    '-filter_complex', `[0][1]overlay=x=${offset}+t*40:y=40`,
    '-pix_fmt', 'yuv420p', out,
  ]);
}

function hasAlpha(webm) {
  // ffmpeg -i 不带输出文件会以非零退出,但 stderr 含流信息;捕获它即可。
  try {
    execFileSync(ffmpeg, ['-hide_banner', '-i', webm], { encoding: 'utf8' });
    return false;
  } catch (e) {
    const txt = (e.stderr || '') + (e.stdout || '');
    return /alpha_mode\s*:\s*1/.test(txt);
  }
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dcat-e2e-'));
  const srcDir = path.join(tmp, 'src');
  const cacheDir = path.join(tmp, 'cache');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  makeGreenSample(path.join(srcDir, 'cat1.mp4'), 5);
  makeGreenSample(path.join(srcDir, 'cat2.mp4'), 60);

  const statFn = (p) => { try { return fs.statSync(p); } catch { return null; } };
  const existsFn = (p) => { try { return fs.existsSync(p); } catch { return false; } };

  // ---- 第一轮:全部需要转换 ----
  const sources = listSourceVideos(srcDir);
  assert.strictEqual(sources.length, 2, '应扫描到 2 个源视频');

  let plan = planConversions(sources, statFn, existsFn, cacheDir);
  assert.strictEqual(plan.ready.length, 0, '首轮无缓存命中');
  assert.strictEqual(plan.toConvert.length, 2, '首轮 2 个待转换');

  for (const { src, outPath } of plan.toConvert) {
    await convertGreenScreen(src, outPath, {});
    assert.ok(fs.existsSync(outPath), `产物应存在: ${outPath}`);
    assert.ok(hasAlpha(outPath), `产物应带 alpha 通道: ${outPath}`);
  }
  console.log('[第一轮] 2 个绿幕视频已转换为带 alpha 的透明 webm ✓');

  // ---- 第二轮:应全部命中缓存,0 转换 ----
  plan = planConversions(sources, statFn, existsFn, cacheDir);
  assert.strictEqual(plan.ready.length, 2, '次轮应 2 个缓存命中');
  assert.strictEqual(plan.toConvert.length, 0, '次轮应 0 个待转换(缓存复用)');
  console.log('[第二轮] 同样的文件夹全部命中缓存,0 次重复转换 ✓');

  console.log('\nE2E 链路验证通过:扫描 → 绿幕转透明 → 缓存复用 全部正确。');
}

main().catch((e) => { console.error('E2E 失败:', e); process.exit(1); });
