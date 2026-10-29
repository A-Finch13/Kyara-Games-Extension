// Updates abonnes.json: reads the site's public lists like the extension, adds the subscribers of the files given
// as arguments, and keeps every subscriber already in the file.
// node tools/abonnes.mjs [liste.json …]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'abonnes.json');
const TIERS = ['nakama', 'senpai', 'sensei', 'daimyo'];

// Subscribers of a file: { subscribers: { id: … } } or { id: … } directly.
const subsOf = (path) => {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  return Object.values(data?.subscribers ?? data ?? {}).filter((s) => typeof s?.id === 'string' && typeof s.pseudo === 'string' && TIERS.includes(s.tier));
};

// Stand-in for the extension storage, filled with the subscribers already known.
const store = { subscribers: {}, sharedSubsAt: Date.now() };
for (const path of [file, ...process.argv.slice(2)]) {
  if (!existsSync(path)) continue;
  for (const s of subsOf(path)) store.subscribers[s.id] ??= s;
}
const before = Object.keys(store.subscribers).length;
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => Object.fromEntries([keys].flat().filter((k) => k in store).map((k) => [k, structuredClone(store[k])])),
      set: async (obj) => Object.assign(store, obj)
    }
  },
  runtime: { getManifest: () => JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) }
};

const { runSubsScan, subsJson } = await import(pathToFileURL(join(root, 'src/lib/kyara.js')).href);
await runSubsScan();

writeFileSync(file, subsJson(store.subscribers));
const count = Object.keys(store.subscribers).length;
console.log(`abonnes.json : ${count} abonnés (${count - before} nouveaux)`);
