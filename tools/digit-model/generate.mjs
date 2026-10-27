// Renders synthetic printed-digit cells in many fonts, runs them through the
// same cell pipeline the scanner uses (public/js/scan.js) and writes the
// resulting classifier inputs to a binary file for train.py.
// Usage: node generate.mjs <fonts-dir> <out-file> [samples-per-font-digit]
// <fonts-dir> holds *-latin-<weight>-<style>.woff2 files, e.g. unpacked from
// `npm pack @fontsource/<family>` for a few dozen text families.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// CommonJS require so a globally installed Playwright is found too.
const { chromium } = createRequire(import.meta.url)('playwright');

const [fontsDir, outFile, perArg] = process.argv.slice(2);
const per = Number(perArg ?? 12);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
const fonts = fs.readdirSync(fontsDir).filter((f) => /latin-[3-9]00-(normal|italic)\.woff2$/.test(f) && !f.includes('-ext-'));
const types = { '.js': 'text/javascript', '.woff2': 'font/woff2', '.html': 'text/html' };

const browser = await chromium.launch();
const page = await browser.newPage();
await page.route('http://gen.local/**', (route) => {
  const p = new URL(route.request().url()).pathname;
  const file = p.startsWith('/fonts/') ? path.join(fontsDir, p.slice(7)) : path.join(root, p);
  if (p === '/') return route.fulfill({ body: '<!doctype html><body></body>', contentType: 'text/html' });
  route.fulfill({ body: fs.readFileSync(file), contentType: types[path.extname(file)] });
});
await page.goto('http://gen.local/');
page.on('console', (m) => console.log('page:', m.text()));

const out = fs.openSync(outFile, 'w');
let total = 0, missed = 0, falsePos = 0;
for (let k = 0; k < fonts.length; k++) {
  const res = await page.evaluate(async ({ font, per }) => {
    const { cellVector, CELL } = await import('/js/scan.js');
    const face = new FontFace('F', `url(/fonts/${font})`, { style: font.includes('italic') ? 'italic' : 'normal' });
    await face.load();
    document.fonts.add(face);
    const rnd = (a, b) => a + Math.random() * (b - a);
    const big = document.createElement('canvas');
    const small = document.createElement('canvas');
    small.width = small.height = CELL;
    const sctx = small.getContext('2d', { willReadFrequently: true });

    const render = (digit, family) => {
      const R = Math.round(rnd(22, 90));
      big.width = big.height = R * 3;
      const ctx = big.getContext('2d');
      const bg = rnd(140, 255);
      ctx.fillStyle = `rgb(${bg},${bg},${bg * rnd(0.9, 1)})`;
      ctx.fillRect(0, 0, R * 3, R * 3);
      const ink = rnd(0, Math.min(100, bg - 60));
      ctx.fillStyle = ctx.strokeStyle = `rgb(${ink},${ink},${ink})`;
      // Grid lines around the centre cell, sometimes thick.
      for (let t = 0; t <= 3; t++) {
        const lw = Math.max(0.6, R * rnd(0.01, Math.random() < 0.3 ? 0.08 : 0.035));
        ctx.lineWidth = lw;
        ctx.beginPath(); ctx.moveTo(t * R, 0); ctx.lineTo(t * R, R * 3); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, t * R); ctx.lineTo(R * 3, t * R); ctx.stroke();
      }
      const size = R * rnd(0.5, 0.88);
      ctx.font = `${size}px ${family}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const drawDigit = (d, cx, cy) => {
        const m = ctx.measureText(String(d));
        const hgt = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rnd(-0.1, 0.1));
        ctx.scale(rnd(0.85, 1.15), 1);
        ctx.fillText(String(d), 0, hgt / 2 - m.actualBoundingBoxDescent);
        ctx.restore();
      };
      if (digit) drawDigit(digit, R * 1.5 + R * rnd(-0.08, 0.08), R * 1.5 + R * rnd(-0.08, 0.08));
      // Neighbouring digits that may poke in when the warp is off.
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (Math.random() < 0.4) drawDigit(1 + Math.floor(Math.random() * 9), R * (1.5 + dx), R * (1.5 + dy));
      }
      // Crop the centre cell with misalignment, blur and resample to CELL.
      const j = R * 0.1;
      const sx = R + rnd(-j, j), sy = R + rnd(-j, j), sw = R * rnd(0.92, 1.08);
      sctx.filter = `blur(${rnd(0, 1.3) * CELL / R}px)`;
      sctx.drawImage(big, sx, sy, sw, sw, 0, 0, CELL, CELL);
      sctx.filter = 'none';
      const img = sctx.getImageData(0, 0, CELL, CELL);
      const gray = new Uint8ClampedArray(CELL * CELL);
      const noise = rnd(0, 12);
      // Uneven lighting: linear gradient across the cell.
      const gx = rnd(-30, 30), gy = rnd(-30, 30);
      for (let i = 0; i < gray.length; i++) {
        const x = i % CELL, y = (i - x) / CELL;
        const n = (Math.random() + Math.random() + Math.random() - 1.5) * noise * 1.4;
        gray[i] = img.data[i * 4] + n + (gx * x + gy * y) / CELL;
      }
      return gray;
    };

    const vecs = [];
    let missed = 0, falsePos = 0;
    for (let s = 0; s < per; s++) {
      for (let d = 1; d <= 9; d++) {
        const v = cellVector(render(d, 'F'));
        if (!v) { missed++; continue; }
        const b = new Uint8Array(785);
        b[0] = d;
        for (let i = 0; i < 784; i++) b[i + 1] = Math.round(v[i] * 255);
        vecs.push(...b);
      }
      if (cellVector(render(0, 'F'))) falsePos++;
    }
    document.fonts.delete(face);
    let bin = '';
    const arr = Uint8Array.from(vecs);
    for (let i = 0; i < arr.length; i += 8192) bin += String.fromCharCode(...arr.subarray(i, i + 8192));
    return { data: btoa(bin), missed, falsePos };
  }, { font: fonts[k], per });
  const buf = Buffer.from(res.data, 'base64');
  fs.writeSync(out, buf);
  total += buf.length / 785;
  missed += res.missed;
  falsePos += res.falsePos;
  if (k % 20 === 0) console.log(`${k + 1}/${fonts.length} fonts, ${total} samples, missed ${missed}, empty→digit ${falsePos}`);
}
fs.closeSync(out);
console.log(`done: ${total} samples, missed ${missed}, empty→digit ${falsePos}/${fonts.length * per}`);
await browser.close();
