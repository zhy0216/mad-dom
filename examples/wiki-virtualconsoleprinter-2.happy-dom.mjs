import { Browser } from "happy-dom";

const browser = new Browser();
const page = browser.newPage();

page.mainFrame.window.console.log("Test", { test: true });

const log = page.virtualConsolePrinter.readAsString();

// Will output 'Test {"test": true}' to the NodeJS console
global.console.log(log);
