import { Game } from './game.js';
import { UI } from './ui.js';
import { ScanView } from './scan-ui.js';

const game = new Game();
const ui = new UI(game);
new ScanView(game, ui);

if (!game.restore()) game.newGame('lives', 'easy');
ui.render();
