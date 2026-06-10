const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listSourceVideos, cacheKeyFor, planConversions, staleCacheFiles } = require('../src/video-scanner');

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcatv-'));
  return { dir, clean: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('listSourceVideos 只返回受支持的视频且按名排序', () => {
  const { dir, clean } = tmpDir();
  fs.writeFileSync(path.join(dir, 'b.mp4'), '');
  fs.writeFileSync(path.join(dir, 'a.MOV'), '');
  fs.writeFileSync(path.join(dir, 'note.txt'), '');
  fs.writeFileSync(path.join(dir, 'c.webm'), '');
  const got = listSourceVideos(dir).map((p) => path.basename(p));
  assert.deepStrictEqual(got, ['a.MOV', 'b.mp4', 'c.webm']);
  clean();
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

test('staleCacheFiles 只删不在保留集合内的 .webm,保留正在使用的与 .tmp.webm', () => {
  const cacheDir = 'C:/cache';
  const entries = ['keep-1.webm', 'orphan-2.webm', 'keep-3.webm', 'inflight.tmp.webm', 'note.txt'];
  const keep = [path.join(cacheDir, 'keep-1.webm'), path.join(cacheDir, 'keep-3.webm')];
  const stale = staleCacheFiles(entries, keep, cacheDir);
  // .tmp.webm 是在途中间产物,不能删;note.txt 非 webm 忽略。
  assert.deepStrictEqual(stale, ['orphan-2.webm']);
});

test('staleCacheFiles 忽略非 .webm 文件,保留集合为空时删除所有 webm', () => {
  const stale = staleCacheFiles(['a.webm', 'b.webm', 'readme.md'], [], 'C:/cache');
  assert.deepStrictEqual(stale.sort(), ['a.webm', 'b.webm'].sort());
});
