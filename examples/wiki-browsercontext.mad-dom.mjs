import { Browser } from "mad-dom";

const browser = new Browser();
const context = browser.newIncognitoContext();
const page = context.newPage();

await page.goto("https://example.com");

await browser.close();
