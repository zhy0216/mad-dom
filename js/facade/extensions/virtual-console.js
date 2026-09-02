// Virtual console facade module (shared by the Window and Browser surfaces).
//
// The happy-dom virtual console contract in one module:
//
//   - `VirtualConsoleLogLevelEnum` / `VirtualConsoleLogTypeEnum` — the log
//     level and log type values;
//   - `VirtualConsolePrinter` — the growing buffer of log entries with the
//     `print` / `clear` event surface and the `read` / `readAsString`
//     consumers;
//   - `VirtualConsole` — the `window.console` implementation happy-dom gives a
//     window: every method writes a log entry into its printer.
//
// # One printer, two owners
//
// A detached `new Window()` owns its printer through `window.happyDOM`
// (window-platform.js); a `BrowserPage` owns the printer its frame window's
// `happyDOM.virtualConsolePrinter` is wired to. The console therefore never
// caches a printer eagerly handed at construction time when it is given a
// *resolver*: it resolves the printer through the resolver on **every** print,
// so a page that (re)points the frame window's `happyDOM.virtualConsolePrinter`
// at its own printer receives every subsequent entry. Constructing a
// `VirtualConsole` with a plain printer object (the happy-dom shape) uses that
// printer directly.
//
// # Calibrated against happy-dom 20.11.11
//
// The printer keeps the exact observable behavior the Browser facade locked
// earlier (entry buffer, `print` / `clear` listener dispatch, `read` draining
// the buffer, `readAsString` level filtering through the happy-dom
// `VirtualConsoleLogEntryStringifier` rules). The `VirtualConsole` methods
// mirror happy-dom's `VirtualConsole` entry shapes:
// `{ type, level, message: any[], group }`, the `message ? [message, ...args]
// : args` argument shaping, the `count` / `time` label maps and the group
// stack.

export const seam = Object.freeze({
  id: "facade/extensions/virtual-console",
  owner: "window",
  gate: "window",
  status: "implemented",
});

// --- enums -------------------------------------------------------------------

export const VirtualConsoleLogLevelEnum = Object.freeze({
  log: 0,
  info: 1,
  warn: 2,
  error: 3,
});

export const VirtualConsoleLogTypeEnum = Object.freeze({
  // Log
  log: "log",
  table: "table",
  trace: "trace",
  dir: "dir",
  dirxml: "dirxml",
  group: "group",
  groupCollapsed: "groupCollapsed",
  debug: "debug",
  timeLog: "timeLog",
  // Info
  info: "info",
  count: "count",
  timeEnd: "timeEnd",
  // Warning
  warn: "warn",
  countReset: "countReset",
  // Error
  error: "error",
  assert: "assert",
});

// --- VirtualConsolePrinter -----------------------------------------------------

/**
 * The virtual console printer (happy-dom parity): a growing buffer of log
 * entries with the `print` / `clear` event surface and `read` / `readAsString`
 * consumers.
 */
export class VirtualConsolePrinter {
  #logEntries = [];
  #listeners = { print: [], clear: [] };
  #closed = false;

  get closed() {
    return this.#closed;
  }

  print(logEntry) {
    if (this.#closed) return;
    this.#logEntries.push(logEntry);
    this.#dispatch({ type: "print" });
  }

  clear() {
    if (this.#closed) return;
    this.#logEntries = [];
    this.#dispatch({ type: "clear" });
  }

  close() {
    if (this.#closed) return;
    this.#logEntries = [];
    this.#listeners = { print: [], clear: [] };
    this.#closed = true;
  }

  addEventListener(eventType, listener) {
    if (this.#closed) return;
    if (!this.#listeners[eventType]) {
      throw new Error(`Event type "${eventType}" is not supported.`);
    }
    this.#listeners[eventType].push(listener);
  }

  removeEventListener(eventType, listener) {
    if (this.#closed) return;
    if (!this.#listeners[eventType]) {
      throw new Error(`Event type "${eventType}" is not supported.`);
    }
    const index = this.#listeners[eventType].indexOf(listener);
    if (index !== -1) {
      this.#listeners[eventType].splice(index, 1);
    }
  }

  dispatchEvent(event) {
    if (this.#closed) return;
    if (event.type !== "print" && event.type !== "clear") {
      throw new Error(`Event type "${event.type}" is not supported.`);
    }
    this.#dispatch(event);
  }

  #dispatch(event) {
    for (const listener of this.#listeners[event.type]) {
      listener(event);
    }
  }

  read() {
    const logEntries = this.#logEntries;
    this.#logEntries = [];
    return logEntries;
  }

  readAsString(logLevel = VirtualConsoleLogLevelEnum.log) {
    const logEntries = this.read();
    let output = "";
    for (const logEntry of logEntries) {
      if (logEntry.level >= logLevel) {
        output += stringifyLogEntry(logEntry);
      }
    }
    return output;
  }
}

// --- log entry stringifier (happy-dom VirtualConsoleLogEntryStringifier) -------

const LOG_TYPE_ICON = {
  group: "▼ ",
  groupCollapsed: "▶ ",
};

function isLogEntryCollapsed(logEntry) {
  let group =
    logEntry.type === "group" || logEntry.type === "groupCollapsed"
      ? logEntry.group?.parent
      : logEntry.group;
  while (group) {
    if (group.collapsed) return true;
    group = group.parent;
  }
  return false;
}

function logEntryGroupTabbing(logEntry) {
  let tabs = "";
  let group =
    logEntry.type === "group" || logEntry.type === "groupCollapsed"
      ? logEntry.group?.parent
      : logEntry.group;
  while (group) {
    tabs += "  ";
    group = group.parent;
  }
  return tabs;
}

/**
 * happy-dom `VirtualConsoleLogEntryStringifier.toString` parity: groups are
 * indented, plain objects / arrays JSON-stringified, `Error`-like parts keep
 * their stack, collapsed groups are skipped, and `group` / `groupCollapsed`
 * entries get the icon prefix. String messages (the browser error path) are
 * passed through verbatim.
 */
function stringifyLogEntry(logEntry) {
  if (typeof logEntry.message === "string") return logEntry.message;
  if (isLogEntryCollapsed(logEntry)) return "";
  const tabbing = logEntryGroupTabbing(logEntry);
  let output = tabbing;
  for (const part of logEntry.message) {
    output += output !== "" && output !== tabbing ? " " : "";
    if (typeof part === "object" && (part === null || part.constructor.name === "Object" || Array.isArray(part))) {
      try {
        output += JSON.stringify(part);
      } catch {
        output += new Error("Failed to JSON stringify object in log entry.")
          .stack.replace(/\n    at/gm, "\n    " + tabbing + "at");
      }
    } else if (typeof part === "object" && part["message"] && part["stack"]) {
      output += part["stack"].replace(/\n    at/gm, "\n    " + tabbing + "at");
    } else {
      output += (LOG_TYPE_ICON[logEntry.type] ?? "") + String(part);
    }
  }
  return output + "\n";
}

// --- VirtualConsole --------------------------------------------------------------

/**
 * The window's virtual console (happy-dom `VirtualConsole` parity): every
 * console method writes one log entry into the printer.
 *
 * The constructor accepts either a `VirtualConsolePrinter` (the happy-dom
 * shape) or a resolver function returning one; the resolver is invoked on
 * every print so the window console always reaches the printer its window's
 * `happyDOM.virtualConsolePrinter` currently holds (never a cached copy).
 */
export class VirtualConsole {
  #printerOrResolver;
  #count = {};
  #time = {};
  #groupID = 0;
  #groups = [];

  constructor(printer) {
    this.#printerOrResolver = printer;
  }

  #printer() {
    const printer =
      typeof this.#printerOrResolver === "function"
        ? this.#printerOrResolver()
        : this.#printerOrResolver;
    return printer ?? null;
  }

  #print(logEntry) {
    const printer = this.#printer();
    if (printer !== null) printer.print(logEntry);
  }

  #currentGroup() {
    return this.#groups[this.#groups.length - 1] || null;
  }

  assert(assertion, message, ...args) {
    if (!assertion) {
      this.#print({
        type: VirtualConsoleLogTypeEnum.assert,
        level: VirtualConsoleLogLevelEnum.error,
        message: ["Assertion failed:", ...(message ? [message, ...args] : args)],
        group: this.#currentGroup(),
      });
    }
  }

  clear() {
    const printer = this.#printer();
    if (printer !== null) printer.clear();
  }

  count(label = "default") {
    if (!this.#count[label]) {
      this.#count[label] = 0;
    }
    this.#count[label]++;
    this.#print({
      type: VirtualConsoleLogTypeEnum.count,
      level: VirtualConsoleLogLevelEnum.info,
      message: [`${label}: ${this.#count[label]}`],
      group: this.#currentGroup(),
    });
  }

  countReset(label = "default") {
    delete this.#count[label];
    this.#print({
      type: VirtualConsoleLogTypeEnum.countReset,
      level: VirtualConsoleLogLevelEnum.warn,
      message: [`${label}: 0`],
      group: this.#currentGroup(),
    });
  }

  debug(message, ...args) {
    this.#print({
      type: VirtualConsoleLogTypeEnum.debug,
      level: VirtualConsoleLogLevelEnum.log,
      message: message ? [message, ...args] : args,
      group: this.#currentGroup(),
    });
  }

  dir(data) {
    this.#print({
      type: VirtualConsoleLogTypeEnum.dir,
      level: VirtualConsoleLogLevelEnum.log,
      message: [data],
      group: this.#currentGroup(),
    });
  }

  dirxml(data) {
    this.#print({
      type: VirtualConsoleLogTypeEnum.dirxml,
      level: VirtualConsoleLogLevelEnum.log,
      message: [data],
      group: this.#currentGroup(),
    });
  }

  error(message, ...args) {
    this.#print({
      type: VirtualConsoleLogTypeEnum.error,
      level: VirtualConsoleLogLevelEnum.error,
      message: message ? [message, ...args] : args,
      group: this.#currentGroup(),
    });
  }

  exception(...args) {
    this.error(...args);
  }

  group(label) {
    this.#groupID++;
    const group = {
      id: this.#groupID,
      label: label || "default",
      collapsed: false,
      parent: this.#currentGroup(),
    };
    this.#groups.push(group);
    this.#print({
      type: VirtualConsoleLogTypeEnum.group,
      level: VirtualConsoleLogLevelEnum.log,
      message: [label || "default"],
      group,
    });
  }

  groupCollapsed(label) {
    this.#groupID++;
    const group = {
      id: this.#groupID,
      label: label || "default",
      collapsed: true,
      parent: this.#currentGroup(),
    };
    this.#groups.push(group);
    this.#print({
      type: VirtualConsoleLogTypeEnum.groupCollapsed,
      level: VirtualConsoleLogLevelEnum.log,
      message: [label || "default"],
      group,
    });
  }

  groupEnd() {
    if (this.#groups.length === 0) {
      return;
    }
    this.#groups.pop();
  }

  info(message, ...args) {
    this.#print({
      type: VirtualConsoleLogTypeEnum.info,
      level: VirtualConsoleLogLevelEnum.info,
      message: message ? [message, ...args] : args,
      group: this.#currentGroup(),
    });
  }

  log(message, ...args) {
    this.#print({
      type: VirtualConsoleLogTypeEnum.log,
      level: VirtualConsoleLogLevelEnum.log,
      message: message ? [message, ...args] : args,
      group: this.#currentGroup(),
    });
  }

  profile() {
    throw new Error("Method not implemented.");
  }

  profileEnd() {
    throw new Error("Method not implemented.");
  }

  table(data) {
    this.#print({
      type: VirtualConsoleLogTypeEnum.table,
      level: VirtualConsoleLogLevelEnum.log,
      message: [data],
      group: this.#currentGroup(),
    });
  }

  time(label = "default") {
    this.#time[label] = performance.now();
  }

  timeEnd(label = "default") {
    const time = this.#time[label];
    if (time) {
      const duration = performance.now() - time;
      this.#print({
        type: VirtualConsoleLogTypeEnum.timeEnd,
        level: VirtualConsoleLogLevelEnum.info,
        message: [`${label}: ${duration}ms - timer ended`],
        group: this.#currentGroup(),
      });
    }
  }

  timeLog(label = "default", ...args) {
    const time = this.#time[label];
    if (time) {
      const duration = performance.now() - time;
      this.#print({
        type: VirtualConsoleLogTypeEnum.timeLog,
        level: VirtualConsoleLogLevelEnum.info,
        message: [`${label}: ${duration}ms`, ...args],
        group: this.#currentGroup(),
      });
    }
  }

  timeStamp() {
    throw new Error("Method not implemented.");
  }

  trace(message, ...args) {
    this.#print({
      type: VirtualConsoleLogTypeEnum.trace,
      level: VirtualConsoleLogLevelEnum.log,
      message: [
        ...(message ? [message, ...args] : args),
        new Error("stack").stack.replace("Error: stack", ""),
      ],
      group: this.#currentGroup(),
    });
  }

  warn(message, ...args) {
    this.#print({
      type: VirtualConsoleLogTypeEnum.warn,
      level: VirtualConsoleLogLevelEnum.warn,
      message: message ? [message, ...args] : args,
      group: this.#currentGroup(),
    });
  }
}
