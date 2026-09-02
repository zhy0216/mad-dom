import { Browser, BrowserErrorCaptureEnum } from "mad-dom";

const browser = new Browser({ settings: { errorCapture: BrowserErrorCaptureEnum.processLevel } });
const page = browser.newPage();

// Navigates page
await page.goto('https://github.com/capricorn86');

// Clicks on link
page.mainFrame.document.querySelector('a[href*="capricorn86/happy-dom"]').click();

// Waits for all operations on the page to complete (fetch, timers etc.)
await page.waitUntilComplete();

// Outputs "GitHub - capricorn86/happy-dom: Happy DOM..."
console.log(page.mainFrame.document.title);

// Aborts all ongoing operations and closes the browser
await browser.close();
