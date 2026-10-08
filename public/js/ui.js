// DOM rendering and input handling. Input is pointer/touch only: cells are
// selected by tapping, digits are entered via the number row.
import { DIFFICULTIES, PEERS, rowOf, colOf } from './sudoku.js';
import { MAX_LIVES } from './game.js';

const $ = (sel) => document.querySelector(sel);
const THEME_KEY = 'sudoku.theme';
const ICON_PAUSE = '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="1" width="3" height="10" rx="1"/><rect x="7" y="1" width="3" height="10" rx="1"/></svg>';
const ICON_PLAY = '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M3 1.5v9a.5.5 0 0 0 .77.42l7-4.5a.5.5 0 0 0 0-.84l-7-4.5A.5.5 0 0 0 3 1.5z"/></svg>';

export class UI {
  constructor(game) {
    this.game = game;
    this.selected = null;
    this.notesMode = false;
    this.paused = false;
    this.cells = [];
    this.numButtons = [];

    this.app = $('.app');
    this.board = $('#board');
    this.numpad = $('#numpad');

    this.buildBoard();
    this.buildNumpad();
    this.bindControls();
    this.applyTheme(readStorage(THEME_KEY));
    this.startTimer();

    game.onChange((e) => this.handleEvent(e));
  }

  // ---------- Construction ----------

  buildBoard() {
    for (let i = 0; i < 81; i++) {
      const cell = document.createElement('div');
      cell.className = `cell r${rowOf(i)} c${colOf(i)}`;
      cell.setAttribute('role', 'gridcell');
      cell.dataset.index = i;
      const value = document.createElement('span');
      value.className = 'value';
      const notes = document.createElement('div');
      notes.className = 'notes';
      // Note positions: 1 top-left, 5 center, 9 bottom-right.
      for (let v = 1; v <= 9; v++) notes.appendChild(document.createElement('span'));
      cell.append(value, notes);
      cell.addEventListener('animationend', (e) => {
        cell.classList.remove(e.animationName);
        if (e.animationName === 'flash') cell.style.removeProperty('--delay');
      });
      this.board.appendChild(cell);
      this.cells.push(cell);
    }
    this.board.addEventListener('click', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell || this.paused) return;
      const i = Number(cell.dataset.index);
      this.selected = i;
      this.render();
    });
  }

  buildNumpad() {
    for (let v = 1; v <= 9; v++) {
      const btn = document.createElement('button');
      btn.className = 'num';
      btn.dataset.value = v;
      btn.innerHTML = `<span class="digit">${v}</span><span class="left"></span>`;
      btn.addEventListener('click', () => this.input(v));
      this.numpad.appendChild(btn);
      this.numButtons.push(btn);
    }
  }

  bindControls() {
    document.querySelectorAll('.segmented button').forEach((btn) => {
      btn.addEventListener('click', () => this.changeSetup(btn.dataset.mode, this.game.s.difficulty));
    });
    $('#difficulty').addEventListener('change', (e) => {
      this.changeSetup(this.game.s.mode, e.target.value);
    });
    $('#new-btn').addEventListener('click', () => this.changeSetup(this.game.s.mode, $('#difficulty').value, true));

    $('#undo-btn').addEventListener('click', () => this.game.undo());
    $('#erase-btn').addEventListener('click', () => {
      if (this.selected != null) this.game.erase(this.selected);
    });
    $('#notes-btn').addEventListener('click', () => {
      this.notesMode = !this.notesMode;
      this.render();
    });
    $('#hint-btn').addEventListener('click', () => {
      const i = this.game.hint(this.selected);
      if (i != null) this.selected = i;
      this.render();
    });
    $('#check-btn').addEventListener('click', () => this.check());
    $('#mistakes-btn').addEventListener('click', () => {
      const wasOn = this.game.s.shownMistakes.length > 0;
      const n = this.game.toggleShowMistakes();
      if (!wasOn) this.toast(n ? `${n} mistake${n > 1 ? 's' : ''} found` : 'No mistakes 👍', n ? 'bad' : 'good');
    });

    $('#pause-btn').addEventListener('click', () => this.setPaused(!this.paused));
    $('#resume-btn').addEventListener('click', () => this.setPaused(false));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.game.isPlaying()) this.setPaused(true);
    });

    $('#theme-btn').addEventListener('click', () => {
      const dark = document.documentElement.dataset.theme
        ? document.documentElement.dataset.theme === 'dark'
        : matchMedia('(prefers-color-scheme: dark)').matches;
      const next = dark ? 'light' : 'dark';
      writeStorage(THEME_KEY, next);
      this.applyTheme(next);
    });
    $('#stats-btn').addEventListener('click', () => this.showStats());
  }

  applyTheme(theme) {
    if (theme) document.documentElement.dataset.theme = theme;
  }

  // ---------- Actions ----------

  async changeSetup(mode, difficulty, force = false) {
    const s = this.game.s;
    if (!force && mode === s.mode && difficulty === s.difficulty) return;
    const inProgress = s.status === 'playing' && s.values.some((v, i) => v && !s.puzzle[i]);
    if (inProgress) {
      const ok = await this.dialog({
        title: 'Start a new game?',
        body: '<p>Your current progress will be lost.</p>',
        buttons: [{ label: 'Cancel', value: 'no' }, { label: 'New game', value: 'yes', primary: true }],
      });
      if (ok !== 'yes') { this.render(); return; }
    }
    this.game.newGame(mode, difficulty);
  }

  input(v) {
    if (this.selected == null || this.paused) {
      if (this.selected == null) this.toast('Select a cell first');
      return;
    }
    if (this.notesMode) this.game.toggleNote(this.selected, v);
    else this.game.setValue(this.selected, v);
  }

  check() {
    const { allCorrect, complete } = this.game.check();
    if (allCorrect && complete) this.toast('Solved! 🎉', 'good');
    else if (allCorrect) this.toast('All correct so far ✓', 'good');
    else this.toast('Not all correct ✗', 'bad');
  }

  setPaused(paused) {
    if (paused && !this.game.isPlaying()) return;
    this.paused = paused;
    this.render();
  }

  startTimer() {
    let last = performance.now();
    setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      if (!this.paused && !document.hidden && this.game.isPlaying()) {
        this.game.tick(dt);
        this.renderTimer();
      }
    }, 250);
  }

  // ---------- Game events ----------

  handleEvent(e) {
    const s = this.game.s;
    if (e.type === 'new') {
      this.selected = null;
      this.paused = false;
      this.notesMode = false;
    }
    this.render();

    const cell = this.cells[e.cell];
    if (e.type === 'wrong') {
      restartAnimation(cell, 'shake');
      const hearts = document.querySelectorAll('#lives span');
      const lostHeart = hearts[s.lives];
      if (lostHeart) restartAnimation(lostHeart, 'pop');
      if (s.status === 'lost') setTimeout(() => this.gameOver(), 450);
    }
    if (e.type === 'place' || e.type === 'hint') {
      restartAnimation(cell, 'popin');
      for (const unit of e.completed ?? []) this.flash(unit);
      if (s.status === 'won') setTimeout(() => this.victory(), 300);
    }
  }

  flash(indices, delayFn = (_, k) => k * 45) {
    indices.forEach((i, k) => {
      const c = this.cells[i];
      c.style.setProperty('--delay', `${delayFn(i, k)}ms`);
      restartAnimation(c, 'flash');
    });
  }

  async victory() {
    const s = this.game.s;
    this.selected = null;
    this.render();
    this.flash([...Array(81).keys()], (i) => (rowOf(i) + colOf(i)) * 40);
    await wait(900);
    const res = await this.dialog({
      title: 'You solved it! 🎉',
      body: `
        <p>${DIFFICULTIES[s.difficulty].label} · ${s.mode === 'lives' ? 'Lives' : 'Normal'} mode</p>
        <table class="stats">
          <tr><th>Time</th><td>${formatTime(s.elapsed)}${s.newBest ? ' 🏆 new best!' : ''}</td></tr>
          ${s.mode === 'lives' ? `<tr><th>Mistakes</th><td>${s.mistakes}</td></tr>` : ''}
          <tr><th>Hints</th><td>${s.hints}</td></tr>
        </table>`,
      buttons: [{ label: 'Close', value: 'close' }, { label: 'New game', value: 'new', primary: true }],
    });
    if (res === 'new') this.game.newGame(s.mode, s.difficulty);
  }

  async gameOver() {
    const s = this.game.s;
    const res = await this.dialog({
      title: 'Game over 💔',
      body: `<p>You ran out of lives after ${formatTime(s.elapsed)}.</p>`,
      buttons: [{ label: 'Retry puzzle', value: 'retry' }, { label: 'New game', value: 'new', primary: true }],
    });
    if (res === 'retry') this.game.restart();
    else if (res === 'new') this.game.newGame(s.mode, s.difficulty);
  }

  async showStats() {
    const best = this.game.bestTimes();
    const rows = Object.entries(DIFFICULTIES).map(([key, d]) => `
      <tr><th>${d.label}</th>
        <td>${best[`lives.${key}`] ? formatTime(best[`lives.${key}`]) : '–'}</td>
        <td>${best[`normal.${key}`] ? formatTime(best[`normal.${key}`]) : '–'}</td></tr>`).join('');
    await this.dialog({
      title: 'Best times 🏆',
      body: `<table class="stats"><tr><th></th><th>Lives</th><th>Normal</th></tr>${rows}</table>`,
      buttons: [{ label: 'Close', value: 'close', primary: true }],
    });
  }

  // ---------- Rendering ----------

  render() {
    const g = this.game;
    const s = g.s;
    const playing = g.isPlaying();

    this.app.classList.toggle('mode-normal', s.mode === 'normal');
    this.app.classList.toggle('notes-on', this.notesMode);
    document.querySelectorAll('.segmented button').forEach((b) => {
      b.setAttribute('aria-checked', String(b.dataset.mode === s.mode));
    });
    $('#difficulty').value = s.difficulty;
    $('#difficulty-label').textContent = DIFFICULTIES[s.difficulty].label;

    const lives = $('#lives');
    lives.hidden = s.mode !== 'lives';
    if (lives.children.length !== MAX_LIVES) {
      lives.innerHTML = '<span>❤️</span>'.repeat(MAX_LIVES);
    }
    [...lives.children].forEach((h, k) => h.classList.toggle('lost', k >= s.lives));

    this.board.classList.toggle('paused', this.paused);
    $('#pause-overlay').hidden = !this.paused;
    $('#pause-btn').innerHTML = this.paused ? ICON_PLAY : ICON_PAUSE;
    this.renderTimer();

    const sel = this.selected;
    const selValue = sel != null ? s.values[sel] : 0;
    const related = new Set(sel != null ? PEERS[sel] : []);
    const shown = new Set(s.shownMistakes);

    for (let i = 0; i < 81; i++) {
      const cell = this.cells[i];
      const v = s.values[i];
      const given = g.isGiven(i);
      const wrong = v !== 0 && !given && (
        (s.mode === 'lives' && !g.isCorrect(i)) || shown.has(i)
      );
      cell.firstChild.textContent = v || '';
      cell.classList.toggle('given', given);
      cell.classList.toggle('wrong', wrong);
      cell.classList.toggle('selected', i === sel);
      cell.classList.toggle('related', related.has(i));
      cell.classList.toggle('same', selValue !== 0 && v === selValue && i !== sel);

      const notes = cell.lastChild.children;
      const mask = v ? 0 : s.notes[i];
      for (let n = 1; n <= 9; n++) {
        const on = (mask & (1 << n)) !== 0;
        notes[n - 1].textContent = on ? n : '';
        notes[n - 1].classList.toggle('match', on && n === selValue);
      }
    }

    this.numButtons.forEach((btn, k) => {
      const v = k + 1;
      const count = g.digitCount(v);
      const done = count >= 9;
      btn.classList.toggle('done', done);
      btn.firstChild.textContent = done ? '✓' : v;
      btn.lastChild.textContent = done ? '' : 9 - count;
      btn.disabled = !playing || (s.mode === 'lives' && done && !this.notesMode);
      btn.setAttribute('aria-label', done ? `${v} (complete)` : `${v}, ${9 - count} left`);
    });

    const notesBtn = $('#notes-btn');
    notesBtn.setAttribute('aria-pressed', String(this.notesMode));
    notesBtn.querySelector('.badge').textContent = this.notesMode ? 'on' : 'off';
    $('#undo-btn').disabled = !playing || s.history.length === 0;
    $('#erase-btn').disabled = !playing;
    $('#hint-btn').disabled = !playing;
    $('#check-btn').disabled = !playing;
    $('#mistakes-btn').disabled = !playing;
    $('#mistakes-btn').setAttribute('aria-pressed', String(s.shownMistakes.length > 0));
  }

  renderTimer() {
    $('#timer').textContent = formatTime(this.game.s.elapsed);
  }

  // ---------- Helpers ----------

  toast(msg, kind = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast show ${kind}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { t.className = 'toast'; }, 1800);
  }

  dialog({ title, body, buttons }) {
    const dlg = $('#dialog');
    $('#dialog-title').textContent = title;
    $('#dialog-body').innerHTML = body;
    const menu = $('#dialog-buttons');
    menu.innerHTML = '';
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.value = b.value;
      btn.textContent = b.label;
      if (b.primary) btn.className = 'primary';
      menu.appendChild(btn);
    }
    dlg.returnValue = '';
    return new Promise((resolve) => {
      dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true });
      dlg.showModal();
    });
  }
}

function restartAnimation(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth; // force reflow so the animation replays
  el.classList.add(cls);
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}
