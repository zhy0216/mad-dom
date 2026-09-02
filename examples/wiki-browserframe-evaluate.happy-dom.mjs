import { Browser } from "happy-dom";
import { Script } from "node:vm";

const browser = new Browser();
const page = browser.newPage();

page.mainFrame.evaluate('document.body.innerHTML = "<span>hello world</span>";');

// Outputs: "hello world"
console.log(page.mainFrame.document.querySelector('span').innerText);

page.mainFrame.evaluate(new Script('document.body.innerHTML = "<span>Hello world!!!!</span>";'));

// Outputs: "Hello world!!!!"
console.log(page.mainFrame.document.querySelector('span').innerText);

await browser.close();
