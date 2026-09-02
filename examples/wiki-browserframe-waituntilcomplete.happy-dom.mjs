import { Browser } from 'happy-dom';

const browser = new Browser({
  settings: {
    timer: {
      maxTimeout: 200,
      maxIntervalTime: 10,
      maxIntervalIterations: 1,
      preventTimerLoops: true
    }
  }
});

const page = browser.newPage();

// Navigates page
await page.goto('https://github.com/capricorn86');

// Waits for the page to complete.
await page.mainFrame.waitUntilComplete();
