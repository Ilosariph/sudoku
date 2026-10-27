// Scan screen: photo → recognized grid the user can correct → new game.
// A grid with exactly one solution starts in lives mode, anything else in
// normal mode (checked against the rules, as there is no single solution).
import { PEERS, rowOf, colOf } from './sudoku.js';
import { grayFromSource, scan, readGrid, projector } from './scan.js';

const $ = (sel) => document.querySelector(sel);
const UNSURE = 0.9; // recognitions below this confidence are flagged
const HANDLE = 12; // corner handle radius in CSS px

export class ScanView {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.view = $('#scan-view');
    this.board = $('#scan-board');
    this.canvas = $('#scan-canvas');
    this.grid = new Array(81).fill(0);
    this.unsure = new Set();
    this.selected = null;
    this.result = null; // { count, solution } for the current grid
    this.image = null; // { gray, w, h, canvas, quad }
    this.worker = null;
    this.cells = [];

    this.buildBoard();
    this.buildNumpad();
    this.bindControls();
  }

  // ---------- Construction ----------

  buildBoard() {
    for (let i = 0; i < 81; i++) {
      const cell = document.createElement('div');
      cell.className = `cell r${rowOf(i)} c${colOf(i)}`;
      cell.setAttribute('role', 'gridcell');
      cell.dataset.index = i;
      this.board.appendChild(cell);
      this.cells.push(cell);
    }
    this.board.addEventListener('click', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell) return;
      const i = Number(cell.dataset.index);
      this.selected = this.selected === i ? null : i;
      this.render();
    });
  }

  buildNumpad() {
    const pad = $('#scan-numpad');
    for (let v = 1; v <= 9; v++) {
      const btn = document.createElement('button');
      btn.className = 'num';
      btn.innerHTML = `<span class="digit">${v}</span>`;
      btn.addEventListener('click', () => this.input(v));
      pad.appendChild(btn);
    }
  }

  bindControls() {
    $('#scan-btn').addEventListener('click', () => this.open());
    $('#scan-close').addEventListener('click', () => this.close());
    for (const id of ['#scan-camera', '#scan-file']) {
      $(id).addEventListener('change', (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (file) this.loadFile(file);
      });
    }
    $('#scan-erase').addEventListener('click', () => this.input(0));
    $('#scan-clear').addEventListener('click', () => {
      this.grid.fill(0);
      this.unsure.clear();
      this.changed();
    });
    $('#scan-start').addEventListener('click', () => this.start());
    document.addEventListener('keydown', (e) => this.handleKey(e));

    this.canvas.addEventListener('pointerdown', (e) => this.dragStart(e));
    this.canvas.addEventListener('pointermove', (e) => this.dragMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.dragEnd(e));
    this.canvas.addEventListener('pointercancel', (e) => this.dragEnd(e));
    window.addEventListener('resize', () => this.drawPhoto());
  }

  // ---------- Open / close ----------

  open() {
    if (this.game.isPlaying()) this.ui.setPaused(true);
    $('.app').hidden = true;
    this.view.hidden = false;
    window.scrollTo(0, 0);
    this.changed();
  }

  close() {
    this.view.hidden = true;
    $('.app').hidden = false;
    this.ui.render();
  }

  isOpen() { return !this.view.hidden; }

  // ---------- Photo ----------

  async loadFile(file) {
    const status = $('#scan-status');
    status.textContent = 'Reading photo…';
    status.className = 'scan-status';
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      // Let the status paint before the (short) synchronous scan.
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
      const src = grayFromSource(img);
      const res = scan(src.gray, src.w, src.h);
      this.image = { ...src, quad: res.quad };
      $('#scan-photo').hidden = false;
      $('#scan-intro').hidden = true;
      this.drawPhoto();
      this.applyRead(res);
      if (!res.found) this.ui.toast('No grid found – drag the corners onto it', 'bad');
    } catch {
      this.ui.toast('Could not read that image', 'bad');
      this.changed();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  applyRead({ grid, confidence }) {
    this.grid = grid;
    this.unsure = new Set(grid.flatMap((v, i) => (v && confidence[i] < UNSURE ? [i] : [])));
    this.selected = null;
    this.changed();
  }

  rescan() {
    const { gray, w, h, quad } = this.image;
    this.applyRead(readGrid(gray, w, h, quad));
  }

  // Canvas shows the photo with the detected grid outline and draggable corners.
  drawPhoto() {
    if (!this.image || this.view.hidden) return;
    const { canvas: src, w, h, quad } = this.image;
    const c = this.canvas;
    const cssW = c.parentElement.clientWidth;
    const scale = Math.min(cssW / w, (window.innerHeight * 0.5) / h);
    const dpr = window.devicePixelRatio || 1;
    c.style.width = `${w * scale}px`;
    c.style.height = `${h * scale}px`;
    c.width = Math.round(w * scale * dpr);
    c.height = Math.round(h * scale * dpr);
    this.viewScale = scale;
    const ctx = c.getContext('2d');
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    ctx.drawImage(src, 0, 0);

    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const at = projector(quad);
    ctx.lineWidth = 1 / scale;
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.6;
    for (let k = 1; k < 9; k++) {
      const t = k / 9;
      for (const [p, q] of [[at(t, 0), at(t, 1)], [at(0, t), at(1, t)]]) {
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2.5 / scale;
    ctx.beginPath();
    quad.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = accent;
    for (const p of quad) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, HANDLE / scale, 0, Math.PI * 2);
      ctx.globalAlpha = 0.35;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
    }
  }

  pointerPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.viewScale, y: (e.clientY - r.top) / this.viewScale };
  }

  dragStart(e) {
    if (!this.image) return;
    const p = this.pointerPos(e);
    let best = -1, bestD = (HANDLE * 2.5) / this.viewScale;
    this.image.quad.forEach((q, k) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bestD) { best = k; bestD = d; }
    });
    if (best < 0) return;
    this.drag = best;
    this.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  dragMove(e) {
    if (this.drag == null) return;
    const p = this.pointerPos(e);
    const { w, h } = this.image;
    this.image.quad[this.drag] = { x: Math.max(0, Math.min(w - 1, p.x)), y: Math.max(0, Math.min(h - 1, p.y)) };
    this.drawPhoto();
  }

  dragEnd() {
    if (this.drag == null) return;
    this.drag = null;
    this.rescan();
  }

  // ---------- Editing ----------

  handleKey(e) {
    if (!this.isOpen() || e.ctrlKey || e.metaKey || e.altKey || $('#dialog').open) return;
    const i = this.selected;
    if (i == null) return;
    const m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code) ?? /^([0-9])$/.exec(e.key);
    const moves = { ArrowUp: [8, 0], ArrowDown: [1, 0], ArrowLeft: [0, 8], ArrowRight: [0, 1] };
    if (m) this.input(Number(m[1]));
    else if (e.key === 'Backspace' || e.key === 'Delete') this.input(0);
    else if (e.key in moves) {
      const [dr, dc] = moves[e.key];
      this.selected = ((rowOf(i) + dr) % 9) * 9 + (colOf(i) + dc) % 9;
      this.render();
    } else return;
    e.preventDefault();
  }

  input(v) {
    const i = this.selected;
    if (i == null) {
      this.ui.toast('Select a cell first');
      return;
    }
    this.grid[i] = this.grid[i] === v ? 0 : v;
    this.unsure.delete(i);
    this.changed();
  }

  conflicts() {
    const out = new Set();
    for (let i = 0; i < 81; i++) {
      if (this.grid[i] && PEERS[i].some((p) => this.grid[p] === this.grid[i])) out.add(i);
    }
    return out;
  }

  // Re-checks the grid in a worker; a new edit cancels a running check.
  changed() {
    this.result = null;
    this.worker?.terminate();
    this.worker = null;
    const clues = this.grid.filter(Boolean).length;
    if (clues && !this.conflicts().size) {
      const worker = new Worker(new URL('./solver-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        worker.terminate();
        if (this.worker !== worker) return;
        this.worker = null;
        this.result = data;
        this.render();
      };
      worker.postMessage(this.grid.slice());
      this.worker = worker;
    }
    this.render();
  }

  render() {
    const conflicts = this.conflicts();
    const selValue = this.selected != null ? this.grid[this.selected] : 0;
    this.cells.forEach((cell, i) => {
      const v = this.grid[i];
      cell.textContent = v || '';
      cell.classList.toggle('given', !!v);
      cell.classList.toggle('selected', i === this.selected);
      cell.classList.toggle('same', !!selValue && v === selValue && i !== this.selected);
      cell.classList.toggle('wrong', conflicts.has(i));
      cell.classList.toggle('unsure', this.unsure.has(i));
    });

    const clues = this.grid.filter(Boolean).length;
    const status = $('#scan-status');
    let text, kind = '';
    if (!clues) text = '';
    else if (conflicts.size) { text = 'Some digits clash (red). Fix them to continue.'; kind = 'bad'; }
    else if (!this.result) text = 'Checking…';
    else if (this.result.count === 1) { text = `${clues} clues · one solution → Lives mode`; kind = 'good'; }
    else if (this.result.count > 1) text = `${clues} clues · several solutions → Normal mode`;
    else { text = `${clues} clues · no solution, a digit is probably misread → Normal mode`; kind = 'bad'; }
    if (this.unsure.size && !conflicts.size) text += ` · check the ${this.unsure.size} dotted cell${this.unsure.size > 1 ? 's' : ''}`;
    status.textContent = text;
    status.className = `scan-status ${kind}`;
    $('#scan-start').disabled = !this.result;
    $('#scan-erase').disabled = this.selected == null;
  }

  async start() {
    const { count, solution } = this.result;
    const s = this.game.s;
    const inProgress = s.status === 'playing' && s.values.some((v, i) => v && !s.puzzle[i]);
    if (inProgress) {
      const ok = await this.ui.dialog({
        title: 'Start the scanned puzzle?',
        body: '<p>Your current game will be lost.</p>',
        buttons: [{ label: 'Cancel', value: 'no' }, { label: 'Start', value: 'yes', primary: true }],
      });
      if (ok !== 'yes') return;
    }
    this.game.newCustom(count === 1 ? 'lives' : 'normal', this.grid.slice(), solution);
    this.reset();
    this.close();
  }

  reset() {
    this.grid = new Array(81).fill(0);
    this.unsure.clear();
    this.selected = null;
    this.image = null;
    $('#scan-photo').hidden = true;
    $('#scan-intro').hidden = false;
  }
}
