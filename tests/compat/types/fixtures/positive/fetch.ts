// Positive fixture: the T46 fetch network surface.
// Covers: window.Headers / Request / Response / AbortController / AbortSignal
// and window.fetch — construction, the bodyUsed / clone surface, the
// redirect / error / json statics and abort. Must typecheck with ZERO
// diagnostics against BOTH dom-under-test targets. Instances are typed through
// function parameters so the fixture stays a pure signature check (no window
// construction on either target; `new Window()` is the package-entry path since
// T48E).
import { Window } from "dom-under-test";

function useFetchSurface(window: Window): void {
  // Headers construction and the read / mutation surface.
  const headers = new window.Headers({ "Content-Type": "application/json", "X-Custom": "1" });
  headers.set("X-Custom", "2");
  headers.append("X-Multi", "a");
  const headerValue: string | null = headers.get("X-Custom");
  const headerHas: boolean = headers.has("x-custom");
  const setCookies: string[] = headers.getSetCookie();
  const headerPairs: Array<[string, string]> = [...headers];

  // Request construction and the read surface.
  const request = new window.Request("https://mad-dom.test/api", {
    method: "POST",
    body: "hello",
    headers,
    credentials: "same-origin",
    mode: "cors",
    redirect: "follow",
  });
  const requestUrl: string = request.url;
  const requestMethod: string = request.method;
  const requestCredentials: "same-origin" | "omit" | "include" = request.credentials;
  const requestMode: "navigate" | "same-origin" | "no-cors" | "cors" | "websocket" = request.mode;
  const requestBodyUsed: boolean = request.bodyUsed;
  const requestReferrer: string = request.referrer;
  const requestHasBody: boolean = request.body !== null;
  const requestText: Promise<string> = request.text();
  const requestJson: Promise<unknown> = request.json();
  const clonedRequest = request.clone();

  // Response construction, statics and the read surface.
  const response = new window.Response("hello", {
    status: 201,
    statusText: "Created",
    headers: { "X-A": "1" },
  });
  const responseStatus: number = response.status;
  const responseOk: boolean = response.ok;
  const responseText: Promise<string> = response.text();
  const responseJson: Promise<unknown> = response.json();
  const responseClone = response.clone();
  const redirectResponse = window.Response.redirect("https://mad-dom.test/next", 302);
  const errorResponse = window.Response.error();
  const jsonResponse = window.Response.json({ a: 1 }, { status: 201 });

  // AbortController / AbortSignal.
  const controller = new window.AbortController();
  const signal = controller.signal;
  const aborted: boolean = signal.aborted;
  const reason: unknown = signal.reason;
  signal.addEventListener("abort", () => {});
  controller.abort("canceled");
  signal.throwIfAborted();
  const preAborted = window.AbortSignal.abort("boom");

  // window.fetch returns a Promise<Response>; the response surface is
  // reached through the resolved value.
  const fetched = window.fetch("https://mad-dom.test/api", {
    method: "GET",
    signal: preAborted,
  });
  const fetchedStatus: Promise<number> = fetched.then((response) => response.status);
  const fetchedOk: Promise<boolean> = fetched.then((response) => response.ok);
  const fetchedUrl: Promise<string> = fetched.then((response) => response.url);

  const result = {
    headerValue,
    headerHas,
    setCookies,
    headerPairs,
    requestUrl,
    requestMethod,
    requestCredentials,
    requestMode,
    requestBodyUsed,
    requestReferrer,
    requestHasBody,
    requestText,
    requestJson,
    clonedRequest,
    responseStatus,
    responseOk,
    responseText,
    responseJson,
    responseClone,
    redirectResponse,
    errorResponse,
    jsonResponse,
    aborted,
    reason,
    fetchedStatus,
    fetchedOk,
    fetchedUrl,
  };
  void result;
}
