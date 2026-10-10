import { useEffect, type RefObject } from 'react';
import { GES_PINCH } from '@renderer/worker/shared/gestureAxes';

type Point = { clientX: number; clientY: number; screenX: number; screenY: number };
type Input = {
  onMouseEvent(view: number, method: string, event: object): void;
  onGestureEvent(view: number, axis: number, delta: number, event?: object): void;
};

export function useTouchInput(canvasRef: RefObject<HTMLCanvasElement>,
  cmRef: RefObject<Input | null>, viewRef: RefObject<() => number | undefined>) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const points = new Map<number, Point>();
    let view: number | undefined;
    let origin: Point | undefined;
    let previous: Point | undefined;
    let distance = 0;
    let dragButton: number | undefined;
    let multiple = false;
    const point = (event: PointerEvent): Point => ({
      clientX: event.clientX, clientY: event.clientY,
      screenX: event.screenX, screenY: event.screenY,
    });
    const center = () => {
      const values = [...points.values()].slice(0, 2);
      return values.length === 1 ? values[0] : {
        clientX: (values[0].clientX + values[1].clientX) / 2,
        clientY: (values[0].clientY + values[1].clientY) / 2,
        screenX: (values[0].screenX + values[1].screenX) / 2,
        screenY: (values[0].screenY + values[1].screenY) / 2,
      };
    };
    const span = () => {
      const [a, b] = [...points.values()];
      return b ? Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) : 0;
    };
    const payload = (position: Point, button = 0, down = true) => {
      const rect = canvas.getBoundingClientRect();
      return { ...position, offsetX: position.clientX - rect.left,
        offsetY: position.clientY - rect.top, button, buttons: down ? (button === 2 ? 2 : 1) : 0,
        ctrlKey: false, shiftKey: false, altKey: false };
    };
    const mouse = (method: string, position: Point, button = 0, down = true) => {
      if (view !== undefined) cmRef.current?.onMouseEvent(view, method, payload(position, button, down));
    };
    const finishDrag = () => {
      if (dragButton !== undefined && previous) mouse('mouseUp', previous, dragButton, false);
      dragButton = undefined;
    };
    const reset = () => {
      finishDrag();
      points.clear();
      origin = previous = undefined;
      view = undefined;
      distance = 0;
      multiple = false;
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
      if (!points.size) view = viewRef.current?.();
      if (view === undefined) return;
      event.preventDefault();
      finishDrag();
      points.set(event.pointerId, point(event));
      canvas.setPointerCapture(event.pointerId);
      if (points.size > 1) multiple = true;
      origin = previous = center();
      distance = span();
    };
    const move = (event: PointerEvent) => {
      if (!points.has(event.pointerId)) return;
      event.preventDefault();
      points.set(event.pointerId, point(event));
      const position = center();
      if (origin && dragButton === undefined &&
          Math.hypot(position.clientX - origin.clientX, position.clientY - origin.clientY) >= 4) {
        dragButton = points.size > 1 ? 2 : 0;
        mouse('mouseDown', origin, dragButton);
      }
      if (dragButton !== undefined) mouse('mouseMove', position, dragButton);
      if (points.size > 1) {
        const next = span();
        if (view !== undefined && distance > 0 && next > 0) {
          cmRef.current?.onGestureEvent(view, GES_PINCH, -Math.log(next / distance) * 100, payload(position));
        }
        distance = next;
      }
      previous = position;
    };
    const up = (event: PointerEvent) => {
      if (!points.has(event.pointerId)) return;
      event.preventDefault();
      const tap = event.type === 'pointerup' && !multiple && dragButton === undefined;
      finishDrag();
      if (tap && previous) {
        mouse('mouseDown', previous);
        mouse('mouseUp', previous, 0, false);
      }
      points.delete(event.pointerId);
      if (points.size) {
        origin = previous = center();
        distance = span();
      } else reset();
    };
    const cancel = () => reset();
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
    window.addEventListener('blur', cancel);
    return () => {
      reset();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('lostpointercapture', up);
      window.removeEventListener('blur', cancel);
    };
  }, [canvasRef, cmRef, viewRef]);
}

export function useTouchMouseDrag(ref: RefObject<HTMLElement>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let pointer: number | undefined;
    const mouse = (type: string, event: PointerEvent) => element.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window, button: 0,
      buttons: type === 'mouseup' ? 0 : 1, clientX: event.clientX, clientY: event.clientY,
      screenX: event.screenX, screenY: event.screenY, relatedTarget: type === 'mouseout' ? document.body : null,
    }));
    const down = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
      event.preventDefault();
      if (pointer !== undefined) { mouse('mouseout', event); pointer = undefined; return; }
      pointer = event.pointerId;
      element.setPointerCapture(pointer);
      mouse('mousedown', event);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      event.preventDefault();
      mouse('mousemove', event);
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      event.preventDefault();
      pointer = undefined;
      mouse(event.type === 'pointerup' ? 'mouseup' : 'mouseout', event);
    };
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
    element.addEventListener('lostpointercapture', up);
    return () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
      element.removeEventListener('lostpointercapture', up);
    };
  }, [ref]);
}
