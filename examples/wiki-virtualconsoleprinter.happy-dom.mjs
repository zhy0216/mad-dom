import { Window } from "happy-dom";

const window = new Window();

window.console.log("Test", { test: true });

const log = window.happyDOM.virtualConsolePrinter.readAsString();

// Will output 'Test {"test": true}' to the NodeJS console
global.console.log(log);
