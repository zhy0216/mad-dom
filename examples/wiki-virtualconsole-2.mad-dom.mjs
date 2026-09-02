import { Window } from "mad-dom";

const window = new Window({ console: global.console });

// Will output 'Test' to the Node.js console
window.console.log('Test');
