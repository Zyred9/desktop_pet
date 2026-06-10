// 生成一个合法的 16x16 RGBA PNG 托盘图标(橙色猫脸占位)
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const W = 16;
const H = 16;
const px = Buffer.alloc(W * H * 4, 0);

function set(x, y, r, g, b, a) {
  const i = (y * W + x) * 4;
  px[i] = r;
  px[i + 1] = g;
  px[i + 2] = b;
  px[i + 3] = a;
}

// 圆脸
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = x - 8 + 0.5;
    const dy = y - 9 + 0.5;
    if (Math.sqrt(dx * dx + dy * dy) < 6) set(x, y, 255, 150, 40, 255);
  }
}
// 两只三角耳朵
for (let y = 1; y < 5; y++) {
  for (let x = 2; x <= 2 + (4 - y); x++) set(x, y, 255, 150, 40, 255);
  for (let x = 13 - (4 - y); x <= 13; x++) set(x, y, 255, 150, 40, 255);
}
// 眼睛
set(6, 8, 30, 30, 30, 255);
set(10, 8, 30, 30, 30, 255);

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const tb = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tb, data])) >>> 0);
  return Buffer.concat([len, tb, data, crc]);
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA

const rawb = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  rawb[y * (W * 4 + 1)] = 0; // filter byte
  px.copy(rawb, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}
const idat = zlib.deflateSync(rawb);
const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'tray-icon.png'), png);
console.log('tray-icon.png bytes:', png.length);
