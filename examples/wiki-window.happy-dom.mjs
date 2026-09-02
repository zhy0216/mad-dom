import { Window } from 'happy-dom';

const window = new Window({
    url: 'https://localhost:8080',
    height: 1920,
    width: 1080,
    settings: {
        navigator: {
            userAgent: 'Mozilla/5.0 (X11; Linux x64) AppleWebKit/537.36 (KHTML, like Gecko) HappyDOM/2.0.0'
        }
    }
});
const document = window.document;

document.body.innerHTML = '<div class="container"></div>';

const container = document.querySelector('.container');
const button = document.createElement('button');

container.appendChild(button);

// Outputs "<div class="container"><button></button></div>"
console.log(document.body.innerHTML);

// Close window
await window.happyDOM.close();
