import { GlobalWindow } from "mad-dom";

const window = new GlobalWindow({ settings: { enableJavaScriptEvaluation: true } });
const document = window.document;

document.write(`
   <script>
       globalThis.helloWorld = 'Hello world!';
   </script>
`);

// Outputs "Hello world!"
console.log(global.helloWorld);

// Close window
await window.happyDOM.close();
