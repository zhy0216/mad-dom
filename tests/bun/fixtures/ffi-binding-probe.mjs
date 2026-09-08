// Child-process document-binding probe (todo 03). Loads the Node-API binding,
// mints one document, and attempts to bind an FFI adapter to it. Prints whether
// the binding was granted and, when refused, the recorded image reason. Runs in
// a child because the loader caches its FFI state per process.
import { ffiCapabilityReport, ffiForDocument, loadNative, loadNativeFfi } from "../../../js/native-loader.js";

const report = loadNativeFfi();
const native = loadNative();
const document = native.createDocument();
let bound;
try {
  const binding = ffiForDocument(document);
  bound = binding !== null;
} finally {
  document.destroy();
}
console.log("BIND " + JSON.stringify({
  bunVersion: Bun.version,
  status: report.status,
  bound,
  imageReason: report.imageReason ?? null,
  imagePath: report.path ?? null,
}));
