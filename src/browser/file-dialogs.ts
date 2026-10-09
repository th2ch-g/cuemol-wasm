export interface SaveChoice { canceled: boolean; name: string; filterIndex: number; }
export function chooseSaveName(request: any, fallback: string): Promise<SaveChoice> {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'wasm-dialog wasm-modal';
    dialog.setAttribute('aria-label', 'Save file');
    const form = document.createElement('form');
    form.method = 'dialog';
    const title = document.createElement('h2');
    title.textContent = 'Save file';
    const label = document.createElement('label');
    label.textContent = 'File name';
    const input = document.createElement('input');
    input.type = 'text';
    input.required = true;
    input.value = request?.defaultName || fallback;
    input.setAttribute('aria-label', 'File name');
    label.append(input);
    const formatLabel = document.createElement('label');
    formatLabel.textContent = 'Format';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Format');
    const filters = request?.filters?.length ? request.filters : [{ name: 'All files', extensions: ['*'] }];
    filters.forEach((filter: any, index: number) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = filter.name || filter.extensions.join(', ');
      select.append(option);
    });
    select.value = String(request?.defaultFilterIndex || 0);
    select.onchange = () => {
      const ext = filters[Number(select.value)].extensions[0];
      if (ext !== '*') input.value = input.value.replace(/\.[^.]+$/, '') + '.' + ext;
    };
    formatLabel.append(select);
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = 'Save';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    let finished = false;
    const finish = (canceled: boolean) => {
      if (finished) return;
      finished = true;
      const filterIndex = Number(select.value);
      let name = input.value.trim().replaceAll('/', '_').replaceAll('\\', '_');
      const ext = filters[filterIndex].extensions[0];
      if (ext && ext !== '*' && !name.toLowerCase().endsWith('.' + ext.toLowerCase())) name += '.' + ext;
      dialog.remove();
      resolve({ canceled, name, filterIndex });
    };
    form.onsubmit = event => { event.preventDefault(); if (input.value.trim()) finish(false); };
    cancel.onclick = () => finish(true);
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(true); });
    form.append(title, label, formatLabel, save, cancel);
    dialog.append(form);
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
    input.select();
  });
}
