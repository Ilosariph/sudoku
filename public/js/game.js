// Game state model. Knows nothing about the DOM; the UI subscribes to changes.
import { generate, PEERS, UNITS, rowOf, colOf, boxOf } from './sudoku.js';

export const MAX_LIVES = 3;
const SAVE_KEY = 'sudoku.save.v1';
const BEST_KEY = 'sudoku.best.v1';

export class Game {
  constructor() {
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); }
  emit(event = {}) {
    this.save();
    for (const fn of this.listeners) fn(event);
  }

  newGame(mode, difficulty) {
    const { puzzle, solution } = generate(difficulty);
    this.load({
      mode,
      difficulty,
      puzzle,
      solution,
      values: puzzle.slice(),
      notes: new Array(81).fill(0),
      lives: MAX_LIVES,
      mistakes: 0,
      hints: 0,
      elapsed: 0,
      status: 'playing',
      history: [],
      shownMistakes: [],
    });
  }

  restart() {
    this.load({
      ...this.state,
      values: this.state.puzzle.slice(),
      notes: new Array(81).fill(0),
      lives: MAX_LIVES,
      mistakes: 0,
      hints: 0,
      elapsed: 0,
      status: 'playing',
      history: [],
      shownMistakes: [],
    });
  }

  load(state) {
    this.state = state;
    this.emit({ type: 'new' });
  }

  get s() { return this.state; }
  isGiven(i) { return this.s.puzzle[i] !== 0; }
  isCorrect(i) { return this.s.values[i] === this.s.solution[i]; }
  isPlaying() { return this.s.status === 'playing'; }

  // In lives mode correct entries are locked, as they are known to be right.
  isLocked(i) {
    return this.isGiven(i) || (this.s.mode === 'lives' && this.s.values[i] !== 0 && this.isCorrect(i));
  }

  // How many times a digit has been placed. Lives mode only counts correct
  // placements; normal mode counts any placement so it leaks no correctness info.
  digitCount(v) {
    let n = 0;
    for (let i = 0; i < 81; i++) {
      if (this.s.values[i] !== v) continue;
      if (this.s.mode === 'normal' || this.isCorrect(i)) n++;
    }
    return n;
  }

  snapshot() {
    this.s.history.push({ values: this.s.values.slice(), notes: this.s.notes.slice() });
    if (this.s.history.length > 200) this.s.history.shift();
  }

  undo() {
    if (!this.isPlaying()) return;
    const prev = this.s.history.pop();
    if (!prev) return;
    this.s.values = prev.values;
    this.s.notes = prev.notes;
    this.s.shownMistakes = [];
    this.emit({ type: 'undo' });
  }

  // Places digit `v` in cell `i`. Returns an event describing what happened.
  setValue(i, v) {
    if (!this.isPlaying() || this.isLocked(i)) return;
    const s = this.s;
    if (s.mode === 'lives' && this.digitCount(v) >= 9) return;

    this.snapshot();
    // Tapping the same digit again in normal mode clears the cell.
    if (s.mode === 'normal' && s.values[i] === v) {
      s.values[i] = 0;
      this.clearShownMistake(i);
      this.emit({ type: 'erase', cell: i });
      return;
    }

    s.values[i] = v;
    s.notes[i] = 0;
    this.clearShownMistake(i);
    const correct = v === s.solution[i];

    if (s.mode === 'lives' && !correct) {
      s.lives--;
      s.mistakes++;
      if (s.lives <= 0) s.status = 'lost';
      this.emit({ type: 'wrong', cell: i });
      return;
    }

    // Remove the digit from notes of all peers.
    for (const p of PEERS[i]) s.notes[p] &= ~(1 << v);

    const completed = s.mode === 'lives' ? this.completedUnits(i) : [];
    if (this.isSolved()) this.win();
    this.emit({ type: 'place', cell: i, completed });
  }

  toggleNote(i, v) {
    if (!this.isPlaying() || this.isLocked(i) || this.s.values[i]) return;
    this.snapshot();
    this.s.notes[i] ^= 1 << v;
    this.emit({ type: 'note', cell: i });
  }

  erase(i) {
    if (!this.isPlaying() || this.isLocked(i)) return;
    if (!this.s.values[i] && !this.s.notes[i]) return;
    this.snapshot();
    this.s.values[i] = 0;
    this.s.notes[i] = 0;
    this.clearShownMistake(i);
    this.emit({ type: 'erase', cell: i });
  }

  // Fills the given cell (or a random empty/wrong one) with the correct digit.
  hint(i) {
    if (!this.isPlaying()) return null;
    const s = this.s;
    const open = (k) => !this.isGiven(k) && !this.isCorrect(k);
    if (i == null || !open(i)) {
      const cands = [...Array(81).keys()].filter(open);
      if (!cands.length) return null;
      i = cands[Math.floor(Math.random() * cands.length)];
    }
    this.snapshot();
    const v = s.solution[i];
    s.values[i] = v;
    s.notes[i] = 0;
    s.hints++;
    this.clearShownMistake(i);
    for (const p of PEERS[i]) s.notes[p] &= ~(1 << v);
    const completed = s.mode === 'lives' ? this.completedUnits(i) : [];
    if (this.isSolved()) this.win();
    this.emit({ type: 'hint', cell: i, completed });
    return i;
  }

  // Units (row/col/box) containing cell `i` that are now fully and correctly filled.
  completedUnits(i) {
    const units = [UNITS.rows[rowOf(i)], UNITS.cols[colOf(i)], UNITS.boxes[boxOf(i)]];
    return units.filter((u) => u.every((k) => this.s.values[k] && this.isCorrect(k)));
  }

  isSolved() {
    return this.s.values.every((v, i) => v === this.s.solution[i]);
  }

  // Normal mode "Check": are all filled cells correct?
  check() {
    const s = this.s;
    const wrong = this.wrongCells();
    const filled = s.values.filter(Boolean).length;
    return { allCorrect: wrong.length === 0, complete: filled === 81 };
  }

  wrongCells() {
    const out = [];
    for (let i = 0; i < 81; i++) {
      if (this.s.values[i] && !this.isCorrect(i)) out.push(i);
    }
    return out;
  }

  toggleShowMistakes() {
    this.s.shownMistakes = this.s.shownMistakes.length ? [] : this.wrongCells();
    this.emit({ type: 'mistakes' });
    return this.s.shownMistakes.length;
  }

  clearShownMistake(i) {
    this.s.shownMistakes = this.s.shownMistakes.filter((k) => k !== i);
  }

  tick(ms) {
    if (!this.isPlaying()) return;
    this.s.elapsed += ms;
    this.save();
  }

  win() {
    const s = this.s;
    s.status = 'won';
    s.history = [];
    const key = `${s.mode}.${s.difficulty}`;
    const best = readJSON(BEST_KEY, {});
    s.newBest = !best[key] || s.elapsed < best[key];
    if (s.newBest) {
      best[key] = s.elapsed;
      writeJSON(BEST_KEY, best);
    }
  }

  bestTimes() { return readJSON(BEST_KEY, {}); }

  save() {
    if (this.state) writeJSON(SAVE_KEY, this.state);
  }

  restore() {
    const st = readJSON(SAVE_KEY, null);
    if (!st || !Array.isArray(st.values) || st.values.length !== 81) return false;
    this.load(st);
    return true;
  }
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: game still works, just not persisted */
  }
}
