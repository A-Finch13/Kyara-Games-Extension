// Userscript version: the few extension APIs the page code uses, rebuilt on top of the page itself.
// Storage lives in the site's localStorage under "kyx:" (kept in memory when it is full);
// messages to the background worker are answered by handle() in bridge.js, in the same page.
const KYX_OWNER = 'userscript';

const chrome = (() => {
  const PREFIX = 'kyx:';
  const memory = new Map();
  const listeners = [];

  const read = (key) => {
    if (memory.has(key)) return memory.get(key);
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw != null) {
        const value = JSON.parse(raw);
        memory.set(key, value);
        return value;
      }
    } catch {}
    return undefined;
  };
  const write = (key, value) => {
    memory.set(key, value);
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {} // full: the value stays for this page
  };
  const drop = (key) => {
    memory.delete(key);
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {}
  };
  const emit = (changes) => {
    if (!Object.keys(changes).length) return;
    setTimeout(() => listeners.forEach((fn) => {
      try {
        fn(changes, 'local');
      } catch {}
    }));
  };
  const names = (keys) => (typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys ?? {}));

  // Another tab of the site changed a value.
  window.addEventListener('storage', (e) => {
    if (!e.key?.startsWith(PREFIX)) return;
    const key = e.key.slice(PREFIX.length);
    memory.delete(key);
    let newValue;
    try {
      newValue = e.newValue == null ? undefined : JSON.parse(e.newValue);
    } catch {}
    emit({ [key]: { newValue } });
  });

  return {
    runtime: {
      id: KYX_OWNER,
      getManifest: () => ({ version: KYX_VERSION }),
      sendMessage: (msg) => handle(msg).catch((e) => ({ error: e?.code ?? String(e) }))
    },
    storage: {
      local: {
        async get(keys) {
          const out = {};
          for (const key of names(keys)) {
            const value = read(key);
            if (value !== undefined) out[key] = value;
            else if (keys && typeof keys === 'object' && !Array.isArray(keys)) out[key] = keys[key];
          }
          return out;
        },
        async set(items) {
          const changes = {};
          for (const [key, value] of Object.entries(items)) {
            changes[key] = { oldValue: read(key), newValue: value };
            write(key, value);
          }
          emit(changes);
        },
        async remove(keys) {
          const changes = {};
          for (const key of names(keys)) {
            changes[key] = { oldValue: read(key), newValue: undefined };
            drop(key);
          }
          emit(changes);
        }
      },
      onChanged: { addListener: (fn) => listeners.push(fn) }
    }
  };
})();
