import { Browser } from "mad-dom";

const browser = new Browser();
const page = browser.newPage();

await page.goSteps(-1);

await browser.close();
