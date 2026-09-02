import { Window } from "happy-dom";

const window = new Window({
   url: 'https://localhost:8080',
   settings: {
      fetch: {
         virtualServers: [
            {
               url: 'https://localhost:8080',
               directory: "./build"
            }
         ]
      }
   }
});

const childWindow = window.open('https://localhost:8080');

await window.happyDOM.waitUntilComplete();

// Outputs "script.js"
console.log(childWindow.document.querySelector('script').getAttribute('src'));
