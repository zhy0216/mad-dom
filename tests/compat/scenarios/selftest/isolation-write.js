// Self-test pass scenario (T10): pollutes globalThis inside its own probe
// process. The companion scenario selftest-isolation-read asserts, in a fresh
// probe process, that this pollution does not leak (subprocess isolation of
// ADR-0002 section 5.2). The runner report carries the probe pids; the T10
// bun test asserts that the two scenarios ran in different processes.
export const id = "selftest-isolation-write";
export const description = "self-test pass: writes globalThis pollution inside its probe process (isolation proven by selftest-isolation-read)";
export const targets = "mock";

export async function run(api) {
  globalThis.__madDomDifferentialPollution = true;
  api.record.value("pollution-set", globalThis.__madDomDifferentialPollution === true);
}
