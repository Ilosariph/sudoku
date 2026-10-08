# Sudoku

Browser Sudoku game. Static site (HTML/CSS/vanilla JS, no build step); puzzle generation and all validation run client-side.

## Features

- **Difficulties**: Easy, Medium (solvable with singles only), Hard, Expert (need advanced techniques). Every puzzle has a unique solution.
- **Lives mode**: 3 lives, every input checked instantly. Wrong digits turn red and cost a life; 0 lives → game over (retry or new game). Completing a row, column or 3×3 box plays an animation. A digit placed correctly 9 times shows ✓ in the number row.
- **Normal mode**: no feedback while typing. *Check* reports only "all correct" / "not all correct"; *Show mistakes* marks wrong cells.
- **Input** via number row below the board (tap a cell, then a digit). Tapping the same digit again in normal mode clears the cell.
- **Notes**: toggle *Notes*; digits are laid out as a 3×3 keypad (1 top-left, 5 center, 9 bottom-right). Placing a digit removes it from notes in the same row/column/box.
- Same-number highlighting (including matching notes), row/column/box highlighting.
- Undo, erase, hints, timer with pause (auto-pauses when the tab is hidden).
- Auto-save/resume via `localStorage`, best times per mode + difficulty, light/dark theme.

## Run

```sh
docker compose up -d --build   # → http://localhost:8080
```

Or without Docker:

```sh
npm start                      # → http://localhost:8000 (python3 static server)
```

## Test

```sh
npm test                       # generator/solver tests (node --test, no deps)
```

## Layout

| Path | Purpose |
| --- | --- |
| `public/js/sudoku.js` | Solver, uniqueness check, puzzle generator |
| `public/js/game.js` | Game state, modes, undo, persistence |
| `public/js/ui.js` | Rendering and input handling |
| `Dockerfile`, `nginx.conf`, `docker-compose.yml` | Container serving the static site via nginx |
