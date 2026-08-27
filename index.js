export const project = Object.freeze({
  name: "mad-dom",
  version: "0.0.1-alpha.0",
  status: "pre-alpha",
  runtime: "bun",
  architecture: "native-memory-arena"
});

export function createWindow() {
  throw new Error("mad-dom is in pre-alpha development and does not implement Window yet.");
}
