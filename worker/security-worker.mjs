// Serve guarded assets and optionally the host app’s fixed decision endpoint.
// HTML deliberately does not exist in ASSETS, so an asset-first router cannot bypass its CSP.
export function createWorker(config, decide) {
  const paths = new Map(Object.entries(config.assets));
  const response = (body, status, extra = {}, method = 'GET') => new Response(method === 'HEAD' ? null : body, {
    status, headers: { ...config.headers, ...extra }, encodeBody: 'manual',
  });
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (decide && url.pathname === "/api/decide") return decide(request, env);
      if (!['GET', 'HEAD'].includes(request.method)) return response('Method not allowed', 405, { Allow: 'GET, HEAD' });
      if (config.pages.includes(url.pathname)) return response(config.html, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }, request.method);
      const asset = paths.get(url.pathname);
      if (!asset) return response('Not found', 404, { 'Content-Type': 'text/plain; charset=utf-8' }, request.method);
      url.pathname = asset.path; url.search = '';
      const upstream = await env.ASSETS.fetch(new Request(url, { method: request.method, headers: { 'Accept-Encoding': 'identity' } }));
      if (!upstream.ok) return response('Asset unavailable', 502);
      const headers = { 'Content-Type': asset.type, 'Cache-Control': 'public, max-age=31536000, immutable' };
      if (asset.gzip) headers['Content-Encoding'] = 'gzip';
      return response(upstream.body, 200, headers, request.method);
    },
  };
}
