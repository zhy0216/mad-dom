import { Window } from "happy-dom";

const window = new Window();

window.happyDOM.setViewport({
   width: 1920,
   height: 1080,
   devicePixelRatio: 2
});

// Outputs: 1920
console.log(window.innerWidth);

await window.happyDOM.close();
