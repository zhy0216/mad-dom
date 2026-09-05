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
    owner = new WindowTasks();
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

  start(cancel = () => {}) {
    if (this.closed) {
      cancel();
      throw new Error("The window is closed.");
    }
    if (this.#idleTimer !== null) hostClearTimeout(this.#idleTimer);
    this.#idleTimer = null;
    const token = {};
    this.#tasks.set(token, cancel);
    return token;
  }

  end(token) {
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
    return new Promise((resolve) => {
      this.#waiters.push(resolve);
      this.#checkIdle();
    });
  }

  #checkIdle() {
    if (this.#tasks.size || !this.#waiters.length || this.#idleTimer !== null) return;
    this.#idleTimer = hostSetTimeout(() => {
      this.#idleTimer = null;
      if (this.#tasks.size) return;
      const waiters = this.#waiters.splice(0);
      for (const resolve of waiters) resolve();
    }, 1);
  }

  abort(close = false) {
    this.closed ||= close;
    this.generation++;
    const tasks = this.#tasks;
    this.#tasks = new Map();
    for (const [id, immediate] of this.timers) {
      (immediate ? hostClearImmediate : hostClearTimeout)(id);
    }
    this.timers.clear();
    for (const cancel of tasks.values()) cancel();
    return this.waitUntilComplete();
  }
}
