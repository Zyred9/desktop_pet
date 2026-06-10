const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CONFIG = {
  sourceFolder: null,
  windowBounds: { x: null, y: null, width: 300, height: 300 },
  autoLaunch: false,
  chromaColor: '0x00FF00',
  similarity: 0.18,
  blend: 0.10,
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
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath(dir), JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.error('保存配置失败:', e.message);
  }
}

module.exports = { loadConfig, saveConfig, DEFAULT_CONFIG };
