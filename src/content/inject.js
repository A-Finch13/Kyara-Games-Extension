// Runs in the page itself: forwards the Kyara API answers the extension cares about to content.js.
// Nothing is sent anywhere else and no request is changed.
(() => {
  if (window.__kyaraGamesHook) return;
  window.__kyaraGamesHook = true;

  const READ = [
    /^\/me$/,
    /^\/me\/bootstrap$/,
    /^\/me\/collection$/,
    /^\/me\/friends\/[^/]+\/collection$/,
    /^\/trades\/available\/[^/]+$/,
    /^\/trades\/owned\/[^/]+$/,
    /^\/users\/[^/]+$/
  ];
  // Writes after which the collection is no longer what the extension has cached.
  const WRITE = /^\/(packs\/[^/]+\/open(-many)?|trades(\/.*)?|market\/.*|me\/collection\/.*|me\/progress\/claim|me\/alt\/settle)$/;

  const original = window.fetch;
  window.fetch = async function (input, init) {
    const res = await original.apply(this, arguments);
    try {
      const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href);
      if (url.origin !== location.origin || !url.pathname.startsWith('/api/') || !res.ok) return res;
      const path = url.pathname.slice(4);
      const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (method === 'GET' && READ.some((r) => r.test(path))) {
        res.clone().json().then(
          (body) => window.postMessage({ __kyaraGames: 1, kind: 'read', path, body }, location.origin),
          () => {}
        );
      } else if (method !== 'GET' && WRITE.test(path)) {
        window.postMessage({ __kyaraGames: 1, kind: 'write', path }, location.origin);
      }
    } catch {}
    return res;
  };
})();
