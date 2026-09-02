import { Browser, VirtualConsoleLogLevelEnum } from "happy-dom";

const browser = new Browser();
const page = browser.newPage();
const error = new Error("Test error");

page.mainFrame.window.console.log("Test 1", { test: "test" });
page.mainFrame.window.console.info("Test 2", { test: "test" });
page.mainFrame.window.console.warn("Test 3", { test: "test" });
page.mainFrame.window.console.error("Test 4", { test: "test" }, error);
page.mainFrame.window.console.debug("Test 5", { test: "test" });
page.mainFrame.window.console.assert(false, "Test 6", { test: "test" });
page.mainFrame.window.console.group("Test 7");
page.mainFrame.window.console.log("Test 8", { test: "test" });
page.mainFrame.window.console.groupCollapsed("Test 9");
page.mainFrame.window.console.log("Test 10", { test: "test" });
page.mainFrame.window.console.groupEnd();
page.mainFrame.window.console.group("Test 11");
page.mainFrame.window.console.log("Test 12", { test: "test" });
page.mainFrame.window.console.error("Test 13", error);
page.mainFrame.window.console.groupEnd();
page.mainFrame.window.console.log("Test 14", { test: "test" });
page.mainFrame.window.console.groupEnd();
page.mainFrame.window.console.count("Test 15");
page.mainFrame.window.console.count("Test 15");
page.mainFrame.window.console.countReset("Test 15");

const log = page.virtualConsolePrinter.readAsString(
	VirtualConsoleLogLevelEnum.log
);

/**
Will output:
   Test 1 {"test":"test"}
   Test 2 {"test":"test"}
   Test 3 {"test":"test"}
   Test 4 {"test":"test"} Error: Test error
      at /some/where.js:1:1
   Test 5 {"test":"test"}
   Assertion failed: Test 6 {"test":"test"}
   ▼ Test 7
   Test 8 {"test":"test"}
   ▶ Test 9
   ▼ Test 11
      Test 12 {"test":"test"}
      Test 13 Error: Test error
         at /some/where.js:1:1
   Test 14 {"test":"test"}
   Test 15: 1
   Test 15: 2
   Test 15: 0
**/
global.console.log(log);
