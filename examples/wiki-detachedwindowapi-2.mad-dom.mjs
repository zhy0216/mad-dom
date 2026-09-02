import { Window } from "mad-dom";

const window = new Window({ url: "https://localhost:3000", settings: { enableJavaScriptEvaluation: true } });

window.document.write(`
    <script>
        setTimeout(() => {
            document.body.innerHTML = "Hello World!";
        }, 10);
    </script>
`);

await window.happyDOM.waitUntilComplete();

// Outputs "Hello World!"
console.log(window.document.body.innerHTML);

await window.happyDOM.close();
