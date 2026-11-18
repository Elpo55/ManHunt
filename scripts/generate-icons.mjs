// Génère les icônes PNG de la PWA (sans dépendance) : emblème « réticule ».
// Usage : node scripts/generate-icons.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}
const BG = [5, 6, 8], GREY = [93, 99, 110], VOLT = [47, 107, 255], IVORY = [236, 232, 223];
function mix(a, b, t) { return a.map((v, i) => Math.round(v * (1 - t) + b[i] * t)); }
function emblem(scale) {
  return (x, y, size) => {
    const u = (x / size - 0.5) * 64 / scale, v = (y / size - 0.5) * 64 / scale;
    const d = Math.hypot(u, v);
    const aa = (dist, w) => Math.max(0, Math.min(1, w / 2 + 0.5 - Math.abs(dist) * size / 64 * scale)) ;
    let col = BG;
    col = mix(col, GREY, aa(d - 21, 3 * size / 64 * scale));
    col = mix(col, VOLT, aa(d - 10, 3.5 * size / 64 * scale));
    const line = (Math.abs(u) < 1.5 && Math.abs(v) > 15 && Math.abs(v) < 27) || (Math.abs(v) < 1.5 && Math.abs(u) > 15 && Math.abs(u) < 27);
    if (line) col = IVORY;
    return [...col, 255];
  };
}
mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", png(192, emblem(1)));
writeFileSync("public/icons/icon-512.png", png(512, emblem(1)));
writeFileSync("public/icons/icon-maskable-512.png", png(512, emblem(0.72)));
writeFileSync("public/icons/apple-touch-icon.png", png(180, emblem(0.9)));
console.log("Icônes générées dans public/icons/");
