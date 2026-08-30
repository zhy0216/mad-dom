// Minimal WPT testharness.js shim (T48).
//
// A small, self-contained re-implementation of the subset of the upstream
// web-platform-tests testharness.js API that the vendored cases under
// tests/wpt/cases use. It is deliberately not a full testharness port: it only
// implements the synchronous `test`/`setup`, the promise forms
// (`async_test`/`promise_test`), the common assertion helpers and the result
// collection the runner (runner.js) turns into the separate WPT statistics
// report. WPT pass rate is reported independently and is not a happy-dom
// compatibility gate (ADR-0002 section 8).
//
// Each case runs in its own isolated harness instance (`createHarness`), so a
// failure in one file never leaks into another.

const STATE_PASS = "pass";
const STATE_FAIL = "fail";
const STATE_ERROR = "error";

function describeError(error) {
  if (error === null || error === undefined) return String(error);
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function formatValue(value) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(formatValue).join(", ")}]`;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function makeAssertions(harness) {
  function fail(message) {
    throw new AssertionError(message ?? "assertion failed");
  }

  function assert(condition, message) {
    if (!condition) fail(message ?? "assertion failed");
    return condition;
  }

  function assertTrue(actual, message) {
    assert(actual === true, message ?? `assert_true: expected true, got ${formatValue(actual)}`);
  }

  function assertFalse(actual, message) {
    assert(actual === false, message ?? `assert_false: expected false, got ${formatValue(actual)}`);
  }

  function assertEquals(actual, expected, message) {
    if (actual !== expected) {
      fail(
        message ??
          `assert_equals: expected ${formatValue(expected)}, got ${formatValue(actual)}`,
      );
    }
  }

  function assertNotEquals(actual, unexpected, message) {
    if (actual === unexpected) {
      fail(
        message ?? `assert_not_equals: did not expect ${formatValue(unexpected)}`,
      );
    }
  }

  function assertArrayEquals(actual, expected, message) {
    // WPT's assert_array_equals accepts any iterable / array-like (NodeList,
    // live collections included); coerce both sides before comparing.
    let actualArray;
    let expectedArray;
    try {
      actualArray = Array.from(actual);
    } catch {
      fail(message ?? "assert_array_equals: first argument is not iterable");
    }
    try {
      expectedArray = Array.from(expected);
    } catch {
      fail(message ?? "assert_array_equals: second argument is not iterable");
    }
    if (actualArray.length !== expectedArray.length) {
      fail(
        message ??
          `assert_array_equals: lengths differ (${actualArray.length} vs ${expectedArray.length}): ${formatValue(
            actualArray,
          )}`,
      );
    }
    for (let index = 0; index < expectedArray.length; index += 1) {
      if (actualArray[index] !== expectedArray[index]) {
        fail(
          message ??
            `assert_array_equals: element ${index} differs — expected ${formatValue(
              expectedArray[index],
            )}, got ${formatValue(actualArray[index])}`,
        );
      }
    }
  }

  function assertOwnProperty(object, property, message) {
    if (!Object.prototype.hasOwnProperty.call(object, property)) {
      fail(
        message ?? `assert_own_property: ${formatValue(property)} is not an own property`,
      );
    }
  }

  function assertInherits(object, property, message) {
    const proto = Object.getPrototypeOf(object);
    if (
      proto === null ||
      proto === Object.prototype ||
      !Object.prototype.hasOwnProperty.call(proto, property)
    ) {
      fail(
        message ?? `assert_inherits: ${formatValue(property)} is not inherited`,
      );
    }
  }

  function assertThrows(nativeErrorType, func, description) {
    const thrower = func;
    let thrown = null;
    try {
      thrower();
    } catch (error) {
      thrown = error;
    }
    if (thrown === null) {
      fail(`assert_throws: function did not throw (${description ?? ""})`);
    }
    if (!(thrown instanceof nativeErrorType)) {
      fail(
        `assert_throws: expected ${nativeErrorType?.name}, got ${thrown.constructor?.name} (${describeError(
          thrown,
        )})`,
      );
    }
    return thrown;
  }

  function assertThrowsDom(code, func, description) {
    const thrower = func;
    let thrown = null;
    try {
      thrower();
    } catch (error) {
      thrown = error;
    }
    if (thrown === null) {
      fail(`assert_throws_dom: function did not throw (${description ?? ""})`);
    }
    if (typeof code === "object" && code !== null) {
      // WPT passes { name, message } on older tests; this subset only uses the
      // name-string form, but accept the object form defensively.
      const expectedName = code.name;
      if (thrown.name !== expectedName) {
        fail(
          `assert_throws_dom: expected name ${expectedName}, got ${thrown.name} (${describeError(
            thrown,
          )})`,
        );
      }
    } else if (thrown.name !== String(code)) {
      fail(
        `assert_throws_dom: expected ${String(code)}, got ${thrown.name} (${describeError(
          thrown,
        )})`,
      );
    }
    return thrown;
  }

  function assertUnreached(description) {
    fail(`assert_unreached: reached unreachable code${description ? ` (${description})` : ""}`);
  }

  return {
    fail,
    assert,
    assert_true: assertTrue,
    assert_false: assertFalse,
    assert_equals: assertEquals,
    assert_not_equals: assertNotEquals,
    assert_array_equals: assertArrayEquals,
    assert_own_property: assertOwnProperty,
    assert_inherits: assertInherits,
    assert_throws: assertThrows,
    assert_throws_dom: assertThrowsDom,
    assert_unreached: assertUnreached,
    format_value: formatValue,
  };
}

class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = "AssertionError";
  }
}

/**
 * Creates one isolated testharness instance for a single case file.
 *
 * Returns the testharness surface (setup / test / async_test / promise_test /
 * the assertions / format_value) and a `results()` accessor the runner reads
 * after the case body has run.
 */
export function createHarness() {
  const results = [];
  const assertions = makeAssertions();
  let setupError = null;
  let pendingCount = 0;

  function record(state, name, message) {
    results.push({ state, name: String(name ?? ""), message: message ?? null });
  }

  function runStep(step) {
    return step();
  }

  class AsyncTest {
    constructor(name) {
      this.name = String(name ?? "");
      this.doneCalled = false;
      this.phase = "pending";
      pendingCount += 1;
    }

    settle() {
      if (this.doneCalled) return;
      this.doneCalled = true;
      pendingCount -= 1;
    }

    step(stepFn) {
      if (this.phase === "failed" || this.phase === "done") return;
      try {
        runStep(stepFn);
      } catch (error) {
        this.phase = "failed";
        record(STATE_FAIL, this.name, describeError(error));
      }
    }

    step_func(stepFn) {
      return (value) => this.step(() => stepFn(value));
    }

    done() {
      if (this.doneCalled) return;
      this.settle();
      if (this.phase === "failed") return;
      if (setupError !== null) {
        this.phase = "error";
        record(STATE_ERROR, this.name, setupError);
        return;
      }
      this.phase = "done";
      record(STATE_PASS, this.name, null);
    }

    fail(error) {
      if (this.doneCalled) return;
      this.settle();
      this.phase = "failed";
      record(STATE_FAIL, this.name, describeError(error));
    }

    // WPT calls t.unreached_func / t.force_timeout rarely; provide a safe
    // unreached helper for the cases that reference it.
    unreached_func(description) {
      return () => this.fail(new Error(`unreached${description ? `: ${description}` : ""}`));
    }
  }

  function test(fn, name) {
    if (setupError !== null) {
      record(STATE_ERROR, String(name ?? ""), setupError);
      return;
    }
    try {
      const result = fn();
      if (result !== null && typeof result === "object" && typeof result.then === "function") {
        // A promise-returning test: treat it like a promise_test.
        const asyncTest = new AsyncTest(name);
        result.then(
          () => asyncTest.done(),
          (error) => asyncTest.fail(error),
        );
        return asyncTest;
      }
      record(STATE_PASS, String(name ?? ""), null);
    } catch (error) {
      record(STATE_FAIL, String(name ?? ""), describeError(error));
    }
  }

  function async_test(fn, name) {
    const asyncTest = new AsyncTest(name);
    if (setupError !== null) {
      asyncTest.fail(new Error(setupError));
      return asyncTest;
    }
    try {
      fn(asyncTest);
    } catch (error) {
      asyncTest.fail(error);
    }
    return asyncTest;
  }

  function promise_test(fn, name) {
    const asyncTest = new AsyncTest(name);
    if (setupError !== null) {
      asyncTest.fail(new Error(setupError));
      return asyncTest;
    }
    Promise.resolve()
      .then(() => fn(asyncTest))
      .then(
        () => asyncTest.done(),
        (error) => asyncTest.fail(error),
      );
    return asyncTest;
  }

  function setup(fn) {
    if (typeof fn !== "function") return;
    try {
      fn();
    } catch (error) {
      setupError = describeError(error);
      record(STATE_ERROR, "setup", setupError);
    }
  }

  function done() {}

  return {
    setup,
    test,
    async_test,
    promise_test,
    done,
    ...assertions,
    results,
    get pending() {
      return pendingCount;
    },
  };
}
