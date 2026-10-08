import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIFFICULTIES, UNITS, countSolutions, generate, mulberry32, solvableWithSingles, solve,
} from '../public/js/sudoku.js';

const isValidSolution = (g) =>
  [...UNITS.rows, ...UNITS.cols, ...UNITS.boxes].every(
    (u) => new Set(u.map((i) => g[i])).size === 9 && u.every((i) => g[i] >= 1 && g[i] <= 9),
  );

for (const difficulty of Object.keys(DIFFICULTIES)) {
  test(`${difficulty}: puzzles are valid and uniquely solvable`, () => {
    const rng = mulberry32(42);
    for (let n = 0; n < 5; n++) {
      const { puzzle, solution } = generate(difficulty, rng);
      assert.ok(isValidSolution(solution));
      puzzle.forEach((v, i) => v && assert.equal(v, solution[i]));
      assert.equal(countSolutions(puzzle, 2), 1);
      assert.deepEqual(solve(puzzle), solution);
      const clues = puzzle.filter(Boolean).length;
      assert.ok(clues <= DIFFICULTIES[difficulty].clues + 4, `too many clues: ${clues}`);
      if (DIFFICULTIES[difficulty].singlesOnly) assert.ok(solvableWithSingles(puzzle));
    }
  });
}

test('countSolutions detects multiple solutions and conflicts', () => {
  assert.equal(countSolutions(new Array(81).fill(0), 2), 2);
  const conflict = new Array(81).fill(0);
  conflict[0] = 5; conflict[1] = 5;
  assert.equal(countSolutions(conflict, 2), 0);
});
