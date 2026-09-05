import { spawnSync } from "node:child_process";

// Child `bun` script for the sync send path: performs the fetch and prints a
// JSON envelope (status / statusText / final URL / raw headers / base64 body).
const SYNC_FETCH_SCRIPT = `
const payload = JSON.parse(process.argv[1]);
const { method, url, headers, body, credentials, referrer } = payload;
(async () => {
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body === null ? undefined : Buffer.from(body, "base64"),
      redirect: "follow",
    });
    const bodyBuffer = Buffer.from(await response.arrayBuffer());
    const headerEntries = {};
    for (const [key, value] of response.headers) headerEntries[key] = value;
    console.log(JSON.stringify({
      ok: true,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      headers: headerEntries,
      body: bodyBuffer.toString("base64"),
    }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.message }));
  }
})();
`;

export function syncFetch(windowFacade, method, url, requestHeaders, body) {
  const payload = {
    method,
    url,
    headers: Object.fromEntries(requestHeaders),
    body: body === null ? null : Buffer.from(body).toString("base64"),
  };
  const proc = spawnSync(process.execPath, ["-e", SYNC_FETCH_SCRIPT, JSON.stringify(payload)], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (proc.error) {
    throw new windowFacade.DOMException(`Failed to execute "send()": ${proc.error.message}`, "NetworkError");
  }
  const result = JSON.parse(proc.stdout);
  if (!result.ok) {
    throw new windowFacade.DOMException(`Failed to execute "send()": ${result.error}`, "NetworkError");
  }
  return result;
}
