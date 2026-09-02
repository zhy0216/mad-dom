import { Window, VirtualConsoleLogLevelEnum } from "happy-dom";

const window = new Window();

window.console.log("Test", { test: true });

const log = window.happyDOM.virtualConsolePrinter.readAsString(
   VirtualConsoleLogLevelEnum.log
);

// Will output 'Test {"test": true}' to the NodeJS console
global.console.log(log);
