import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../public/js/game.js';
import { generate, solve, mulberry32 } from '../public/js/sudoku.js';
import { projector, findGrid, warp } from '../public/js/scan.js';

test('projector maps the unit square onto the quad', () => {
  const quad = [{ x: 10, y: 20 }, { x: 200, y: 5 }, { x: 230, y: 260 }, { x: 0, y: 240 }];
  const at = projector(quad);
  [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], k) => {
    const p = at(u, v);
    assert.ok(Math.abs(p.x - quad[k].x) < 1e-6 && Math.abs(p.y - quad[k].y) < 1e-6);
  });
});

test('findGrid locates a drawn grid and warp straightens it', () => {
  const w = 300, h = 260;
  const gray = new Uint8ClampedArray(w * h).fill(230);
  // Axis-aligned 9×9 grid from (40, 20) with 20px cells.
  for (let k = 0; k <= 9; k++) {
    const t = k % 3 ? 1 : 3;
    for (let a = 0; a <= 180; a++) {
      for (let d = 0; d < t; d++) {
        gray[(20 + a) * w + 40 + k * 20 + d] = 20;
        gray[(20 + k * 20 + d) * w + 40 + a] = 20;
      }
    }
  }
  const quad = findGrid(gray, w, h);
  [[40, 20], [222, 20], [222, 202], [40, 202]].forEach(([x, y], k) => {
    assert.ok(Math.hypot(quad[k].x - x, quad[k].y - y) <= 3, `corner ${k}`);
  });
  const out = warp(gray, w, h, quad, 90);
  assert.ok(out[45 * 90 + 45] > 200, 'cell centre is paper');
  assert.ok(out[45] < 100, 'top edge is a line');
});

test('custom puzzle with a unique solution plays like a generated one', () => {
  const { puzzle, solution } = generate('easy', mulberry32(3), 200);
  const game = new Game();
  game.newCustom('lives', puzzle, solve(puzzle));
  assert.deepEqual(game.s.solution, solution);
  assert.equal(game.s.difficulty, 'scanned');
  assert.ok(game.canHint());
});

test('custom puzzle without a solution is checked against the rules', () => {
  const { puzzle, solution } = generate('easy', mulberry32(4), 200);
  const game = new Game();
  game.newCustom('normal', puzzle, null);
  assert.equal(game.canHint(), false);
  assert.equal(game.hint(), null);
  const empty = puzzle.indexOf(0);
  const peer = puzzle.findIndex((v, i) => v && Math.floor(i / 9) === Math.floor(empty / 9));
  game.setValue(empty, puzzle[peer]);
  assert.deepEqual(game.wrongCells(), [empty]);
  game.setValue(empty, solution[empty]);
  assert.deepEqual(game.wrongCells(), []);
  for (let i = 0; i < 81; i++) if (!game.s.values[i]) game.setValue(i, solution[i]);
  assert.equal(game.s.status, 'won');
});
