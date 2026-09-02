import { Browser } from "happy-dom";

const browser = new Browser();
const page = browser.newPage();

page.mainFrame.url = "https://example.com";
