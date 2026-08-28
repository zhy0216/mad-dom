// Self-test pass scenario (T10): raw value normalization classes and a stable
// event sequence. Runs against the mock target pair; both variants implement
// describePrimitives()/emitSequence() identically, so the normalized records
// must be equal — a difference here means the runner pipeline itself is broken.
export const id = "selftest-primitives-events";
export const description = "self-test pass: raw value classes (numbers/strings/symbols/functions/structures) and stable event order";
export const targets = "mock";

export async function run(api) {
  const values = api.dom.describePrimitives();
  for (const key of Object.keys(values).sort()) {
    api.record.value(key, values[key]);
  }
  api.dom.emitSequence((name, detail) => api.record.event(name, detail));
}
