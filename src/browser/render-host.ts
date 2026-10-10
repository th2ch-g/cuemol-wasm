import { IPC } from '@shared/ipcChannels';
import { RENDER_HISTORY_LIMIT } from '@shared/renderHistory';
import { chooseSaveName } from './file-dialogs';

type Host = {
  emit: (channel: string, payload?: any) => void;
  rpc: (operation: string, args: any) => Promise<any>;
  download: (data: BlobPart, name: string, mime?: string) => void;
};

export function createRenderHost(host: Host) {
  let dialog: HTMLDialogElement | undefined;
  let sequence = 0;
  let modeRequest = { mode: 'still', seq: 0 };
  const pending = new Map<number, { resolve: (value: any) => void; timer: ReturnType<typeof setTimeout> }>();
  const history = new Map<string, { sourcePath: string; workDir?: string }>();

  function open() {
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'wasm-render-window';
      dialog.setAttribute('aria-label', 'Umbreon rendering');
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = 'Close rendering';
      close.addEventListener('click', () => dialog!.close());
      const frame = document.createElement('iframe');
      frame.src = import.meta.env.BASE_URL + 'render.html';
      frame.title = 'Umbreon rendering';
      dialog.append(close, frame);
      document.body.append(dialog);
    }
    modeRequest = { mode: 'still', seq: ++sequence };
    if (!dialog.open) dialog.showModal();
    host.emit(IPC.RENDER_WINDOW_MODE_PUSH, modeRequest);
  }

  async function readImage(ref: any): Promise<Uint8Array> {
    const entry = ref?.kind === 'result' ? history.get(ref.resultId) : undefined;
    if (!entry) throw new Error('This rendered image is no longer available.');
    return host.rpc('read', { path: entry.sourcePath });
  }

  async function removeEntry(id: string) {
    const entry = history.get(id);
    history.delete(id);
    if (entry?.workDir) await host.rpc('remove', { path: entry.workDir });
  }

  async function dataUrl(data: Uint8Array): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(new Blob([data], { type: 'image/png' }));
    });
  }

  function browserSettings(reply: any) {
    const normalize = (values: Record<string, unknown>) => Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, key.endsWith('.denoise') && value === 'OIDN' ? 'A-trous' : value]),
    );
    return { ...reply, values: normalize(reply.values), defaults: normalize(reply.defaults) };
  }

  async function invoke(channel: string, arg?: any): Promise<any> {
    switch (channel) {
      case IPC.RENDER_WINDOW_OPEN: open(); return;
      case IPC.RENDER_WINDOW_COMMAND:
        if (arg.type === 'start' && (arg.snapshot.mode !== 'still' || !['umbreon', 'umbreon_npr'].includes(arg.snapshot.backend))) {
          throw new Error('Choose Umbreon or Umbreon NPR for a still image.');
        }
        host.emit(IPC.RENDER_WINDOW_EXEC, arg);
        if (arg.type === 'sync') host.emit(IPC.RENDER_WINDOW_MODE_PUSH, modeRequest);
        return;
      case IPC.RENDER_WINDOW_STATE: host.emit(IPC.RENDER_WINDOW_STATE_PUSH, arg.kind === 'sceneSettings' ? browserSettings(arg) : arg); return;
      case IPC.RENDER_RELAY_GET:
        return new Promise(resolve => {
          const reqId = ++sequence;
          const timer = setTimeout(() => {
            pending.delete(reqId);
            resolve(['viewSize', 'viewCamera'].includes(arg.kind) ? null : { ok: false, error: 'Rendering settings request timed out.' });
          }, 15000);
          pending.set(reqId, { resolve, timer });
          host.emit(IPC.RENDER_RELAY_REQUEST, { ...arg, reqId });
        });
      case IPC.RENDER_RELAY_REPLY: {
        const request = pending.get(arg.reqId);
        if (request) {
          pending.delete(arg.reqId);
          clearTimeout(request.timer);
          request.resolve(arg.kind === 'sceneRenderSettings' && arg.res?.ok ? browserSettings(arg.res) : arg.res);
        }
        return;
      }
      case IPC.RENDER_HISTORY_STORE:
        if (!(await host.rpc('exists', { path: arg.sourcePath }))) return { ok: false };
        history.set(arg.resultId, { sourcePath: arg.sourcePath, workDir: arg.workDir });
        while (history.size > RENDER_HISTORY_LIMIT) await removeEntry(history.keys().next().value!);
        return { ok: true };
      case IPC.RENDER_HISTORY_READ:
        try { return { dataUrl: await dataUrl(await readImage({ kind: 'result', ...arg })) }; }
        catch { return { dataUrl: null }; }
      case IPC.RENDER_HISTORY_CLEAR:
        for (const id of [...history.keys()]) await removeEntry(id);
        return;
      case IPC.RENDER_IMAGE_SAVE: {
        const choice = await chooseSaveName({ defaultName: arg.defaultName, filters: [{ name: 'PNG image', extensions: ['png'] }] }, 'render.png');
        if (choice.canceled) return { canceled: true };
        host.download(await readImage(arg.ref), choice.name, 'image/png');
        return { canceled: false, filePath: choice.name };
      }
      case IPC.RENDER_IMAGE_COPY:
        try {
          if (!navigator.clipboard?.write || !globalThis.ClipboardItem) throw new Error('Image clipboard access is unavailable in this browser. Use Save Image.');
          const image = readImage(arg.ref).then(data => new Blob([data], { type: 'image/png' }));
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]);
          return { ok: true };
        } catch (error) { return { ok: false, error: String(error) }; }
      case IPC.RENDER_MOVIE_TEMPDIR: return { dir: '' };
      default: throw new Error('Unsupported rendering command: ' + channel);
    }
  }
  return { invoke };
}
