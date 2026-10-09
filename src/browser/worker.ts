import { initializeCore, getModule, wasm, syncMemory } from './core';
import { Buffer } from 'buffer';
import * as fs from '../shims/fs';
(globalThis as any).Buffer = Buffer;
(globalThis as any).process = { env: {}, platform: 'browser', cwd: () => '/work' };
const messages: MessageEvent[] = [];
const savedPaths = new Set<string>();
let activeView = 0;
self.addEventListener('message', async event => {
  if (event.data?.[0] === 'bindCanvas') activeView = event.data[3];
  if (event.data?.[0] === 'activateView') activeView = event.data[2];
  if (event.data?.[0] !== '__browser_fs__') return;
  event.stopImmediatePropagation();
  const [, id, operation, args] = event.data;
  try {
    let result: any;
    if (operation === 'write') { fs.mkdirSync(args.path.slice(0, args.path.lastIndexOf('/')), { recursive: true }); fs.writeFileSync(args.path, new Uint8Array(args.data)); result = true; }
    else if (operation === 'read') result = new Uint8Array(wasm.FS.readFile(args.path));
    else if (operation === 'exists') result = fs.existsSync(args.path);
    else if (operation === 'save') { savedPaths.add(args.path); result = true; }
    else if (operation === 'rename') { fs.renameSync(args.from, args.to); result = true; }
    else if (operation === 'mkdir') { fs.mkdirSync(args.path, { recursive: true }); result = true; }
    else if (operation === 'list') result = fs.readdirSync(args.path);
    else if (operation === 'flush') result = await new Promise<void>((resolve, reject) => wasm.FS.syncfs(false, (error: any) => error ? reject(error) : resolve()));
    else if (operation === 'remove') { fs.rmSync(args.path, { recursive: true, force: true }); result = true; }
    else if (operation === 'state') {
      const manager = getModule().getService('SceneManager');
      const scenes = manager.invokeMethod('getSceneUIDList').split(',').filter(Boolean).map(Number);
      const sceneId = scenes.find((id: number) => manager.invokeMethod('getScene', id).getProp('view_uids').split(',').map(Number).includes(activeView)) || scenes[0];
      result = { sceneId, viewId: activeView, scenes };
    }
    else throw new Error('Unknown filesystem operation: ' + operation);
    self.postMessage(['__browser_fs_result__', id, true, result]);
  } catch (error) { self.postMessage(['__browser_fs_result__', id, false, String(error)]); }
});
self.onmessage = event => messages.push(event);
try {
  const base = new URL(import.meta.env.BASE_URL, self.location.origin);
  await initializeCore(base);
  const originalClose = wasm.FS.close.bind(wasm.FS);
  wasm.FS.close = (stream: any) => {
    const path = stream.path;
    const result = originalClose(stream);
    if (savedPaths.delete(path)) {
      const bytes = new Uint8Array(wasm.FS.readFile(path));
      self.postMessage(['__browser_saved__', path, bytes], [bytes.buffer]);
    }
    return result;
  };
  const { GfxManager } = await import('@renderer/worker/server/gfx_manager');
  for (const name of Object.getOwnPropertyNames(GfxManager.prototype)) {
    if (name === 'constructor') continue;
    const original = GfxManager.prototype[name];
    if (typeof original !== 'function') continue;
    GfxManager.prototype[name] = function (...args: any[]) {
      const synced = args.map(arg => syncMemory(arg));
      const result = original.apply(this, synced);
      for (const arg of synced) syncMemory(arg, true);
      return result;
    };
  }
  await import('@renderer/worker/server/worker_launcher');
  for (const event of messages) (self.onmessage as any)?.(event);
  self.postMessage(['__browser_ready__']);
} catch (error) {
  console.error(error);
  self.postMessage(['__worker_crash__', { message: String(error), stack: (error as Error).stack }]);
}
