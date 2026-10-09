import { installBrowserHost } from './host';
import './browser.css';
installBrowserHost();
try {
  if (!isSecureContext) throw new Error('Open CueMol over HTTPS or localhost.');
  if (!('OffscreenCanvas' in window) || !HTMLCanvasElement.prototype.transferControlToOffscreen) throw new Error('This browser needs OffscreenCanvas support. Use a current browser.');
  if (!crossOriginIsolated) {
    const status = document.getElementById('boot-status');
    if (status) status.textContent = 'Preparing the browser for CueMol. The page will reload once.';
    if (!('serviceWorker' in navigator)) throw new Error('Enable service workers for this site to run CueMol.');
    await Promise.race([
      new Promise<never>(() => {
        navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Browser isolation could not be enabled. Allow service workers for this site, then reload.')), 15000)),
    ]);
  }
  await import('@renderer/index');
} catch (error) {
  const status = document.getElementById('boot-status');
  if (status) status.textContent = String(error);
  document.querySelector('.boot progress')?.remove();
  console.error(error);
}
