import { Browser } from "mad-dom";

const browser = new Browser();
const page = browser.newPage();

page.url = 'https://example.com';
page.content = '<html><body>Hello world!</body></html>';

// Outputs "Hello world!"
console.log(page.mainFrame.document.body.textContent);

await browser.close();
