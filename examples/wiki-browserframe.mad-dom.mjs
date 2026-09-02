import { Browser } from "mad-dom";

const browser = new Browser();
const page = browser.newPage();

page.mainFrame.url = "https://example.com";
