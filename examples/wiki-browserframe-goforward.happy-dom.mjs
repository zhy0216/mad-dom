import { Browser } from "happy-dom";

const browser = new Browser();
const page = browser.newPage();

await page.mainFrame.goForward();

await browser.close();
