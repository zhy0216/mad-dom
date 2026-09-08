import { ffiCapabilityReport, loadNativeFfi } from "../../../js/native-loader.js";

const report = loadNativeFfi();
const publicReport = ffiCapabilityReport();
console.log("PROBE " + JSON.stringify({
  bunVersion: Bun.version,
  status: report.status,
  code: report.code ?? null,
  reason: report.reason ?? null,
  abiVersion: report.abiVersion ?? null,
  expectedAbiVersion: report.expectedAbiVersion ?? null,
  advertisedCapabilities: report.advertisedCapabilities ?? null,
  capabilities: report.capabilities ?? null,
  symbols: report.symbols ?? [],
  missing: report.missing ?? [],
  publicStatus: publicReport.status,
}));
