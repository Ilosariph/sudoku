import { Game } from './game.js';
import { UI } from './ui.js';

const game = new Game();
const ui = new UI(game);

if (!game.restore()) game.newGame('lives', 'easy');
ui.render();
