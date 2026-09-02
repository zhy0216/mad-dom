import { Browser } from "mad-dom";

const browser = new Browser();
const page = browser.newPage();

page.setViewport({
   width: 800,
   height: 600,
   devicePixelRatio: 2,
});
