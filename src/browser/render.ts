import './render.css';

if (window.parent === window) {
  location.replace(import.meta.env.BASE_URL);
} else {
  const parentApi = (window.parent as any).electronAPI;
  const subscriptions = new Set<() => void>();
  (window as any).electronAPI = {
    ...parentApi,
    onPush(channel: string, callback: (data: any) => void) {
      const off = parentApi.onPush(channel, callback);
      subscriptions.add(off);
      return () => { subscriptions.delete(off); off(); };
    },
  };
  window.addEventListener('unload', () => subscriptions.forEach(off => off()));
  await import('@renderer/render');
}
