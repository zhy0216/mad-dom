import { Browser, CookieSameSiteEnum } from "mad-dom";

const browser = new Browser();

const expires = new Date("2030-01-01T00:00:00Z");

browser.defaultContext.cookieContainer.addCookies([
  {
    key: "key1",
    originURL: "https://example.com",
  },
  {
    key: "key2",
    originURL: "https://example.com",
    value: "value2",
    domain: "example.com",
    path: "/path/to/page/",
    expires,
    httpOnly: true,
    secure: true,
    sameSite: CookieSameSiteEnum.strict,
  }
]);

// Outputs:
// [
//   {
//     key: "key2",
//     originURL: "https://example.com",
//     value: "value2",
//     domain: "example.com",
//     path: "/path/to/page/",
//     expires,
//     httpOnly: true,
//     secure: true,
//     sameSite: "Strict"
//   }
// ];
console.log(
	browser.defaultContext.cookieContainer.getCookies(
		"https://example.com",
		true
	)
);
