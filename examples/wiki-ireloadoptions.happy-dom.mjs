import { Browser } from "happy-dom";

const browser = new Browser();
const page = browser.newPage();

await page.reload("https://example.com", {
   hard: true,
   timeout: 60000,
});
