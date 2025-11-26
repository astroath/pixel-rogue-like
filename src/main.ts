import { Game } from './core/Game';
import './style.css';

const game = new Game();
game.start().catch(console.error);
