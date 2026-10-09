import { getDefaultContext } from '@emnapi/runtime';
export let wasm: any;
let internal: any;
export async function initializeCore(base: URL) {
  const version = await fetch(new URL('version.json', base), { cache: 'no-store' }).then(response => response.json());
  const loader = new URL(version.wasmBase + 'cuemol.mjs', base);
  const { default: createModule } = await import(/* @vite-ignore */ loader.href);
  wasm = await createModule({
    locateFile: (name: string) => new URL(version.wasmBase + name, base).href,
    print: (message: string) => console.log(message),
    printErr: (message: string) => console.warn(message),
  });
  const manifest = await fetch(new URL(version.runtimeBase + 'manifest.json', base)).then(r => {
    if (!r.ok) throw new Error('Runtime data could not be loaded.');
    return r.json();
  });
  const FS = wasm.FS;
  for (const path of ['/cuemol', '/work', '/settings']) FS.mkdirTree(path);
  for (const path of ['/work', '/settings']) FS.mount(wasm.IDBFS, { autoPersist: true }, path);
  try {
    await new Promise<void>((resolve, reject) => FS.syncfs(true, (error: any) => error ? reject(error) : resolve()));
  } catch {
    for (const path of ['/work', '/settings']) FS.unmount(path);
    self.postMessage(['__browser_notice__', 'Browser storage is unavailable. Files will be kept for this tab only; use Save Scene to download your work.']);
  }
  let loaded = 0;
  const queue = [...manifest.files];
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (;;) {
      const entry = queue.pop();
      if (!entry) break;
      const response = await fetch(new URL(version.runtimeBase + entry, base));
      if (!response.ok) throw new Error('Missing runtime file: ' + entry);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const path = '/cuemol/' + entry;
      FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
      FS.writeFile(path, bytes);
      if (++loaded % 20 === 0) self.postMessage(['__browser_progress__', loaded, manifest.files.length]);
    }
  }));
  FS.chdir('/work');
  internal = wasm.emnapiInit({ context: getDefaultContext() });
  for (const name of ['copyToTypedArray', 'toTypedArray']) {
    const original = internal[name];
    internal[name] = (...args: any[]) => syncMemory(original(...args));
  }
  for (const name of ['copyFromTypedArray', 'fromTypedArray']) {
    const original = internal[name];
    internal[name] = (value: any) => { syncMemory(value, true); return original(value); };
  }
  return internal;
}
export function getModule() {
  if (!internal) throw new Error('CueMol Wasm has not initialized.');
  return internal;
}
export function syncMemory(value: any, toWasm = false) {
  if (!(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value)) return value;
  try { return wasm.emnapiSyncMemory(toWasm, value); }
  catch (error) {
    if (String(error).includes('Unknown ArrayBuffer address')) return value;
    throw error;
  }
}
