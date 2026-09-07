import { promises as FS } from "node:fs";
import { join as pathJoin, resolve as pathResolve, sep as pathSep } from "node:path";

import { bunHostIO } from "./bun-host-io.js";

// --- virtual servers (mirrors happy-dom VirtualServerUtility) -----------------

// The happy-dom virtual-server 404 page (byte-identical `NOT_FOUND_HTML`).
const VIRTUAL_SERVER_NOT_FOUND_HTML =
  '<html><head><title>Happy DOM Virtual Server - 404 Not Found</title></head><body><h1>Happy DOM Virtual Server - 404 Not Found</h1></body></html>';

// The filesystem path a request URL maps to under a matching virtual server
// (happy-dom `VirtualServerUtility.getFilepath` parity): a string `url`
// matches by prefix (trailing slash stripped), a `RegExp` by match; the
// remainder of the request URL — query / fragment stripped — is joined under
// the resolved directory.
export function virtualServerFilepath(virtualServers, requestURL, locationOrigin) {
  for (const virtualServer of virtualServers) {
    let baseURL = null;
    if (typeof virtualServer.url === "string") {
      const url = new URL(
        virtualServer.url[virtualServer.url.length - 1] === "/"
          ? virtualServer.url.slice(0, -1)
          : virtualServer.url,
        locationOrigin !== "null" ? locationOrigin : undefined,
      );
      if (requestURL.startsWith(url.href)) {
        baseURL = url;
      }
    } else if (virtualServer.url instanceof RegExp) {
      const match = requestURL.match(virtualServer.url);
      if (match) {
        // Bun validates the base even for an absolute input (Node ignores it),
        // so an `about:blank` origin ("null") is dropped like in the string
        // case above.
        baseURL = new URL(
          match[0][match[0].length - 1] === "/" ? match[0].slice(0, -1) : match[0],
          locationOrigin !== "null" ? locationOrigin : undefined,
        );
      }
    }
    if (baseURL !== null) {
      const path = requestURL.slice(baseURL.href.length).split("?")[0].split("#")[0];
      return pathJoin(pathResolve(virtualServer.directory), path.replaceAll("/", pathSep));
    }
  }
  return null;
}

// The `Response` a virtual-server request resolves to (happy-dom
// `Fetch.getVirtualServerResponse` parity): a directory serves its
// `index.html`, a missing file serves the 404 page, and `url` is always the
// request URL. Returns `null` when no virtual server matches.
//
// File reads go through `Bun.file(path).arrayBuffer()` and the directory
// probe through `Bun.file(path).stat()` (both expose `isDirectory()`) when the
// host-IO capability is available (T5); `node:fs` remains the fallback for
// each step. Every capability is probed independently — a runtime whose
// `Bun.file` lacks `stat` still gets the node:fs directory probe — so the
// directory → `index.html` resolution and the 404 / URL / content-type
// observables are identical on either path.
export async function virtualServerResponse(virtualServers, requestURL, locationOrigin) {
  if (!virtualServers) return null;
  const filePath = virtualServerFilepath(virtualServers, requestURL, locationOrigin);
  if (filePath === null) return null;
  let buffer;
  try {
    const stat = await fileStat(filePath);
    const resolvedPath = stat.isDirectory() ? pathJoin(filePath, "index.html") : filePath;
    buffer = bunHostIO("file")
      ? await Bun.file(resolvedPath).arrayBuffer()
      : await FS.readFile(resolvedPath);
  } catch {
    const notFound = new Response(VIRTUAL_SERVER_NOT_FOUND_HTML, {
      status: 404,
      statusText: "Not Found",
      headers: { "Content-Type": "text/html" },
    });
    Object.defineProperty(notFound, "url", { value: requestURL, enumerable: true });
    return notFound;
  }
  const response = new Response(buffer);
  Object.defineProperty(response, "url", { value: requestURL, enumerable: true });
  return response;
}

// Directory probe: `Bun.file#stat()` when the file capability is available and
// the runtime exposes it on the file object; otherwise `node:fs` stat. Both
// resolve to a stat with `isDirectory()`, so the resolved path and the 404
// behavior do not depend on which transport ran.
async function fileStat(filePath) {
  if (bunHostIO("file")) {
    const bunFile = Bun.file(filePath);
    if (typeof bunFile.stat === "function") {
      return await bunFile.stat();
    }
  }
  return FS.stat(filePath);
}
