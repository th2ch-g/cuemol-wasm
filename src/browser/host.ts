import { createRenderHost } from './render-host';
import { IPC } from '@shared/ipcChannels';
import { chooseSaveName } from './file-dialogs';
import { zipSync } from 'fflate';
type Callback = (payload?: any) => void;
const listeners = new Map<string, Set<Callback>>();
let worker: Worker | undefined;
let post: ((message: any, transfer?: Transferable[]) => void) | undefined;
let sequence = 0;
let resolveReady: () => void;
const engineReady = new Promise<void>(resolve => { resolveReady = resolve; });
let pendingUploads: Promise<any> = Promise.resolve();
const calls = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>();
const knownFiles = new WeakMap<File, string>();
let clipboard: any = null;
const secretValues = new Map<string, string>();

function emit(channel: string, payload?: any) {
  for (const fn of listeners.get(channel) || []) fn(payload);
}
function readSetting(name: string, fallback: any) {
  try { return JSON.parse(localStorage.getItem('cuemol-wasm:' + name) || 'null') ?? fallback; }
  catch { return fallback; }
}
function writeSetting(name: string, value: any) { localStorage.setItem('cuemol-wasm:' + name, JSON.stringify(value)); }
export function notice(message: string) {
  const element = document.createElement('div');
  element.className = 'wasm-notice';
  element.textContent = message;
  element.setAttribute('role', 'status');
  document.body.append(element);
  setTimeout(() => element.remove(), 7000);
}
function download(bytes: BlobPart, name: string, mime = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name.split('/').pop() || 'download';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function rpc(operation: string, args: any): Promise<any> {
  await engineReady;
  if (!post) return Promise.reject(new Error('CueMol is still starting.'));
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    calls.set(id, { resolve, reject });
    post!(['__browser_fs__', id, operation, args]);
  });
}
async function stageFile(file: File, folder = '/work/uploads/' + crypto.randomUUID().slice(0, 8)): Promise<string> {
  const existing = knownFiles.get(file);
  if (existing) { await pendingUploads; return existing; }
  const path = folder + '/' + file.name.replaceAll('/', '_');
  knownFiles.set(file, path);
  const upload = pendingUploads.then(async () => rpc('write', { path, data: await file.arrayBuffer() }));
  pendingUploads = upload.catch(() => { knownFiles.delete(file); });
  await upload;
  return path;
}
function selectFiles(filters: any[] = [], multiple = false, directory = false): Promise<File[]> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    if (directory) input.webkitdirectory = true;
    const extensions = filters.flatMap(f => f.extensions || []).filter(e => e !== '*');
    if (extensions.length) input.accept = [...new Set(extensions)].map(e => '.' + e).join(',');
    input.style.display = 'none';
    document.body.append(input);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const files = Array.from(input.files || []);
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', finish, { once: true });
    input.addEventListener('cancel', finish, { once: true });
    input.click();
  });
}
async function choosePaths(filters: any[] = [], multiple = false, directory = false) {
  const files = await selectFiles(filters, multiple, directory);
  const folder = '/work/uploads/' + crypto.randomUUID().slice(0, 8);
  const paths = [];
  for (const file of files) {
    const rel = directory ? file.webkitRelativePath : file.name;
    const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    paths.push(await stageFile(file, folder + (parent ? '/' + parent : '')));
  }
  return { canceled: paths.length === 0, filePath: directory && paths.length ? folder + '/' + files[0].webkitRelativePath.split('/')[0] : paths[0] || '', filePaths: paths };
}
async function savePath(request: any, fallback: string) {
  const choice = await chooseSaveName(request, fallback);
  if (choice.canceled) return { canceled: true, filePath: '' };
  const folder = request?.collectOutputs ? '/work/exports/' + crypto.randomUUID().slice(0, 8) : '/work';
  await rpc('mkdir', { path: folder });
  const path = folder + '/' + choice.name;
  await rpc('save', { path });
  return { canceled: false, filePath: path, filterIndex: choice.filterIndex };
}

function attachWorker(value: Worker) {
  worker = value;
  post = value.postMessage.bind(value) as any;
  const rawPost = post!;
  value.postMessage = ((message: any, transfer: Transferable[] = []) => {
    pendingUploads.then(() => rawPost(message, transfer));
  }) as typeof value.postMessage;
  value.addEventListener('message', event => {
    const [channel, ...args] = event.data || [];
    if (typeof args[0] === 'number' && args[0] < 0 && calls.has(args[0])) {
      event.stopImmediatePropagation();
      const [id, ok, result] = args;
      const call = calls.get(id)!;
      calls.delete(id);
      if (ok) call.resolve(result); else call.reject(new Error(String(result)));
      return;
    }
    if (typeof channel !== 'string' || !channel.startsWith('__browser_')) return;
    event.stopImmediatePropagation();
    if (channel === '__browser_notice__') { notice(args[0]); }
    else if (channel === '__browser_fs_result__') {
      const [id, ok, result] = args;
      const call = calls.get(id);
      calls.delete(id);
      if (ok) call?.resolve(result); else call?.reject(new Error(result));
    } else if (channel === '__browser_saved__') {
      void downloadSaved(args[0], args[1]).catch(error => notice(String(error)));
    } else if (channel === '__browser_ready__') {
      document.documentElement.dataset.engineReady = 'true';
      resolveReady();
    } else if (channel === '__browser_progress__') {
      document.documentElement.dataset.engineProgress = args.join('/');
    }
  });
}
async function downloadSaved(path: string, data: Uint8Array) {
  if (path.startsWith('/work/exports/')) {
    const folder = path.slice(0, path.lastIndexOf('/'));
    const names = await rpc('list', { path: folder });
    if (names.length > 1) {
      const files: Record<string, Uint8Array> = {};
      for (const name of names) files[name] = await rpc('read', { path: folder + '/' + name });
      download(zipSync(files), path.replace(/\.[^.]+$/, '.zip'), 'application/zip');
      return;
    }
  }
  download(data, path);
}
async function call(name: string, ...args: any[]): Promise<any> {
  await engineReady;
  const id = -1000000 - (++sequence);
  return new Promise((resolve, reject) => {
    calls.set(id, { resolve, reject });
    post!([name, id, ...args]);
  });
}
const renderHost = createRenderHost({ emit, rpc, download });
async function invoke(channel: string, arg?: any): Promise<any> {
  if (channel.startsWith("render-window:")) return renderHost.invoke(channel, arg);
  switch (channel) {
    case IPC.APP_PATH: return {
      appPath: '/cuemol', exePath: '', modulePath: '/cuemol', isPackaged: true,
      sysConfigPath: '/cuemol/sysconfig.xml', userStylePath: '/settings/user_styles.xml', userStyleExists: true,
      defaultRenderBinaries: { povrayExe: '', povrayInc: '', blendpng: '', ffmpeg: '' },
      defaultApbsBinaries: { apbsExe: '', pdb2pqrExe: '' }, cliPath: '',
    };
    case IPC.LAYOUT_LOAD: return readSetting('layout', null);
    case IPC.LAYOUT_SAVE: writeSetting('layout', arg); return;
    case IPC.UI_LOAD: return readSetting('ui', { theme: 'dark', inputDeviceMode: 'mouse' });
    case IPC.UI_SAVE: writeSetting('ui', { ...readSetting('ui', {}), ...arg }); return;
    case IPC.DIALOG_OPEN: {
      const chosen = await choosePaths(arg.filters);
      if (!chosen.canceled) emit(arg.dialogType === 'open-scene' ? IPC.SCENE_FILE_OPENED : IPC.OBJ_FILE_OPENED,
        { name: chosen.filePath.split('/').pop(), path: chosen.filePath, contentFirst: arg.dialogType !== 'open-scene' });
      return;
    }
    case IPC.DIALOG_PICK_PATH: return choosePaths(arg.filters, arg.multi, arg.directory);
    case IPC.DIALOG_STYLE_OPEN: return choosePaths([{ extensions: ['xml'] }]);
    case IPC.DIALOG_CAMERA_OPEN: return choosePaths([{ extensions: ['qcam', 'xml'] }]);
    case IPC.DIALOG_SAVE_SCENE: return savePath({ filters: [{ name: 'CueMol scene', extensions: ['qsc'] }], ...arg }, 'scene.qsc');
    case IPC.DIALOG_STYLE_SAVE: return savePath({ filters: [{ name: 'CueMol styles', extensions: ['xml'] }], ...arg }, 'styles.xml');
    case IPC.DIALOG_CAMERA_SAVE: return savePath({ filters: [{ name: 'CueMol camera', extensions: ['qcam'] }], ...arg }, 'camera.qcam');
    case IPC.DIALOG_SCENE_EXPORT: return savePath({ ...arg, collectOutputs: true }, 'image.png');
    case IPC.DIALOG_OBJECT_SAVE: return savePath(arg, 'structure.pdb');
    case IPC.SAVE_TEXT_AS: download(arg.content, arg.defaultName, 'text/plain'); return { canceled: false, filePath: arg.defaultName };
    case IPC.FILE_EXISTS: return { exists: await rpc('exists', arg) };
    case IPC.FILE_BACKUP_RENAME:
      await rpc('save', { path: arg.path });
      if (await rpc('exists', arg)) { await rpc('rename', { from: arg.path, to: arg.path + '.bak' }); return { ok: true, backed: true }; }
      return { ok: true, backed: false };
    case IPC.SHELL_FILES_TAKE: return { paths: [], missing: [] };
    case IPC.SHELL_OPEN_PATH: download(await rpc('read', arg), arg.path); return { ok: true };
    case IPC.SHELL_REVEAL_PATH: notice('Files are stored in this browser. Use Save or Export to download them.'); return { ok: true };
    case IPC.RECENT_LOAD: return readSetting('recent', []);
    case IPC.RECENT_ADD: {
      const recent = [arg, ...readSetting('recent', []).filter((v: any) => v.path !== arg.path)].slice(0, 20);
      writeSetting('recent', recent); emit(IPC.RECENT_UPDATED, recent); return;
    }
    case IPC.RECENT_CLEAR: writeSetting('recent', []); emit(IPC.RECENT_UPDATED, []); return;
    case IPC.WINDOW_SET_TITLE: document.title = (arg.subtitle ? arg.subtitle + ' · ' : '') + 'CueMol Wasm'; return;
    case IPC.WINDOW_FOCUS_MAIN: window.focus(); return;
    case IPC.WINDOW_REVEAL: document.documentElement.dataset.appReady = 'true'; return;
    case IPC.WINDOW_CLOSE_PROCEED: if (arg.proceed) location.reload(); return;
    case IPC.MENU_INVOKE_ROLE:
    case IPC.TEXT_CTX_ACTION: document.execCommand(typeof arg === 'string' ? arg : arg.action); return;
    case IPC.CLIPBOARD_CUEMOL_WRITE: clipboard = structuredClone({ form: 'single', ...arg }); return { ok: true };
    case IPC.CLIPBOARD_CUEMOL_READ: return clipboard;
    case IPC.CLIPBOARD_CUEMOL_PEEK: return clipboard ? { kind: clipboard.kind } : null;
    case IPC.SECRET_GET: return { value: secretValues.get(arg.namespace + ':' + arg.key) || null, source: secretValues.has(arg.namespace + ':' + arg.key) ? 'stored' : 'none' };
    case IPC.SECRET_SET: return { ok: false, error: 'OS keychain storage is not available in a browser.' };
    case IPC.SECRET_STATUS: return { source: 'none', last4: null, encryptionAvailable: false };
    case IPC.LOCAL_API_STATUS:
    case IPC.LOCAL_API_CONTROL: return { listening: false, port: 0, endpoints: [], token: '', error: null, infoFile: '' };
    case IPC.LOCAL_API_CLI_ACCESS: return false;
    case IPC.CRASH_REPORT: console.error('CueMol error:', arg); return;
    case IPC.FORCE_QUIT: location.reload(); return;
    case IPC.MENU_UPDATE_STATE:
    case IPC.MENU_SET_MODAL_BLOCKED:
    case IPC.MENU_SET_PLUGIN_CONTRIBUTIONS:
    case IPC.LOCAL_API_REPLY: return;
    case IPC.NAVI_CTX_SHOW:
    case IPC.SCENE_CTX_SHOW: return null;
    default: throw new Error('This browser host does not support: ' + channel);
  }
}
export function installBrowserHost() {
  (window as any).__cuemolHost = { invoke, emit, rpc, call, download, notice };
  (globalThis as any).__cuemolWasmAttachWorker = attachWorker;
  (window as any).electronAPI = {
    platform: 'linux',
    invoke,
    onPush(channel: string, callback: Callback) {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(callback);
      return () => listeners.get(channel)?.delete(callback);
    },
    getPathForFile(file: File) {
      void stageFile(file).catch(error => notice(String(error)));
      return knownFiles.get(file)!;
    },
  };
  window.addEventListener('beforeunload', event => {
    if (document.documentElement.dataset.appReady === 'true') {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}
