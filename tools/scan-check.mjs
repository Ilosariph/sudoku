// End-to-end check of the photo scanner: renders newspaper-style sudokus in
// system fonts (not used for training), photographs them at an angle with
// blur and shading, feeds each photo to the app's scan screen and compares the
// recognized grid with the real one.
// Usage: npm start (serves on :8000), then node tools/scan-check.mjs [count]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { generate, mulberry32 } from '../public/js/sudoku.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const count = Number(process.argv[2] ?? 8);
const app = process.env.APP_URL ?? 'http://localhost:8000/';
const fonts = ['Liberation Serif', 'Liberation Sans', 'DejaVu Sans', 'DejaVu Serif', 'FreeSans', 'FreeSerif', 'Bitstream Charter', 'Carlito', 'Caladea', 'Inter'];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-check-'));

const browser = await chromium.launch();
const shooter = await browser.newPage({ viewport: { width: 900, height: 1100 } });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
await page.goto(app);
await page.click('#scan-btn');

let cells = 0, wrongCells = 0, perfect = 0;
for (let n = 0; n < count; n++) {
  const rng = mulberry32(1000 + n);
  const r = (a, b) => a + rng() * (b - a);
  const { puzzle } = generate(['easy', 'medium', 'hard'][n % 3], rng, 300);
  const font = fonts[n % fonts.length];
  const rows = [...Array(9)].map((_, y) => `<tr>${[...Array(9)].map((_, x) => `<td>${puzzle[y * 9 + x] || ''}</td>`).join('')}</tr>`).join('');
  const filler = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit 1984, sed do eiusmod tempor. '.repeat(6);
  await shooter.setContent(`<!doctype html><style>
    body { margin: 0; background: #555; overflow: hidden; }
    .paper { width: 760px; margin: 60px auto; padding: 30px; background: #ece6d6; font-family: '${font}';
      transform: perspective(1000px) rotateX(${r(-14, 14)}deg) rotateY(${r(-14, 14)}deg) rotateZ(${r(-8, 8)}deg);
      filter: blur(${r(0, 1.1)}px) contrast(${r(0.7, 1)}); }
    p { font-size: 13px; color: #333; margin: 0 0 12px; column-count: 2; }
    table { border-collapse: collapse; border: 3px solid #222; margin: 0 auto; }
    td { width: ${r(52, 66)}px; height: ${r(52, 66)}px; border: 1px solid #444; text-align: center;
      font-size: ${r(28, 40)}px; font-weight: ${rng() < 0.5 ? 700 : 400}; color: #1a1a1a; padding: 0; }
    tr:nth-child(3n) td { border-bottom: 3px solid #222; }
    td:nth-child(3n) { border-right: 3px solid #222; }
    .shade { position: fixed; inset: 0; background: linear-gradient(${r(0, 360)}deg, rgba(0,0,0,${r(0, 0.35)}), transparent 70%); }
  </style><div class="paper"><p>${filler}</p><table>${rows}</table><p>${filler}</p></div><div class="shade"></div>`);
  const file = path.join(dir, `photo-${n}.jpg`);
  await shooter.screenshot({ path: file, type: 'jpeg', quality: 70 });

  await page.$eval('#scan-status', (el) => { el.textContent = 'wait'; });
  await page.setInputFiles('#scan-file', file);
  await page.waitForFunction(() => !/^wait$|Reading|Checking/.test(document.querySelector('#scan-status').textContent));
  const read = await page.$$eval('#scan-board .cell', (els) => els.map((e) => Number(e.textContent) || 0));
  const bad = read.flatMap((v, i) => (v !== puzzle[i] ? [`r${Math.floor(i / 9) + 1}c${i % 9 + 1}: ${puzzle[i] || '·'}→${v || '·'}`] : []));
  cells += 81;
  wrongCells += bad.length;
  if (!bad.length) perfect++;
  console.log(`#${n} ${font}: ${bad.length ? `${bad.length} wrong (${bad.join(', ')})` : 'perfect'}`);
}
console.log(`\n${perfect}/${count} photos perfect, ${cells - wrongCells}/${cells} cells right. Photos in ${dir}`);
await browser.close();
