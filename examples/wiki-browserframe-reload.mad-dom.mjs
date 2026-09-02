import { Browser } from "mad-dom";

const browser = new Browser();
const page = browser.newPage();

// Reloads the current URL.
await page.mainFrame.reload({
   hard: true,
   timeout: 60000,
});

await browser.close();
