// Real differential scenario (T47): the window timer / task-scheduling surface.
//
// Probes only the deterministic observable surface: the timer method types, a
// `setTimeout` callback receiving its extra args, `clearTimeout` /
// `clearInterval` / `cancelAnimationFrame` cancelling, an interval repeating
// until cleared, `requestAnimationFrame` passing a finite numeric timestamp,
// `queueMicrotask` firing, the microtask-before-macrotask ordering boundary and
// the window `error` event an async callback failure dispatches. Raw timer ids
// are never recorded (their host object shapes differ between the two
// implementations); only the behavior they produce is compared. Delays are
// well separated and waits generous so the observations are scheduling-stable.
export const id = "dom-timers";
export const description = "real differential: setTimeout/clearTimeout/setInterval/clearInterval/requestAnimationFrame/cancelAnimationFrame/queueMicrotask surface, cancellation and the window error event";
export const targets = "real";

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = typeof entry.createWindow === "function" ? entry.createWindow() : new entry.Window();
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }

  const document = window.document;

  try {
    // --- surface: every baseline timer method exists ------------------------
    {
      const surface = {};
      for (const name of [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "queueMicrotask",
      ]) {
        surface[name] = typeof window[name];
      }
      api.record.value("surface", surface);
    }

    // --- setTimeout fires with the extra args and clearTimeout cancels ------
    {
      const calls = [];
      window.setTimeout((a, b) => calls.push([a, b]), 5, 1, "x");
      await wait(40);
      api.record.value("settimeout-args", calls);

      const cancelled = [];
      const id = window.setTimeout(() => cancelled.push("fired"), 5);
      window.clearTimeout(id);
      await wait(30);
      api.record.value("cleartimeout-cancels", cancelled.length);
    }

    // --- setInterval repeats until clearInterval ----------------------------
    {
      const ticks = [];
      const id = window.setInterval((n) => ticks.push(n), 10, 7);
      await wait(45);
      const countAtClear = ticks.length;
      window.clearInterval(id);
      await wait(40);
      api.record.value("interval-arg", ticks[0]);
      api.record.value("interval-count-at-clear", countAtClear >= 2);
      api.record.value("interval-stopped-after-clear", ticks.length === countAtClear);
    }

    // --- requestAnimationFrame passes a numeric timestamp; cancel works -----
    {
      const fired = [];
      const cancelled = [];
      window.requestAnimationFrame((timestamp) => fired.push([typeof timestamp, Number.isFinite(timestamp)]));
      const id = window.requestAnimationFrame(() => cancelled.push("fired"));
      window.cancelAnimationFrame(id);
      await wait(30);
      api.record.value("raf-fired", fired);
      api.record.value("raf-cancelled", cancelled.length);
    }

    // --- queueMicrotask fires on the microtask queue ------------------------
    {
      const order = [];
      window.queueMicrotask(() => order.push("qm"));
      await wait(20);
      api.record.value("queue-microtask-fired", order);
    }

    // --- microtask before macrotask boundary --------------------------------
    {
      const order = [];
      order.push("sync");
      Promise.resolve().then(() => order.push("promise"));
      window.setTimeout(() => order.push("timer"), 0);
      await wait(30);
      api.record.value("microtask-before-timer", order);
    }

    // --- a throwing timer callback dispatches a window error event ----------
    {
      const events = [];
      window.addEventListener("error", (event) => {
        events.push({
          type: event.type,
          message: event.message,
          errorName: event.error?.name,
          errorMessage: event.error?.message,
        });
      });
      window.setTimeout(() => {
        throw new Error("timer boom");
      }, 5);
      await wait(40);
      api.record.value("timer-error-event", events);
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
