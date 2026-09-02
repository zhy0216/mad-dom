import { Browser } from "happy-dom";

const browser = new Browser();
const page = browser.newPage();

await page.mainFrame.goBack();

await browser.close();
