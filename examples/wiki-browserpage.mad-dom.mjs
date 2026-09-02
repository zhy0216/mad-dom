import { Browser } from "mad-dom";

const browser = new Browser();
const page = browser.newPage();

await page.goto("https://example.com");

await browser.close();
