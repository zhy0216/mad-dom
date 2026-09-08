import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import { sha256 } from "../../../../benchmark/bun-performance/protocol.mjs";
const directory = import.meta.dir;
const commands = JSON.parse(readFileSync(join(directory, "commands/commands.json"), "utf8"));
const passed = command => command.exitCode === 0 && command.signal === null && command.error === null;
for (const command of commands) for (const stream of ["stdout", "stderr"]) {
  assert.equal(sha256(readFileSync(join(directory, "commands", command[stream].file))), command[stream].sha256, "command output checksum changed");
}
for (let i = 1; i < commands.length; i++) assert.ok(Date.parse(commands[i].started) >= Date.parse(commands[i - 1].ended), "recorded task commands overlapped");
const required = [];
function requireCommand(label, lane, task = label) {
  const matching = commands.filter(c => c.label === label);
  assert.ok(matching.length, `missing ${label}`);
  const last = matching.at(-1);
  required.push({ lane, task, label, passed: passed(last),
    command: last.command, cwd: last.cwd, overrides: last.overrides, started: last.started, ended: last.ended,
    exitCode: last.exitCode, stdout: `commands/${last.stdout.file}`, stderr: `commands/${last.stderr.file}` });
}
for (const lane of ["baseline", "latest"]) for (const task of ["check", "runtime", "harness-tests", "dom-harness-tests", "boundary-selftest", "rewrite-prepare", "validate", "help",
  "final-reference-smoke", "final-source-on-smoke", "final-source-off-smoke"]) requireCommand(`${lane}-${task}`, lane, task);
for (const label of ["task-install", "task-build", "reference-install", "reference-build", "preserve-measured-harness", "post-campaign-integrity",
  "historical-gate-reference-copy", "latest-io-selftest", "latest-bench-check", "final-reference-integrity", "analyze-baseline"]) requireCommand(label);
const gates = {};
for (const lane of ["baseline", "latest"]) {
  const command = commands.find(c => c.label === `${lane}-validate`);
  const stdout = readFileSync(join(directory, "commands", command.stdout.file), "utf8");
  const stderr = readFileSync(join(directory, "commands", command.stderr.file), "utf8");
  const harnessCommand = commands.filter(c => c.label === `${lane}-harness-tests`).at(-1);
  const harness = readFileSync(join(directory, "commands", harnessCommand.stderr.file), "utf8");
  gates[lane] = { exitCode: command.exitCode,
    rustTestsPassed: [...stdout.matchAll(/test result: ok\. (\d+) passed;/g)].reduce((sum, match) => sum + Number(match[1]), 0),
    types: stdout.match(/totals: happy-dom.*fixtures.*\n/)?.[0]?.trim(),
    bunSummary: [...stderr.matchAll(/^ (\d+) pass\n (\d+) fail/gm)].map(m => ({ passed: Number(m[1]), failed: Number(m[2]) })),
    finalHarness: { passed: Number(harness.match(/ (\d+) pass\n/)?.[1]), failed: Number(harness.match(/ (\d+) fail\n/)?.[1]),
      assertions: Number(harness.match(/ (\d+) expect\(\) calls/)?.[1]), stderr: `commands/${harnessCommand.stderr.file}` },
    steps: ["bun run check", "cargo fmt --check", "cargo clippy --workspace --all-targets -- -D warnings", "cargo test --workspace",
      "bun run compat:types", "bun run test", "bun run compat:ledger", "bun run compat:hdunit:rewrite", "bun run compat:hdunit:validate", "bun run wpt:test"],
    note: "hdunit triage validates the existing declared states; this does not claim all upstream skipped/expected-fail tests passed" };
  assert.ok(gates[lane].rustTestsPassed > 0 && gates[lane].types);
  assert.deepEqual(gates[lane].finalHarness, { passed: 18, failed: 0, assertions: 102, stderr: `commands/${harnessCommand.stderr.file}` });
}
const batches = readdirSync(directory, { withFileTypes: true }).filter(d => d.isDirectory() && /^(baseline|latest)-/.test(d.name)).map(d => {
  const manifest = JSON.parse(readFileSync(join(directory, d.name, "manifest.json"), "utf8"));
  requireCommand(`verify-${d.name}`);
  return { directory: d.name, valid: manifest.valid, kind: manifest.protocol.kind, suites: manifest.protocol.suites,
    sizes: manifest.protocol.sizes, runs: manifest.protocol.runs, groups: manifest.protocol.groups, processes: manifest.attempts.length,
    audits: manifest.audits?.length ?? 0, command: manifest.command, started: manifest.started, ended: manifest.ended };
});
assert.equal(batches.length, 18, "missing final smoke or campaign batch");
for (const name of ["smoke-development-01", "diagnostic-development"]) requireCommand(`verify-${name}`);
const campaign = JSON.parse(readFileSync(join(directory, "campaign.json"), "utf8"));
assert.equal(campaign.batches.length, 4);
assert.equal(campaign.batches.reduce((n, b) => n + b.processes, 0), 160);
const profiles = JSON.parse(readFileSync(join(directory, "profiles.json"), "utf8"));
assert.equal(profiles.length, 12);
for (const profile of profiles) assert.equal(sha256(readFileSync(profile.path)), profile.sha256, "external CPU profile checksum changed");
assert.equal(JSON.parse(readFileSync(join(directory, "post-campaign-integrity.json"), "utf8")).passed, true);
const sampleFiles = Object.fromEntries([...batches.map(b => b.directory), "smoke-development-01", "diagnostic-development"].sort().flatMap(batch =>
  readdirSync(join(directory, batch)).sort().map(name => [`${batch}/${name}`, sha256(readFileSync(join(directory, batch, name)))])));
const inventory = { sha256: sha256(JSON.stringify(sampleFiles)), files: sampleFiles };
const inventoryPath = join(directory, "sample-files.json");
if (existsSync(inventoryPath)) assert.deepEqual(JSON.parse(readFileSync(inventoryPath, "utf8")), inventory, "saved sample inventory changed");
else writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2) + "\n");
const result = { generated: new Date().toISOString(), passed: required.every(c => c.passed) && batches.every(b => b.valid),
  required, gates, batches, failedCommands: commands.filter(c => c.exitCode !== 0 || c.signal !== null || c.error !== null),
  serialCommandTimeline: true, auditedLedgerEntries: commands.length, auditedLedgerPrefixSha256: sha256(JSON.stringify(commands)),
  fullCommandLedger: "commands/commands.json", ledgerNote: "The validation command is appended after this prefix is verified, avoiding a self-referential output checksum.",
  negativeCases: "report.test.js executes explicit bad timings, missing/changed provenance, skipped work, failed processes, protocol/config mismatch, untracked JS helpers and CLI rejection; final 18 tests / 102 assertions pass on each runtime",
  artifactChecks: "post-campaign-integrity.json", historicalGateLimitation: "historical-gate-reference.json: 19 existing Linux/x64 metrics, not a first-host recording; same OS/arch/Bun/Rust does not establish matching CPU/load" };
result.sampleInventory = { file: "sample-files.json", sha256: inventory.sha256, count: Object.keys(sampleFiles).length };
writeFileSync(join(directory, "validation.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ passed: result.passed, gates, batches: batches.length, failedCommands: result.failedCommands.length }));
if (!result.passed) process.exitCode = 1;
