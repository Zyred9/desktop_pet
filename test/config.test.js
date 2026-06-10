const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig, saveConfig, DEFAULT_CONFIG } = require('../src/config');

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcat-'));
  return { dir, clean: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('loadConfig 在无文件时返回默认配置', () => {
  const { dir, clean } = tmpDir();
  const cfg = loadConfig(dir);
  assert.deepStrictEqual(cfg, DEFAULT_CONFIG);
  clean();
});

test('saveConfig 后 loadConfig 能读回', () => {
  const { dir, clean } = tmpDir();
  saveConfig(dir, { ...DEFAULT_CONFIG, sourceFolder: 'C:/cats', autoLaunch: true });
  const cfg = loadConfig(dir);
  assert.strictEqual(cfg.sourceFolder, 'C:/cats');
  assert.strictEqual(cfg.autoLaunch, true);
  clean();
});

test('loadConfig 对缺字段用默认值补齐', () => {
  const { dir, clean } = tmpDir();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ sourceFolder: 'C:/x' }));
  const cfg = loadConfig(dir);
  assert.strictEqual(cfg.sourceFolder, 'C:/x');
  assert.deepStrictEqual(cfg.windowBounds, DEFAULT_CONFIG.windowBounds);
  assert.strictEqual(cfg.autoLaunch, DEFAULT_CONFIG.autoLaunch);
  clean();
});

test('loadConfig 对损坏的 JSON 返回默认配置不抛错', () => {
  const { dir, clean } = tmpDir();
  fs.writeFileSync(path.join(dir, 'config.json'), '{ broken json');
  const cfg = loadConfig(dir);
  assert.deepStrictEqual(cfg, DEFAULT_CONFIG);
  clean();
});
