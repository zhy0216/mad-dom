import { Window } from "happy-dom";

const window = new Window({
   settings: {
      fetch: {
         interceptor: {
            beforeAsyncRequest: async ({ request, window }) => {
               if (request.url === "https://example.com") {
                  return new window.Response("Hello World");
               }
            },
            beforeSyncRequest: ({ request, window }) => {
               if (request.url === "https://example.com") {
                  return {
                     status: 200,
                     statusText: "OK",
                     ok: true,
                     url: "https://example.com",
                     redirected: false,
                     headers: new window.Headers(),
                     body: Buffer.from("Hello World"),
                  };
               }
            },
            afterAsyncResponse: async ({ request, response, window }) => {
               if (request.url === "https://example.com") {
                  return new window.Response("Hello World");
               }
            },
            afterSyncResponse: ({ request, response, window }) => {
               if (request.url === "https://example.com") {
                  return {
                     status: 200,
                     statusText: "OK",
                     ok: true,
                     url: "https://example.com",
                     redirected: false,
                     headers: new window.Headers(),
                     body: Buffer.from("Hello World"),
                  };
               }
            },
         }
      }
   }
});
