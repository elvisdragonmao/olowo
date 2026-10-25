export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Proxy the olowo API through the web origin so the HttpOnly session cookie is first-party.
    if (url.pathname.startsWith("/v1/") && env.API_ORIGIN) {
      const target = new URL(url.pathname + url.search, env.API_ORIGIN);
      return fetch(new Request(target, request));
    }

    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");

    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) {
      return response;
    }

    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};
