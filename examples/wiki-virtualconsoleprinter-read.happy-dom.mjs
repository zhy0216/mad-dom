import { Window } from 'happy-dom';

const window = new Window();

window.console.log('Test', { test: true });

const entries = window.happyDOM.virtualConsolePrinter.read();
const log = entries.map(entry => entry.message.join(' ')).join('\n');

// Will output 'Test [object Object]' to the NodeJS console
global.console.log(log);
