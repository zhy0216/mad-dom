import { Browser } from "happy-dom";

const browser = new Browser();
const page = browser.newPage();

// Navigates to URL
await page.mainFrame.goto('https://example.com', {
   referrer: 'https://github.com/capricorn86/happy-dom/',
   referrerPolicy: 'origin-when-cross-origin'
});

await browser.close();
