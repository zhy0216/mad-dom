import { Browser } from "mad-dom";

const browser = new Browser();
const page = browser.newPage();

await page.mainFrame.goBack();

await browser.close();
