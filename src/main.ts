import './style.css';
import { Game } from './runtime/game';

const canvas = document.getElementById('game');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Missing canvas element');
}

const game = new Game(canvas);

game.start();
