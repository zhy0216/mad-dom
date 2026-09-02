import { Window } from "mad-dom";

const window = new Window({
   innerWidth: 1024,
   innerHeight: 768,
   url: "http://localhost:8080",
   settings: { enableJavaScriptEvaluation: true }
});
const document = window.document;

document.write(`
    <html>
        <head>
             <title>Test page</title>
        </head>
        <body>
            <div class="root"></div>
            <script src="app.js"></script>
        </body>
    </html>
`);

// Waits for async operations such as timers, resource loading and fetch() on the page to complete
// Note that this may get stuck when using intervals or a timer in a loop (see IBrowserSettings for ways to mitigate this)
await window.happyDOM.waitUntilComplete();

// Outputs the rendered result
console.log(window.document.documentElement.outerHTML);

// Cancels all ongoing operations and destroys the Window instance
await window.happyDOM.close();
