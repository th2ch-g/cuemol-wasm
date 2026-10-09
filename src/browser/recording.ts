export function showRecordingDialog(): void {
  const existing = document.getElementById('browser-recording');
  if (existing) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'browser-recording';
  dialog.className = 'wasm-dialog';
  dialog.setAttribute('aria-label', 'Record viewport');
  const title = document.createElement('h2');
  title.textContent = 'Record viewport';
  const description = document.createElement('p');
  description.textContent = 'Record the current view as WebM. During recording, play an animation or trajectory, or rotate the molecule.';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const start = document.createElement('button');
  start.textContent = 'Start recording';
  const stop = document.createElement('button');
  stop.textContent = 'Stop and download';
  stop.disabled = true;
  const close = document.createElement('button');
  close.textContent = 'Close';
  let recorder: MediaRecorder | undefined;
  let stream: MediaStream | undefined;
  const chunks: BlobPart[] = [];
  start.onclick = () => {
    try {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
      if (!canvas || !canvas.captureStream || typeof MediaRecorder === 'undefined') throw new Error('This browser does not support viewport recording.');
      const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('WebM recording is unavailable in this browser.');
      stream = canvas.captureStream(30);
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8000000 });
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        for (const track of stream!.getTracks()) track.stop();
        const blob = new Blob(chunks, { type: mimeType });
        (window as any).__cuemolHost.download(blob, 'cuemol-recording.webm', mimeType);
        dialog.remove();
      };
      recorder.onerror = () => { status.textContent = 'Recording failed. Stop recording and try a smaller viewport.'; };
      recorder.start(250);
      start.disabled = true;
      stop.disabled = false;
      close.disabled = true;
      status.textContent = 'Recording. Use the viewport or playback controls, then stop to download.';
    } catch (error) { status.textContent = String(error); }
  };
  stop.onclick = () => recorder?.stop();
  close.onclick = () => dialog.remove();
  dialog.addEventListener('cancel', event => { if (recorder?.state === 'recording') event.preventDefault(); });
  dialog.append(title, description, status, start, stop, close);
  document.body.append(dialog);
  dialog.show();
}
