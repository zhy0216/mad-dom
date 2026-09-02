import { Window } from "mad-dom";

const window = new Window();

window.happyDOM.virtualConsolePrinter.addEventListener('clear', () => {
    // Will clear the NodeJS log
    global.console.clear();
});

window.console.clear();
