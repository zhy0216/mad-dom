import { Browser } from "happy-dom";

const browser = new Browser({
    fetch: {
        requestHeaders: [
            {
                url: /^https:\/\/example.com\/[a-z]{2}\/[a-z]{2}\//,
                headers: {
                    'X-Custom-Header': 'CustomValue'
                }
            }
        ]
    }
});
