// Reads a Sudoku grid from a photo, entirely in the browser.
// Pipeline: grayscale → adaptive threshold → largest square-ish blob (the grid)
// → its 4 corners → perspective warp → 81 cells → per-cell digit crop → small
// neural net. Everything works on plain {width, height, data} images so the
// steps can also run outside the DOM.
import { MODEL } from './digit-model.js';

export const CELL = 48; // warped cell size in px
const WARP = CELL * 9;
const MAX_SIDE = 1000; // photos are downscaled to this before grid detection
export const VEC = 28; // classifier input is VEC×VEC

// ---------- Image basics ----------

export function toGray({ width, height, data }) {
  const g = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  }
  return g;
}

// Marks pixels noticeably darker than their neighbourhood mean as ink (1).
export function adaptiveThreshold(gray, w, h, radius, ratio = 0.85, minDiff = 8) {
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x];
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius), y1 = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(w, x + radius + 1);
      const s = sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0];
      const mean = s / ((x1 - x0) * (y1 - y0));
      const g = gray[y * w + x];
      out[y * w + x] = g < mean * ratio && mean - g >= minDiff ? 1 : 0;
    }
  }
  return out;
}

// 8-connected component labelling. Returns labels plus per-component stats.
export function components(bin, w, h) {
  const labels = new Int32Array(w * h);
  const comps = [];
  const stack = [];
  for (let start = 0; start < bin.length; start++) {
    if (!bin[start] || labels[start]) continue;
    const id = comps.length + 1;
    const c = { id, n: 0, x0: w, y0: h, x1: 0, y1: 0 };
    labels[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop();
      const x = p % w, y = (p - x) / w;
      c.n++;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (bin[q] && !labels[q]) { labels[q] = id; stack.push(q); }
        }
      }
    }
    comps.push(c);
  }
  return { labels, comps };
}

// ---------- Grid detection ----------

// Finds the grid's corners [tl, tr, br, bl] as {x, y} in image coordinates,
// or null when nothing grid-like is found.
export function findGrid(gray, w, h) {
  const bin = adaptiveThreshold(gray, w, h, Math.max(5, Math.round(Math.max(w, h) / 40)));
  const { labels, comps } = components(bin, w, h);
  const cands = comps.filter((c) => {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
    const aspect = bw / bh;
    // The grid is big, roughly square and mostly empty inside its bounding box.
    return bw >= w * 0.2 && bh >= h * 0.2 && aspect >= 0.5 && aspect <= 2 && c.n / (bw * bh) <= 0.5;
  }).sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0));

  // A page edge or a box around an article is also a big outline; the grid is
  // the one whose own pixels form the thick lines at thirds.
  let best = null, bestScore = 0;
  for (const c of cands.slice(0, 8)) {
    const quad = corners(c, labels, w);
    const area = quadArea(quad);
    if (!area) continue;
    const fit = gridness(quad, c.id, labels, w, h);
    if (fit > 0.4 && fit * area > bestScore) { best = quad; bestScore = fit * area; }
  }
  return best;
}

// Extreme points along the diagonals are the corners.
function corners(c, labels, w) {
  let tl, tr, br, bl;
  let sMin = Infinity, sMax = -Infinity, dMin = Infinity, dMax = -Infinity;
  for (let y = c.y0; y <= c.y1; y++) {
    for (let x = c.x0; x <= c.x1; x++) {
      if (labels[y * w + x] !== c.id) continue;
      const s = x + y, d = x - y;
      if (s < sMin) { sMin = s; tl = { x, y }; }
      if (s > sMax) { sMax = s; br = { x, y }; }
      if (d > dMax) { dMax = d; tr = { x, y }; }
      if (d < dMin) { dMin = d; bl = { x, y }; }
    }
  }
  return [tl, tr, br, bl];
}

// Area of a convex, roughly square quad; 0 for degenerate or twisted ones.
function quadArea(quad) {
  const sides = quad.map((p, k) => Math.hypot(quad[(k + 1) % 4].x - p.x, quad[(k + 1) % 4].y - p.y));
  if (Math.min(...sides) < Math.max(...sides) * 0.5) return 0;
  let area = 0;
  for (let k = 0; k < 4; k++) {
    const a = quad[k], b = quad[(k + 1) % 4], c = quad[(k + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross <= 0) return 0;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

// Share of points on the lines at 1/3 and 2/3 that belong to component `id`.
function gridness(quad, id, labels, w, h) {
  const at = projector(quad);
  let hits = 0, total = 0;
  for (const t of [1 / 3, 2 / 3]) {
    for (let k = 1; k < 40; k++) {
      for (const p of [at(t, k / 40), at(k / 40, t)]) {
        total++;
        const px = Math.round(p.x), py = Math.round(p.y);
        search: for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const x = px + dx, y = py + dy;
            if (x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === id) { hits++; break search; }
          }
        }
      }
    }
  }
  return hits / total;
}

// Homography mapping the unit square's corners onto `quad` ([tl, tr, br, bl]).
function homography(quad) {
  const src = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const A = [];
  for (let k = 0; k < 4; k++) {
    const [u, v] = src[k];
    const { x, y } = quad[k];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
  }
  // Gauss-Jordan elimination with partial pivoting.
  for (let col = 0; col < 8; col++) {
    let piv = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let k = col; k < 9; k++) A[r][k] -= f * A[col][k];
    }
  }
  const hm = A.map((row, i) => row[8] / row[i]);
  hm.push(1);
  return hm;
}

// Maps grid coordinates (0..1, 0..1) to image coordinates inside `quad`.
export function projector(quad) {
  const [a, b, c, d, e, f, g, h] = homography(quad);
  return (u, v) => {
    const z = g * u + h * v + 1;
    return { x: (a * u + b * v + c) / z, y: (d * u + e * v + f) / z };
  };
}

// Perspective-corrects the grid into a WARP×WARP grayscale image.
export function warp(gray, w, h, quad, size = WARP) {
  const [a, b, c, d, e, f, g, hh] = homography(quad);
  const out = new Uint8ClampedArray(size * size);
  for (let j = 0; j < size; j++) {
    const v = (j + 0.5) / size;
    for (let i = 0; i < size; i++) {
      const u = (i + 0.5) / size;
      const z = g * u + hh * v + 1;
      const x = (a * u + b * v + c) / z - 0.5;
      const y = (d * u + e * v + f) / z - 0.5;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) { out[j * size + i] = 255; continue; }
      const fx = x - x0, fy = y - y0;
      const p = y0 * w + x0;
      out[j * size + i] =
        gray[p] * (1 - fx) * (1 - fy) + gray[p + 1] * fx * (1 - fy) +
        gray[p + w] * (1 - fx) * fy + gray[p + w + 1] * fx * fy;
    }
  }
  return out;
}

// ---------- Cells ----------

// Turns one CELL×CELL grayscale cell into the classifier's input vector, or
// null when the cell holds no digit.
export function cellVector(cell) {
  const n = CELL;
  const bin = adaptiveThreshold(cell, n, n, 8);
  // Drop a border band where grid lines live.
  const band = Math.round(n * 0.08);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (x < band || y < band || x >= n - band || y >= n - band) bin[y * n + x] = 0;
    }
  }
  const { labels, comps } = components(bin, n, n);
  const lo = band, hi = n - band - 1;
  // Pieces touching the band are grid lines or neighbouring digits, unless
  // they sit in the middle (a large digit) and aren't line-shaped.
  const central = (c, a) => {
    const cx = (c.x0 + c.x1) / 2 / n, cy = (c.y0 + c.y1) / 2 / n;
    return cx > a && cx < 1 - a && cy > a && cy < 1 - a;
  };
  const inner = comps.filter((c) => {
    if (c.n < 3) return false;
    if (c.x0 > lo && c.y0 > lo && c.x1 < hi && c.y1 < hi) return true;
    const long = Math.max(c.x1 - c.x0, c.y1 - c.y0) + 1 > n * 0.8;
    return !long && central(c, 0.3);
  });
  let digit = null;
  for (const c of inner) {
    if (c.n < 15 || !central(c, 0.25)) continue;
    if (!digit || c.n > digit.n) digit = c;
  }
  if (!digit) return null;

  // Grow the box with nearby pieces, so strokes broken by blur or noise
  // end up in one digit.
  let { x0, y0, x1, y1 } = digit;
  const keep = new Set([digit.id]);
  const pad = Math.round(n * 0.1);
  for (let grew = true; grew;) {
    grew = false;
    for (const c of inner) {
      if (keep.has(c.id)) continue;
      if (c.x1 < x0 - pad || c.x0 > x1 + pad || c.y1 < y0 - pad || c.y0 > y1 + pad) continue;
      keep.add(c.id);
      x0 = Math.min(x0, c.x0); y0 = Math.min(y0, c.y0);
      x1 = Math.max(x1, c.x1); y1 = Math.max(y1, c.y1);
      grew = true;
    }
  }
  if (y1 - y0 + 1 < n * 0.2) return null;
  const mask = (x, y) => (keep.has(labels[y * n + x]) ? 1 : 0);
  return normalize(mask, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

// Scales the box (x0, y0, bw, bh) to fit 20×20, centred in VEC×VEC, by
// supersampled area averaging.
function normalize(mask, x0, y0, bw, bh) {
  const vec = new Float32Array(VEC * VEC);
  const scale = 20 / Math.max(bw, bh);
  const tw = bw * scale, th = bh * scale;
  const ox = (VEC - tw) / 2, oy = (VEC - th) / 2;
  const S = 4;
  for (let ty = 0; ty < VEC; ty++) {
    for (let tx = 0; tx < VEC; tx++) {
      let acc = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const fx = (tx + (sx + 0.5) / S - ox) / scale;
          const fy = (ty + (sy + 0.5) / S - oy) / scale;
          if (fx < 0 || fy < 0 || fx >= bw || fy >= bh) continue;
          acc += mask(x0 + Math.floor(fx), y0 + Math.floor(fy));
        }
      }
      vec[ty * VEC + tx] = acc / (S * S);
    }
  }
  return vec;
}

// ---------- Classifier ----------

let net = null;

function decode(b64) {
  const bin = atob(b64);
  const out = new Int8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) << 24 >> 24;
  return out;
}

function loadNet() {
  if (net) return net;
  net = MODEL.layers.map((l) => {
    const q = decode(l.w);
    const w = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) w[i] = q[i] * l.scale;
    return { w, b: Float32Array.from(l.b), inp: l.in, out: l.out };
  });
  return net;
}

// Returns { digit: 1..9, confidence: 0..1 } for an input vector.
export function classify(vec) {
  let x = vec;
  const layers = loadNet();
  layers.forEach((l, k) => {
    const y = new Float32Array(l.out);
    for (let o = 0; o < l.out; o++) {
      let s = l.b[o];
      const row = o * l.inp;
      for (let i = 0; i < l.inp; i++) s += l.w[row + i] * x[i];
      y[o] = k < layers.length - 1 ? Math.max(0, s) : s;
    }
    x = y;
  });
  let best = 0;
  for (let i = 1; i < x.length; i++) if (x[i] > x[best]) best = i;
  let total = 0;
  for (let i = 0; i < x.length; i++) total += Math.exp(x[i] - x[best]);
  return { digit: best + 1, confidence: 1 / total };
}

// ---------- Whole photo ----------

// Reads the grid inside `quad` of a grayscale image. Returns 81 digits (0 =
// empty) and per-cell confidences.
export function readGrid(gray, w, h, quad) {
  const warped = warp(gray, w, h, quad);
  const grid = new Array(81).fill(0);
  const confidence = new Array(81).fill(1);
  const cell = new Uint8ClampedArray(CELL * CELL);
  for (let i = 0; i < 81; i++) {
    const cx = (i % 9) * CELL, cy = Math.floor(i / 9) * CELL;
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) cell[y * CELL + x] = warped[(cy + y) * WARP + cx + x];
    }
    const vec = cellVector(cell);
    if (!vec) continue;
    const r = classify(vec);
    grid[i] = r.digit;
    confidence[i] = r.confidence;
  }
  return { grid, confidence };
}

// Downscales an image source (img, canvas, bitmap) and returns its grayscale
// pixels for scanning, plus the downscaled canvas for display.
export function grayFromSource(source) {
  const sw = source.naturalWidth || source.width, sh = source.naturalHeight || source.height;
  const k = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const w = Math.round(sw * k), h = Math.round(sh * k);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  return { gray: toGray(ctx.getImageData(0, 0, w, h)), w, h, canvas };
}

// Full scan of a grayscale image. Falls back to the whole image when no grid
// outline is found, so the user can still drag the corners into place.
export function scan(gray, w, h) {
  const found = findGrid(gray, w, h);
  const m = Math.round(Math.min(w, h) * 0.05);
  const quad = found ?? [{ x: m, y: m }, { x: w - m, y: m }, { x: w - m, y: h - m }, { x: m, y: h - m }];
  return { quad, found: !!found, ...readGrid(gray, w, h, quad) };
}
