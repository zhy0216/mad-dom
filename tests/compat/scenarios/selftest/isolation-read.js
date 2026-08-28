// Self-test pass scenario (T10): runs in its own fresh probe process and must
// observe NO global pollution left behind by other scenarios (in particular
// selftest-isolation-write). A leaked value here means the runner is reusing
// processes and violating the isolation contract.
export const id = "selftest-isolation-read";
export const description = "self-test pass: asserts its probe process is unpolluted by other scenarios' globalThis writes";
export const targets = "mock";

export async function run(api) {
  api.record.value("pollution-detected", globalThis.__madDomDifferentialPollution ?? null);
}
