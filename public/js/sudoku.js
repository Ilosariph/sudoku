// Pure Sudoku logic: solving, uniqueness checks and puzzle generation.
// Grids are flat arrays of 81 numbers, 0 = empty.

export const DIFFICULTIES = {
  easy: { label: 'Easy', clues: 40, singlesOnly: true },
  medium: { label: 'Medium', clues: 32, singlesOnly: true },
  hard: { label: 'Hard', clues: 27, singlesOnly: false, needsAdvanced: true },
  expert: { label: 'Expert', clues: 23, singlesOnly: false, needsAdvanced: true },
};

const ALL = 0x3fe; // bits 1..9

export const rowOf = (i) => Math.floor(i / 9);
export const colOf = (i) => i % 9;
export const boxOf = (i) => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);

export const UNITS = (() => {
  const rows = [], cols = [], boxes = [];
  for (let u = 0; u < 9; u++) {
    rows.push([]); cols.push([]); boxes.push([]);
  }
  for (let i = 0; i < 81; i++) {
    rows[rowOf(i)].push(i);
    cols[colOf(i)].push(i);
    boxes[boxOf(i)].push(i);
  }
  return { rows, cols, boxes };
})();

export const PEERS = Array.from({ length: 81 }, (_, i) => {
  const set = new Set([
    ...UNITS.rows[rowOf(i)],
    ...UNITS.cols[colOf(i)],
    ...UNITS.boxes[boxOf(i)],
  ]);
  set.delete(i);
  return [...set];
});

function popcount(m) {
  let c = 0;
  while (m) { m &= m - 1; c++; }
  return c;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Builds row/col/box usage masks. Returns null if the grid contains a conflict.
function masks(grid) {
  const r = new Array(9).fill(0), c = new Array(9).fill(0), b = new Array(9).fill(0);
  for (let i = 0; i < 81; i++) {
    const v = grid[i];
    if (!v) continue;
    const bit = 1 << v;
    const ri = rowOf(i), ci = colOf(i), bi = boxOf(i);
    if ((r[ri] | c[ci] | b[bi]) & bit) return null;
    r[ri] |= bit; c[ci] |= bit; b[bi] |= bit;
  }
  return { r, c, b };
}

// Backtracking search with minimum-remaining-values heuristic.
// Counts solutions up to `limit`; optionally randomizes candidate order and
// records the first solution found.
function search(grid, limit, rng) {
  const m = masks(grid);
  if (!m) return { count: 0, solution: null };
  const g = grid.slice();
  let count = 0;
  let solution = null;

  const recurse = () => {
    let best = -1, bestCand = 0, bestN = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const cand = ALL & ~(m.r[rowOf(i)] | m.c[colOf(i)] | m.b[boxOf(i)]);
      const n = popcount(cand);
      if (n === 0) return false;
      if (n < bestN) { best = i; bestCand = cand; bestN = n; if (n === 1) break; }
    }
    if (best === -1) {
      count++;
      if (!solution) solution = g.slice();
      return count >= limit;
    }
    const digits = [];
    for (let v = 1; v <= 9; v++) if (bestCand & (1 << v)) digits.push(v);
    if (rng) shuffle(digits, rng);
    const ri = rowOf(best), ci = colOf(best), bi = boxOf(best);
    for (const v of digits) {
      const bit = 1 << v;
      g[best] = v;
      m.r[ri] |= bit; m.c[ci] |= bit; m.b[bi] |= bit;
      const stop = recurse();
      m.r[ri] &= ~bit; m.c[ci] &= ~bit; m.b[bi] &= ~bit;
      g[best] = 0;
      if (stop) return true;
    }
    return false;
  };

  recurse();
  return { count, solution };
}

export function solve(grid) {
  return search(grid, 1).solution;
}

export function countSolutions(grid, limit = 2) {
  return search(grid, limit).count;
}

// Tries to solve using only naked and hidden singles (human-friendly logic).
export function solvableWithSingles(grid) {
  const g = grid.slice();
  const m = masks(g);
  if (!m) return false;
  const place = (i, v) => {
    const bit = 1 << v;
    g[i] = v;
    m.r[rowOf(i)] |= bit; m.c[colOf(i)] |= bit; m.b[boxOf(i)] |= bit;
  };
  const cand = (i) => ALL & ~(m.r[rowOf(i)] | m.c[colOf(i)] | m.b[boxOf(i)]);
  const allUnits = [...UNITS.rows, ...UNITS.cols, ...UNITS.boxes];

  let progress = true;
  while (progress) {
    progress = false;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const c = cand(i);
      if (c === 0) return false;
      if (popcount(c) === 1) { place(i, 31 - Math.clz32(c)); progress = true; }
    }
    for (const unit of allUnits) {
      for (let v = 1; v <= 9; v++) {
        const bit = 1 << v;
        let spot = -1, n = 0;
        for (const i of unit) {
          if (g[i] === v) { n = -1; break; }
          if (!g[i] && cand(i) & bit) { spot = i; n++; }
        }
        if (n === 1) { place(spot, v); progress = true; }
      }
    }
  }
  return g.every((v) => v !== 0);
}

// Small seedable PRNG so puzzles can be reproduced in tests.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function carve(solution, cfg, rng) {
  const puzzle = solution.slice();
  let clues = 81;
  for (const i of shuffle([...Array(81).keys()], rng)) {
    if (clues <= cfg.clues) break;
    const keep = puzzle[i];
    puzzle[i] = 0;
    const ok = countSolutions(puzzle, 2) === 1 && (!cfg.singlesOnly || solvableWithSingles(puzzle));
    if (ok) clues--;
    else puzzle[i] = keep;
  }
  return { puzzle, clues };
}

// Generates a puzzle with a unique solution. Retries a few times (bounded by
// a time budget) to get as close as possible to the difficulty's clue target
// and, for harder levels, to require more than singles to solve.
export function generate(difficulty = 'medium', rng = Math.random, budgetMs = 1500) {
  const cfg = DIFFICULTIES[difficulty] ?? DIFFICULTIES.medium;
  const start = Date.now();
  const score = (c) => c.clues - (c.advanced ? 100 : 0);
  let best = null;
  do {
    const solution = search(new Array(81).fill(0), 1, rng).solution;
    const { puzzle, clues } = carve(solution, cfg, rng);
    const advanced = !cfg.needsAdvanced || !solvableWithSingles(puzzle);
    const cand = { puzzle, solution, clues, advanced };
    if (!best || score(cand) < score(best)) best = cand;
    if (best.clues <= cfg.clues && best.advanced) break;
  } while (Date.now() - start < budgetMs);
  return { puzzle: best.puzzle, solution: best.solution, difficulty };
}
