// One task owner per Window. Idle checks use captured host timers so fake
// window timers cannot prevent teardown or swallow a completion checkpoint.
const hostSetTimeout = globalThis.setTimeout.bind(globalThis);
const hostClearTimeout = globalThis.clearTimeout.bind(globalThis);
const hostClearImmediate = globalThis.clearImmediate.bind(globalThis);
const OWNERS = new WeakMap();
const FINALIZE = new FinalizationRegistry((timers) => {
  for (const [id, immediate] of timers) {
    (immediate ? hostClearImmediate : hostClearTimeout)(id);
  }
  timers.clear();
});

export function windowTasks(window) {
  let owner = OWNERS.get(window);
  if (!owner) {
    owner = new WindowTasks(new WeakRef(window));
    OWNERS.set(window, owner);
    // The held value contains handles only, never callbacks, listeners,
    // promise reactions or anything else that can retain the window.
    FINALIZE.register(window, owner.timers);
  }
  return owner;
}

class WindowTasks {
  closed = false;
  generation = 0;
  timers = new Map();
  #tasks = new Map();
  #waiters = [];
  #idleTimer = null;
  #debugTimer = null;
  #traces = new Map();
  #window;

  constructor(window) { this.#window = window; }

  start(cancel = () => {}) {
    if (this.closed) {
      cancel();
      throw new Error("The window is closed.");
    }
    if (this.#idleTimer !== null) hostClearTimeout(this.#idleTimer);
    this.#idleTimer = null;
    const token = {};
    this.#tasks.set(token, cancel);
    if (this.#debugLimit() > 0) this.#traces.set(token, new Error().stack);
    return token;
  }

  end(token) {
    this.#traces.delete(token);
    if (this.#tasks.delete(token)) this.#checkIdle();
  }

  track(promise, cancel) {
    const token = this.start(cancel);
    // Do not turn a failed operation into a successful result. Waiting is an
    // idle barrier; the caller's original promise still carries its rejection.
    Promise.resolve(promise).then(() => this.end(token), () => this.end(token));
    return promise;
  }

  waitUntilComplete() {
    return new Promise((resolve, reject) => {
      this.#waiters.push({ resolve, reject });
      this.#checkIdle();
      const limit = this.#debugLimit();
      if (limit > 0 && this.#debugTimer === null) {
        this.#debugTimer = hostSetTimeout(() => {
          this.#debugTimer = null;
          const error = new Error(`The maximum time was reached for "waitUntilComplete()".\n\n${this.#tasks.size} tasks did not end in time.\n\nThe following traces were recorded:\n\n${[...this.#traces.values()].join("\n\n")}`);
          for (const waiter of this.#waiters.splice(0)) waiter.reject(error);
          void this.abort();
        }, limit);
      }
    });
  }

  #debugLimit() {
    return this.#window.deref()?.happyDOM.settings.debug.traceWaitUntilComplete ?? -1;
  }

  #checkIdle() {
    if (this.#tasks.size || !this.#waiters.length || this.#idleTimer !== null) return;
    this.#idleTimer = hostSetTimeout(() => {
      this.#idleTimer = null;
      if (this.#tasks.size) return;
      if (this.#debugTimer !== null) hostClearTimeout(this.#debugTimer);
      this.#debugTimer = null;
      const waiters = this.#waiters.splice(0);
      for (const waiter of waiters) waiter.resolve();
    }, 1);
  }

  abort(close = false) {
    this.closed ||= close;
    this.generation++;
    const tasks = this.#tasks;
    this.#tasks = new Map();
    this.#traces.clear();
    for (const [id, immediate] of this.timers) {
      (immediate ? hostClearImmediate : hostClearTimeout)(id);
    }
    this.timers.clear();
    for (const cancel of tasks.values()) cancel();
    return this.waitUntilComplete();
  }
}
