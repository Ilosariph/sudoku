// Checks a scanned grid off the main thread: an unsolvable grid with few
// clues can take the backtracking solver a while.
import { countSolutions, solve } from './sudoku.js';

self.onmessage = ({ data: grid }) => {
  const count = countSolutions(grid, 2);
  self.postMessage({ count, solution: count === 1 ? solve(grid) : null });
};
