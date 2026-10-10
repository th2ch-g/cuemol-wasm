export function isTouchInteraction() {
  return document.documentElement.dataset.pointerType === 'touch' || !matchMedia('(hover: hover)').matches;
}

export function installTouchMenus() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let target: Element | null = null;
  let origin = { x: 0, y: 0 };
  let suppressRelease = false;
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  document.addEventListener('pointerdown', event => {
    cancel();
    document.documentElement.dataset.pointerType = event.pointerType;
    suppressRelease = false;
    target = event.pointerType === 'touch' && event.target instanceof Element
      ? event.target.closest('[role="treeitem"], .h3-listbox-tree .bp5-tree-node-content') : null;
    if (!target) return;
    origin = { x: event.clientX, y: event.clientY };
    const source = event.target as Element;
    timer = setTimeout(() => {
      suppressRelease = true;
      source.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, button: 2, buttons: 2,
        clientX: origin.x, clientY: origin.y, screenX: event.screenX, screenY: event.screenY,
      }));
    }, 550);
  }, true);
  document.addEventListener('pointermove', event => {
    if (event.pointerType === 'mouse') document.documentElement.dataset.pointerType = 'mouse';
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8) cancel();
  }, true);
  document.addEventListener('pointerup', cancel, true);
  document.addEventListener('pointercancel', cancel, true);
  for (const name of ['mousedown', 'mouseup', 'click'] as const) {
    document.addEventListener(name, event => {
      if (suppressRelease) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
  }
  document.addEventListener('contextmenu', event => {
    if (event.isTrusted && suppressRelease) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
}
