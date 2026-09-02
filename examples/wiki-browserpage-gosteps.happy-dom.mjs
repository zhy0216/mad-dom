import { Browser } from "happy-dom";

const browser = new Browser();
const page = browser.newPage();

await page.goSteps(-1);

await browser.close();
