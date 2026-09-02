import { Window } from "mad-dom";

const window = new Window({ url: "https://localhost:8080" });
const document = window.document;

document.body.innerHTML = '<div class="container"></div>';

const container = document.querySelector(".container");
const button = document.createElement("button");

container.appendChild(button);

// Outputs "<div class="container"><button></button></div>"
console.log(document.body.innerHTML);

// Aborts any ongoing operations (such as fetch and timers)
await window.happyDOM.abort();

// Closes the window
window.close();
