#!/usr/bin/env bun
// Failure-safe diagnostics, also used in a fresh process for each binary.
import { runtimeObservation, runtimeContract } from "../js/runtime-metadata.js";
import { collectCapabilities } from "./bun-capability-probe.mjs";

const report = {
  schema: "mad-dom/runtime-report/1",
  lane: process.env.MAD_DOM_CI_LANE ?? "local",
  selection: process.env.MAD_DOM_CI_LANE === "latest" ? "setup-bun bun-version: latest" :
    process.env.MAD_DOM_CI_LANE === "baseline" ? ".bun-version" : "local executable; no latest claim",
  contract: runtimeContract((await Bun.file(new URL("../package.json", import.meta.url)).json()).version),
  ...runtimeObservation(),
  capabilityMatrix: await collectCapabilities(),
};
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--require-native") && report.nodeApi.status !== "available") process.exitCode = 1;
