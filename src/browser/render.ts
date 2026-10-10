import './render.css';
import { IPC } from '@shared/ipcChannels';

if (window.parent === window) {
  location.replace(import.meta.env.BASE_URL);
} else {
  const parentApi = (window.parent as any).electronAPI;
  const subscriptions = new Set<() => void>();
  (window as any).electronAPI = {
    ...parentApi,
    invoke(channel: string, arg?: unknown) {
      if (channel === IPC.WINDOW_REVEAL) {
        document.documentElement.dataset.appReady = 'true';
        return Promise.resolve();
      }
      return parentApi.invoke(channel, arg);
    },
    onPush(channel: string, callback: (data: any) => void) {
      const off = parentApi.onPush(channel, callback);
      subscriptions.add(off);
      return () => { subscriptions.delete(off); off(); };
    },
  };
  window.addEventListener('unload', () => subscriptions.forEach(off => off()));
  await import('@renderer/render');
}
