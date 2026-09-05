import { promises as FS } from "node:fs";
import { join as pathJoin, resolve as pathResolve, sep as pathSep } from "node:path";

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
export async function virtualServerResponse(virtualServers, requestURL, locationOrigin) {
  if (!virtualServers) return null;
  const filePath = virtualServerFilepath(virtualServers, requestURL, locationOrigin);
  if (filePath === null) return null;
  let buffer;
  try {
    const stat = await FS.stat(filePath);
    const resolvedPath = stat.isDirectory() ? pathJoin(filePath, "index.html") : filePath;
    buffer = await FS.readFile(resolvedPath);
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
