import { Browser } from "happy-dom";

const browser = new Browser();
const page = browser.newPage();

// Reloads the current URL.
await page.reload({
   hard: true,
   timeout: 60000,
});

await browser.close();
