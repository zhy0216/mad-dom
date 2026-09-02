import { Browser } from "happy-dom";

const browser = new Browser({
   settings: {
      fetch: {
         virtualServers: [
            {
               url: 'https://localhost:8080',
               directory: "./build"
            }
         ]
      }
   }
});

const page = browser.newPage();

await page.goto("https://localhost:8080");

// Waits for async operations such as timers, resource loading and fetch() on the page to complete
// Note that this may get stuck when using intervals or a timer in a loop (see IBrowserSettings for ways to mitigate this)
await page.waitUntilComplete();

// Outputs the rendered result
console.log(
   page.mainFrame.document.documentElement.getHTML({ serializableShadowRoots: true })
);

// Closes the browser
await browser.close()
