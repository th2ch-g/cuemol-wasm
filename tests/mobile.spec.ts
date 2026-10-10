import { test, expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2,
  isMobile: async ({ browserName }, use) => { await use(browserName !== 'firefox'); },
});

async function boot(page: Page) {
  await page.goto('./');
  await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
  await expect(page.getByRole('navigation', { name: 'Workspace panels' })).toBeVisible();
}
async function call(page: Page, name: string, args: any = {}) {
  return page.evaluate(({ name, args }) => (window as any).__cuemolHost.call(name, args), { name, args });
}
async function state(page: Page) {
  return page.evaluate(() => (window as any).__cuemolHost.rpc('state'));
}
async function openFile(page: Page) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open File', exact: true }).tap();
  await (await chooser).setFiles('.cache/upstream/tests/test_data/1CRN.pdb');
  const dialog = page.getByRole('dialog').last();
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
  await page.getByRole('button', { name: 'Open', exact: true }).tap();
  await expect.poll(async () => (await call(page, 'listSceneObjects', await state(page))).objects?.length).toBe(1);
}
async function viewImage(page: Page) {
  const path = '/work/mobile.png';
  expect(await call(page, 'exportScene', { ...await state(page), exporterName: 'png',
    filePath: path, width: 300, height: 300, alpha: true })).toMatchObject({ ok: true });
  const bytes = await page.evaluate(async path => Array.from(
    await (window as any).__cuemolHost.rpc('read', { path })), path);
  return PNG.sync.read(Buffer.from(bytes as number[])).data;
}

test('compact panels, touch menus, file downloads and orientation keep the molecular view usable', async ({ page, context, browserName }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await boot(page);
  await openFile(page);
  const canvas = page.locator('canvas[data-molview-canvas]');
  let bounds = (await canvas.boundingBox())!;
  expect(bounds.width).toBeGreaterThan(370);
  expect(bounds.height).toBeGreaterThan(450);
  await canvas.evaluate(element => element.setAttribute('data-mobile-retained', 'yes'));
  await testInfo.attach('portrait', { body: await page.screenshot(), contentType: 'image/png' });
  await page.getByRole('button', { name: 'Tools', exact: true }).tap();
  const renderer = page.getByText('simple1 (simple)', { exact: true }).first();
  await expect(renderer).toBeVisible();
  await renderer.tap();
  await page.getByRole('button', { name: 'Properties', exact: true }).tap();
  await expect(page.locator('.inspector-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Tools', exact: true }).tap();
  const box = (await renderer.boundingBox())!;
  const holdPoint = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  if (browserName === 'chromium') {
    const input = await context.newCDPSession(page);
    await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...holdPoint, id: 91 }] });
    await expect(page.getByRole('menuitem', { name: 'Change type', exact: true })).toBeVisible();
    await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.evaluate(({ x, y }) => {
      document.elementFromPoint(x, y)!.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, pointerType: 'touch', pointerId: 91, clientX: x, clientY: y }));
    }, holdPoint);
    await expect(page.getByRole('menuitem', { name: 'Change type', exact: true })).toBeVisible();
    await page.dispatchEvent('body', 'pointerup', { pointerType: 'touch', pointerId: 91 });
  }
  await page.getByRole('menuitem', { name: 'Change type', exact: true }).tap();
  await page.getByRole('menuitem', { name: 'cartoon', exact: true }).tap();
  await expect(page.getByText('simple1 (cartoon)', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Panels', exact: true }).tap();
  await page.getByText('Sequence', { exact: true }).tap();
  await expect(page.locator('.bottom-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Model', exact: true }).tap();
  expect((await viewImage(page)).some(value => value > 0)).toBe(true);
  await page.getByRole('menuitem', { name: 'View', exact: true }).tap();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Perspective', exact: true })).toBeVisible();
  await page.getByRole('menuitemcheckbox', { name: 'Perspective', exact: true }).tap();
  expect(await call(page, 'getViewProjection', await state(page))).toMatchObject({ perspective: true });
  await page.getByRole('button', { name: 'Tools', exact: true }).tap();
  await page.getByText('1CRN (MolCoord)', { exact: true }).first().tap();
  await page.getByRole('button', { name: 'Model', exact: true }).tap();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save Object', exact: true }).tap();
  await page.getByRole('dialog', { name: 'Save file', exact: true }).getByRole('button', { name: 'Save', exact: true }).tap();
  const saved = testInfo.outputPath('mobile.pdb');
  await (await download).saveAs(saved);
  const { readFile } = await import('node:fs/promises');
  expect((await readFile(saved, 'utf8')).split('\n').filter(line => /^(ATOM  |HETATM)/.test(line))).toHaveLength(327);
  await page.getByRole('button', { name: 'Render', exact: true }).tap();
  const frame = page.frameLocator('iframe[title="Umbreon rendering"]');
  await expect(frame.getByRole('button', { name: 'Start Render', exact: true })).toBeVisible();
  await frame.getByRole('button', { name: 'Settings', exact: true }).tap();
  await expect(frame.locator('.render-window-settings')).toBeVisible();
  await page.getByRole('button', { name: 'Close rendering', exact: true }).tap();
  for (const viewport of [{ width: 844, height: 390 }, { width: 1440, height: 1000 }, { width: 320, height: 640 }]) {
    await page.setViewportSize(viewport);
    await expect(canvas).toBeVisible();
    expect(await canvas.getAttribute('data-mobile-retained')).toBe('yes');
    await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(viewport.width < 1100 ? viewport.width - 20 : 400);
    expect((await viewImage(page)).some(value => value > 0)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    if (viewport.width === 844) {
      const distance = page.getByRole('button', { name: 'Distance (D)', exact: true });
      await distance.tap();
      await expect(distance).toHaveAttribute('aria-pressed', 'true');
      const tool = (await distance.boundingBox())!;
      expect(tool.y + tool.height).toBeLessThan(viewport.height);
      await page.getByRole('button', { name: 'Navigate (N)', exact: true }).tap();
    }
  }
  await testInfo.attach('small-phone', { body: await page.screenshot(), contentType: 'image/png' });
  expect(errors).toEqual([]);
});

test('real touchscreen gestures rotate, pan, pinch and recover from cancellation', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Trusted multi-touch injection uses the Chromium input protocol.');
  await boot(page);
  await openFile(page);
  const canvas = page.locator('canvas[data-molview-canvas]');
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const client = await context.newCDPSession(page);
  const touch = (type: string, points: { x: number; y: number; id: number }[]) =>
    client.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(point =>
      ({ ...point, radiusX: 2, radiusY: 2, force: 1 })) });
  const before = await viewImage(page);
  await touch('touchStart', [{ x, y, id: 1 }]);
  for (let step = 1; step <= 8; step++) await touch('touchMove', [{ x: x + step * 6, y: y + step * 4, id: 1 }]);
  await touch('touchEnd', []);
  await expect.poll(async () => (await viewImage(page)).equals(before)).toBe(false);
  const view = await state(page);
  const beforePan = await call(page, 'getViewXform', view);
  await touch('touchStart', [{ x: x - 40, y, id: 1 }, { x: x + 40, y, id: 2 }]);
  for (let step = 1; step <= 8; step++) await touch('touchMove', [
    { x: x - 40 + step * 4, y: y + step * 3, id: 1 }, { x: x + 40 + step * 4, y: y + step * 3, id: 2 }]);
  await touch('touchEnd', []);
  await expect.poll(async () => {
    const after = await call(page, 'getViewXform', view);
    return Math.hypot(after.centerX - beforePan.centerX, after.centerY - beforePan.centerY, after.centerZ - beforePan.centerZ);
  }).toBeGreaterThan(0.1);
  const beforePinch = await call(page, 'getViewXform', view);
  await touch('touchStart', [{ x: x - 30, y, id: 1 }, { x: x + 30, y, id: 2 }]);
  for (let step = 1; step <= 8; step++) await touch('touchMove', [
    { x: x - 30 - step * 5, y, id: 1 }, { x: x + 30 + step * 5, y, id: 2 }]);
  await touch('touchEnd', []);
  await expect.poll(async () => (await call(page, 'getViewXform', view)).zoom).not.toBe(beforePinch.zoom);
  await call(page, 'setViewXform', { ...view, zoom: beforePan.zoom, center: { x: beforePan.centerX, y: beforePan.centerY, z: beforePan.centerZ } });
  await touch('touchStart', [{ x, y, id: 1 }]);
  for (let step = 1; step <= 6; step++) await touch('touchMove', [{ x: x + step * 5, y, id: 1 }]);
  await touch('touchCancel', []);
  const afterCancel = await viewImage(page);
  await touch('touchStart', [{ x, y, id: 1 }]);
  for (let step = 1; step <= 6; step++) await touch('touchMove', [{ x: x - step * 6, y: y + step * 5, id: 1 }]);
  await touch('touchEnd', []);
  await expect.poll(async () => (await viewImage(page)).equals(afterCancel)).toBe(false);
  const molId = (await call(page, 'listSceneObjects', view)).objects[0].uid;
  const chainName = (await call(page, 'getMolChains', { ...view, molId })).chains[0].name;
  await call(page, 'selectObjectMol', { ...view, objId: molId, kind: 'unselect' });
  await page.getByRole('button', { name: 'Rect Select (B)', exact: true }).tap();
  await touch('touchStart', [{ x: box.x + 70, y: box.y + 90, id: 1 }]);
  for (let step = 1; step <= 8; step++) await touch('touchMove', [{
    x: box.x + 70 + (box.width - 85) * step / 8,
    y: box.y + 90 + (box.height - 110) * step / 8, id: 1,
  }]);
  await touch('touchEnd', []);
  await expect.poll(async () => (await call(page, 'getMolResidues', { ...view, molId, chainName }))
    .residues.filter((residue: any) => residue.sel).length).toBeGreaterThan(0);
  await call(page, 'selectObjectMol', { ...view, objId: molId, kind: 'unselect' });
  await page.getByRole('button', { name: 'Lasso (L)', exact: true }).tap();
  const polygon = [
    { x: box.x + 70, y: box.y + 90, id: 1 },
    { x: box.x + box.width - 15, y: box.y + 90, id: 1 },
    { x: box.x + box.width - 15, y: box.y + box.height - 20, id: 1 },
    { x: box.x + 70, y: box.y + box.height - 20, id: 1 },
    { x: box.x + 70, y: box.y + 90, id: 1 },
  ];
  await touch('touchStart', [polygon[0]]);
  for (const point of polygon.slice(1)) await touch('touchMove', [point]);
  await touch('touchEnd', []);
  await expect.poll(async () => (await call(page, 'getMolResidues', { ...view, molId, chainName }))
    .residues.filter((residue: any) => residue.sel).length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Navigate (N)', exact: true }).tap();
  expect(await page.evaluate(() => visualViewport?.scale)).toBe(1);
  await expect(page.locator('.ctx-menu-overlay')).toHaveCount(0);
});
