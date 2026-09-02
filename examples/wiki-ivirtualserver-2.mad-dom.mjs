import { Browser } from "mad-dom";

const browser = new Browser({
   settings: {
      fetch: {
         virtualServers: [
            {
               url: /https:\/\/localhost:8080\/[a-z]{2}\/[a-z]{2}\//,
               directory: "./build"
            }
         ]
      }
   }
});

const page = browser.newPage();

await page.goto("https://localhost:8080/gb/en/");

// Outputs "script.js"
console.log(page.mainFrame.document.querySelector('script').getAttribute('src'));

