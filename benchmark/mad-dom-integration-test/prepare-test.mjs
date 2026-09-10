// Generates this package's test/ from the canonical happy-dom copy with the
// engine specifier rewritten, so the two suites cannot drift.
import { cpSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const source = join(import.meta.dir, "..", "happy-dom-integration-test", "test");
const target = join(import.meta.dir, "test");

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });

function rewrite(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      rewrite(path);
      continue;
    }
    const text = readFileSync(path, "utf8");
    const rewritten = text
      .replaceAll("from 'happy-dom'", "from 'mad-dom'")
      .replaceAll('from "happy-dom"', 'from "mad-dom"')
      .replaceAll("require('happy-dom')", "require('mad-dom')")
      .replaceAll('require("happy-dom")', 'require("mad-dom")');
    if (rewritten !== text) writeFileSync(path, rewritten);
  }
}
rewrite(target);
console.log(`generated ${target} from happy-dom-integration-test`);
