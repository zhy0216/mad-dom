import { Window, GlobalWindow } from 'happy-dom';

const vmWindow = new Window();
const globalWindow = new GlobalWindow();

// Will output "false"
console.log(vmWindow.Array === global.Array);

// Will output "true"
console.log(globalWindow.Array === global.Array);

globalWindow.eval('global.test = 1');

// Will output "1"
console.log(global.test);
