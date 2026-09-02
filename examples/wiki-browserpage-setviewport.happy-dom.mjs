import { Browser } from "happy-dom";

const browser = new Browser();
const page = browser.newPage();

page.setViewport({
   width: 1920,
   height: 1080,
   devicePixelRatio: 2
});

// Outputs: 1920
console.log(page.mainFrame.window.innerWidth);

await browser.close();
