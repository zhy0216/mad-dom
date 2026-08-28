// Deliberately divergent self-test scenario (T10).
//
// This scenario is EXPECTED to produce differences between the mock-pass and
// mock-fail targets; it exists to prove the comparator fires and localizes
// them. It lives under selftest/divergent/ so directory walks skip it; the
// T10 bun test passes it to the runner explicitly and asserts the exact
// difference paths:
//
//   errors[0].phase   — mock-pass throws synchronously ("sync-throw"),
//                       mock-fail rejects the same error ("promise-rejection")
//                       with identical name/message (seeded bug 2);
//   errors[1].name    — mock-fail rejects with "MockFailureError" instead of
//                       "Error" (seeded bug 3);
//   errors[1].message — mock-fail's divergent rejection message (bug 3);
//   values.sync-mode  — the observable delivery mode differs accordingly.
export const id = "selftest-error-shape";
export const description = "deliberately divergent: throw phase (sync vs rejection) and async error name/message differ between the mock targets";
export const targets = "mock";

export async function run(api) {
  let syncError = null;
  let syncOutcome;
  try {
    // A method may throw synchronously or return a promise; keep the result
    // so a returned thenable is always awaited (a discarded rejection would
    // kill the probe before the phase difference can be observed).
    syncOutcome = api.dom.throwSync();
  } catch (error) {
    syncError = error;
  }
  if (syncError !== null) {
    api.record.error(syncError, "sync-throw");
    api.record.value("sync-mode", "threw-synchronously");
  } else {
    try {
      await syncOutcome;
      api.record.value("sync-mode", "resolved");
    } catch (error) {
      api.record.error(error, "promise-rejection");
      api.record.value("sync-mode", "rejected-as-promise");
    }
  }

  try {
    await api.dom.throwAsync();
    api.record.value("async-mode", "resolved");
  } catch (error) {
    api.record.error(error, "promise-rejection");
    api.record.value("async-mode", "rejected");
  }
}
