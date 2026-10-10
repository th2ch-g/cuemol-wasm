import { test, expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

const pdb = '.cache/upstream/tests/test_data/1CRN.pdb';
async function boot(page: Page) {
  await page.goto('./' + (process.env.EXPECTED_COMMIT ? '?build=' + process.env.EXPECTED_COMMIT : ''));
  await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
}
async function openFile(page: Page, path = pdb) {
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open File', exact: true }).click();
  await (await picker).setFiles(path);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByText(/1crn \(MolCoord\)/i).first()).toBeVisible();
}
async function call(page: Page, name: string, args?: any) {
  return page.evaluate(({ name, args }) => (window as any).__cuemolHost.call(name, args), { name, args });
}
async function fs(page: Page, operation: string, args: any = {}) {
  return page.evaluate(({ operation, args }) => (window as any).__cuemolHost.rpc(operation, args), { operation, args });
}
async function bytes(page: Page, path: string): Promise<Buffer> {
  const data = await page.evaluate(async path => Array.from(await (window as any).__cuemolHost.rpc('read', { path })), path);
  return Buffer.from(data as number[]);
}
function coloredPixels(png: PNG) {
  let count = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] && Math.max(...png.data.subarray(i, i + 3)) - Math.min(...png.data.subarray(i, i + 3)) > 20) count++;
  }
  return count;
}
test('real CueMol renderers, picking buffers, image output and camera interaction', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await boot(page);
  await openFile(page);
  const state = await fs(page, 'state');
  expect(state.sceneId).toBeGreaterThan(0);
  expect(state.viewId).toBeGreaterThan(0);
  const tree = await call(page, 'getSceneTree', state);
  let renderer = tree.tree.children.find((n: any) => n.type === 'object').children.find((n: any) => n.type === 'renderer');
  for (const type of ['simple', 'cartoon', 'ballstick', 'cpk', 'dsurface']) {
    if (type !== 'simple') {
      const result = await call(page, 'changeRendererType', { ...state, rendId: renderer.id, newType: type });
      expect(result.ok).toBe(true);
      renderer.id = result.newRendId;
    }
    const path = '/work/' + type + '.png';
    expect(await call(page, 'exportScene', { ...state, filePath: path, exporterName: 'png', width: 640, height: 480, alpha: true })).toMatchObject({ ok: true });
    const data = await bytes(page, path);
    const image = PNG.sync.read(data);
    expect(image.width).toBe(640);
    expect(image.height).toBe(480);
    expect(coloredPixels(image)).toBeGreaterThan(100);
    await testInfo.attach(type, { body: data, contentType: 'image/png' });
  }
  expect(await call(page, 'toggleSceneColorProofing', state)).toMatchObject({ ok: true, enabled: true });
  expect(await call(page, 'exportScene', { ...state, filePath: '/work/proof.png', exporterName: 'png', width: 640, height: 480, alpha: true })).toMatchObject({ ok: true });
  expect((await bytes(page, '/work/proof.png')).equals(await bytes(page, '/work/dsurface.png'))).toBe(false);
  expect(await call(page, 'toggleSceneColorProofing', state)).toMatchObject({ ok: true, enabled: false });
  const canvas = page.locator('canvas').first();
  const before = await canvas.screenshot();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.6, { steps: 12 });
  await page.mouse.up();
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(400);
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  expect(errors).toEqual([]);
});

test('scene context menus, selections and undo/redo retain native state', async ({ page }) => {
  await boot(page);
  await openFile(page);
  await page.getByText('simple1 (simple)', { exact: true }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Change type', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'cartoon', exact: true }).click();
  await expect(page.getByText('simple1 (cartoon)', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('simple1 (simple)', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByText('simple1 (cartoon)', { exact: true }).first()).toBeVisible();
  const state = await fs(page, 'state');
  const objects = await call(page, 'listSceneObjects', state);
  const molId = objects.objects[0].uid;
  expect(await call(page, 'getSelHitCount', { ...state, molId, selStr: '*' })).toEqual({ count: 327 });
  expect(await call(page, 'getSelHitCount', { ...state, molId, selStr: 'name CA' })).toEqual({ count: 46 });
  expect(await call(page, 'applyMolSelString', { ...state, molId, selStr: 'name CA' })).toMatchObject({ ok: true });
  expect(await call(page, 'createCamera', { ...state, name: 'test-camera' })).toMatchObject({ ok: true });
  expect((await call(page, 'listCameras', state)).cameras.map((c: any) => c.name)).toContain('test-camera');
});

test('compressed self-contained scene downloads, reloads and persists locally', async ({ page }, testInfo) => {
  await boot(page);
  await openFile(page);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save Scene', exact: true }).click();
  await page.getByLabel('File name', { exact: true }).fill('roundtrip.qsc');
  await page.getByRole('dialog', { name: 'Save file', exact: true }).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByLabel('Include structure data in this scene file')).toBeChecked();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  const download = await downloaded;
  const saved = testInfo.outputPath('roundtrip.qsc');
  await download.saveAs(saved);
  expect((await bytes(page, '/work/roundtrip.qsc')).length).toBeGreaterThan(2000);
  await call(page, 'createCamera', { ...await fs(page, 'state'), name: 'saved-camera' });
  const updatedDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save Scene', exact: true }).click();
  const updated = await updatedDownload;
  expect(updated.suggestedFilename()).toBe('roundtrip.qsc');
  await updated.saveAs(saved);
  await fs(page, 'remove', { path: '/work/uploads' });
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open Scene', exact: true }).click();
  await (await picker).setFiles(saved);
  await expect.poll(async () => (await fs(page, 'state')).scenes.length).toBe(2);
  const state = await fs(page, 'state');
  const objects = await call(page, 'listSceneObjects', state);
  expect(objects.objects).toHaveLength(1);
  expect((await call(page, 'listCameras', state)).cameras.map((camera: any) => camera.name)).toContain('saved-camera');
  expect(await call(page, 'getSelHitCount', { ...state, molId: objects.objects[0].uid, selStr: '*' })).toEqual({ count: 327 });
  await fs(page, 'flush');
  page.on('dialog', dialog => dialog.accept());
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
  expect(await fs(page, 'exists', { path: '/work/roundtrip.qsc' })).toBe(true);
});

test('viewport recording downloads a WebM file', async ({ page }, testInfo) => {
  await boot(page);
  await openFile(page);
  await page.getByRole('menuitem', { name: 'Rendering', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Record viewport (WebM)...', exact: true }).click();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  const canvas = page.locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 30, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Stop and download', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('cuemol-recording.webm');
  await download.saveAs(testInfo.outputPath('recording.webm'));
});

for (const [file, expectedName, count] of [
  ['1crn.cif', '1crn', 327],
  ['test1.sdf', 'test1', 37],
] as const) {
  test('imports ' + file + ' through the file dialog', async ({ page }) => {
    await boot(page);
    const picker = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Open File', exact: true }).click();
    await (await picker).setFiles('.cache/upstream/tests/test_data/' + file);
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.getByText(expectedName + ' (MolCoord)', { exact: true }).first()).toBeVisible();
    const state = await fs(page, 'state');
    const objects = await call(page, 'listSceneObjects', state);
    const result = await call(page, 'getSelHitCount', { ...state, molId: objects.objects[0].uid, selStr: '*' });
    expect(result.count).toBe(count);
  });
}

test('Get PDB streams a structure directly from RCSB', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Get PDB', exact: true }).click();
  await page.getByRole('textbox', { name: 'PDB Accession Code', exact: true }).fill('1crn');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByText('1crn (MolCoord)', { exact: true }).first()).toBeVisible({ timeout: 60000 });
  const state = await fs(page, 'state');
  const objects = await call(page, 'listSceneObjects', state);
  expect(await call(page, 'getSelHitCount', { ...state, molId: objects.objects[0].uid, selStr: '*' })).toEqual({ count: 327 });
});

async function upload(page: Page, local: string, virtual: string) {
  const { readFile } = await import('node:fs/promises');
  const data = await readFile(local);
  await fs(page, 'write', { path: virtual, data: Array.from(data) });
}
const rendererOptions = (objectName: string, rendererType: string) => ({
  objectName, rendererType, rendererName: rendererType + '1', selectionEnabled: false,
  selection: '*', centerView: true, mapCenterPolicy: 'moveViewCenter',
});

test('reads and contours a CCP4 density map', async ({ page }, testInfo) => {
  await boot(page);
  const state = await fs(page, 'state');
  await upload(page, '.cache/fixtures/density.map', '/work/density.map');
  const result = await call(page, 'loadObject', {
    ...state, filePath: '/work/density.map', contentFirst: false, readerName: 'ccp4map',
    options: { format: { kind: 'unknown', options: {} }, renderer: rendererOptions('density', 'isosurf') },
  });
  expect(result.ok).toBe(true);
  expect((await call(page, 'listSceneObjects', state)).objects[0].className).toBe('DensityMap');
  expect(await call(page, 'exportScene', { ...state, filePath: '/work/density.png', exporterName: 'png', width: 640, height: 480 })).toMatchObject({ ok: true });
  const png = await bytes(page, '/work/density.png');
  const pixels = PNG.sync.read(png).data;
  let visible = 0;
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 40) visible++;
  expect(visible).toBeGreaterThan(1000);
  await testInfo.attach('density', { body: png, contentType: 'image/png' });
});

test('reads a GRO topology and DCD trajectory and changes frames', async ({ page }) => {
  await boot(page);
  const state = await fs(page, 'state');
  await upload(page, '.cache/fixtures/water.gro', '/work/water.gro');
  await upload(page, '.cache/fixtures/water.dcd', '/work/water.dcd');
  const loaded = await call(page, 'plugin.mdtools.loadTrajectory', {
    sceneId: state.sceneId, topologyPath: '/work/water.gro', trajPaths: ['/work/water.dcd'],
    renderer: rendererOptions('water', 'cpk'),
  });
  expect(loaded.ok).toBe(true);
  const target = { sceneId: state.sceneId, objId: loaded.objId };
  expect(await call(page, 'plugin.mdtools.getTrajectoryState', target)).toMatchObject({ ok: true, nframe: 3, frame: 0 });
  await expect(page.getByText('Trajectory', { exact: true })).toBeVisible();
  expect(await call(page, 'plugin.mdtools.setTrajectoryFrame', { ...target, frame: 2 })).toMatchObject({ ok: true, frame: 2 });
  expect(await call(page, 'plugin.mdtools.getTrajectoryState', target)).toMatchObject({ frame: 2 });
});

test('copies and pastes a molecule through the scene context menu', async ({ page }) => {
  await boot(page);
  await openFile(page);
  await page.getByText(/1crn \(MolCoord\)/i).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
  await page.getByText('Scene: Untitled 1', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Paste Object', exact: true }).click();
  const state = await fs(page, 'state');
  await expect.poll(async () => (await call(page, 'listSceneObjects', state)).objects.length).toBe(2);
  const objects = (await call(page, 'listSceneObjects', state)).objects;
  for (const object of objects) {
    expect(await call(page, 'getSelHitCount', { ...state, molId: object.uid, selStr: '*' })).toEqual({ count: 327 });
  }
});

test('picks atoms from the rendered image and creates a distance label', async ({ page }, testInfo) => {
  await boot(page);
  await openFile(page);
  const state = await fs(page, 'state');
  const tree = (await call(page, 'getSceneTree', state)).tree;
  const renderer = tree.children.find((n: any) => n.type === 'object').children.find((n: any) => n.type === 'renderer');
  await call(page, 'changeRendererType', { ...state, rendId: renderer.id, newType: 'cpk' });
  const canvas = page.locator('canvas').first();
  await page.waitForTimeout(200);
  const screenshot = PNG.sync.read(await canvas.screenshot());
  const hits: Array<{ x: number; y: number; atomId: number }> = [];
  for (let y = Math.floor(screenshot.height / 3); y < screenshot.height * 2 / 3 && hits.length < 2; y += 15) {
    for (let x = Math.floor(screenshot.width / 3); x < screenshot.width * 2 / 3 && hits.length < 2; x += 15) {
      const offset = (y * screenshot.width + x) * 4;
      if (Math.max(...screenshot.data.subarray(offset, offset + 3)) < 40) continue;
      const result = await call(page, 'naviHitTest', { viewId: state.viewId, x, y });
      if (result.hit && !hits.some(h => h.atomId === result.raw.atom_id)) hits.push({ x, y, atomId: result.raw.atom_id });
    }
  }
  expect(hits).toHaveLength(2);
  expect(await call(page, 'measurePick', { viewId: state.viewId, ...hits[0], mode: 'distance' })).toMatchObject({ handled: true, picked: 1 });
  expect(await call(page, 'measurePick', { viewId: state.viewId, ...hits[1], mode: 'distance' })).toMatchObject({ handled: true, done: true });
  const after = (await call(page, 'getSceneTree', state)).tree;
  expect(JSON.stringify(after)).toContain('atomintr');
  await testInfo.attach('distance-label', { body: await canvas.screenshot(), contentType: 'image/png' });
});


test('PNG export downloads a rendered image', async ({ page }, testInfo) => {
  await boot(page);
  await openFile(page);
  await page.getByRole('menuitem', { name: 'Rendering', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export scene', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'PNG image...', exact: true }).click();
  await page.getByLabel('File name', { exact: true }).fill('viewport.png');
  await page.getByRole('dialog', { name: 'Save file', exact: true }).getByRole('button', { name: 'Save', exact: true }).click();
  const options = page.getByRole('dialog', { name: 'PNG options', exact: true });
  await options.getByRole('spinbutton').first().fill('640');
  const downloaded = page.waitForEvent('download');
  await options.getByRole('button', { name: 'OK', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('viewport.png');
  const saved = testInfo.outputPath('viewport.png');
  await download.saveAs(saved);
  const { readFile } = await import('node:fs/promises');
  const png = PNG.sync.read(await readFile(saved));
  expect(png.width).toBe(640);
  expect(coloredPixels(png)).toBeGreaterThan(100);
});

test('POV-Ray export includes geometry companion files in a ZIP', async ({ page }, testInfo) => {
  await boot(page);
  await openFile(page);
  await page.getByRole('menuitem', { name: 'Rendering', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export scene', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'POV-Ray SDL...', exact: true }).click();
  await page.getByLabel('File name', { exact: true }).fill('molecule.pov');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Save file', exact: true }).getByRole('button', { name: 'Save', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('molecule.zip');
  const saved = testInfo.outputPath('molecule.zip');
  await download.saveAs(saved);
  const { readFile } = await import('node:fs/promises');
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(await readFile(saved));
  expect(Object.keys(files)).toEqual(expect.arrayContaining(['molecule.pov', 'molecule.inc']));
  expect(strFromU8(files['molecule.pov'])).toContain('"molecule.inc"');
  expect(files['molecule.inc'].length).toBeGreaterThan(1000);
});

test('user display settings persist after a page reload', async ({ page }) => {
  await boot(page);
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Options/ }).click();
  await page.getByText('Atom Labels', { exact: true }).click();
  const input = page.getByRole('spinbutton').first();
  await input.fill('19');
  await input.press('Tab');
  await expect.poll(async () => (await call(page, 'getLabelDefaults', {})).defaults.fontSize).toBe(19);
  await expect.poll(async () => await fs(page, 'exists', { path: '/settings/user_styles.xml' })).toBe(true);
  await fs(page, 'flush');
  page.on('dialog', dialog => dialog.accept());
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
  expect((await call(page, 'getLabelDefaults', {})).defaults.fontSize).toBe(19);
});


test('Umbreon ray tracing and NPR render real images, retain history and download PNG', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await boot(page);
  await openFile(page);
  const state = await fs(page, 'state');
  const tree = await call(page, 'getSceneTree', state);
  const renderer = tree.tree.children.find((n: any) => n.type === 'object').children.find((n: any) => n.type === 'renderer');
  expect(await call(page, 'changeRendererType', { ...state, rendId: renderer.id, newType: 'cpk' })).toMatchObject({ ok: true });
  expect(await call(page, 'setSceneRenderSettings', { sceneId: state.sceneId, values: {
    backend: 'umbreon', width: 300, height: 300, transparentBg: true,
    'umbreon.supersample': 1, 'umbreon.useGI': true, 'umbreon.giSamples': 8,
    'umbreon.denoise': 'A-trous', 'umbreon_npr.supersample': 1,
  } })).toMatchObject({ ok: true });
  await page.getByRole('button', { name: 'Render', exact: true }).click();
  const frame = page.frameLocator('iframe[title="Umbreon rendering"]');
  const start = frame.getByRole('button', { name: 'Start Render', exact: true });
  await expect(start).toBeEnabled();
  await expect(frame.locator('.image-size-row input').first()).toHaveValue('300');
  await expect(frame.locator('.render-panel-backend-select select')).toHaveValue('umbreon');
  await start.click();
  const result = frame.getByRole('img', { name: 'Render result', exact: true });
  await expect(result).toBeVisible();
  await expect(frame.locator('.render-panel-status')).toContainText('Completed');
  const giSource = (await result.getAttribute('src'))!;
  const giData = Buffer.from(giSource.split(',')[1], 'base64');
  const gi = PNG.sync.read(giData);
  expect([gi.width, gi.height]).toEqual([300, 300]);
  expect(coloredPixels(gi)).toBeGreaterThan(100);
  expect(Array.from(gi.data).filter((value, index) => index % 4 === 3 && value === 0).length).toBeGreaterThan(100);
  await expect(frame.locator('.render-panel')).toContainText('GI pt2');
  await testInfo.attach('umbreon-gi', { body: giData, contentType: 'image/png' });
  await frame.getByRole('button', { name: 'Save image', exact: true }).click();
  await page.getByLabel('File name', { exact: true }).fill('umbreon.png');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Save file', exact: true }).getByRole('button', { name: 'Save', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('umbreon.png');
  const saved = testInfo.outputPath('umbreon.png');
  await download.saveAs(saved);
  const { readFile } = await import('node:fs/promises');
  expect((await readFile(saved)).equals(giData)).toBe(true);
  await frame.locator('.render-panel-backend-select select').selectOption('umbreon_npr');
  await start.click();
  await expect(result).not.toHaveAttribute('src', giSource);
  await expect(frame.locator('.render-panel-status')).toContainText('Completed');
  const nprData = Buffer.from((await result.getAttribute('src'))!.split(',')[1], 'base64');
  const npr = PNG.sync.read(nprData);
  expect([npr.width, npr.height]).toEqual([300, 300]);
  expect(nprData.equals(giData)).toBe(false);
  expect(npr.data.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
  await testInfo.attach('umbreon-npr', { body: nprData, contentType: 'image/png' });
  await page.getByRole('button', { name: 'Close rendering', exact: true }).click();
  await page.getByRole('button', { name: 'Render', exact: true }).click();
  await expect(result).toBeVisible();
  await expect(frame.locator('.rr-history-pos')).toHaveText('2 / 2');
  expect(errors).toEqual([]);
});

test('Umbreon rendering can be cancelled and restarted without blocking the scene', async ({ page }) => {
  await boot(page);
  await openFile(page);
  const state = await fs(page, 'state');
  await call(page, 'setSceneRenderSettings', { sceneId: state.sceneId, values: {
    backend: 'umbreon', width: 600, height: 600, 'umbreon.supersample': 4,
    'umbreon.useGI': true, 'umbreon.giSamples': 256, 'umbreon.denoise': 'A-trous',
  } });
  await page.getByRole('menuitem', { name: 'Rendering', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Ray tracing (Umbreon)...', exact: true }).click();
  const frame = page.frameLocator('iframe[title="Umbreon rendering"]');
  await expect(frame.locator('.image-size-row input').first()).toHaveValue('600');
  await frame.getByRole('button', { name: 'Start Render', exact: true }).click();
  await frame.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(frame.locator('.render-panel-status')).toContainText('Cancelled');
  await expect.poll(() => call(page, 'getSceneTree', state)).toHaveProperty('tree');
  await call(page, 'setSceneRenderSettings', { sceneId: state.sceneId, values: {
    width: 100, height: 100, 'umbreon.supersample': 1, 'umbreon.giSamples': 8,
  } });
  await expect(frame.locator('.image-size-row input').first()).toHaveValue('100');
  await frame.getByRole('button', { name: 'Start Render', exact: true }).click();
  await expect(frame.getByRole('img', { name: 'Render result', exact: true })).toBeVisible();
  await expect(frame.locator('.render-panel-status')).toContainText('Completed');
});
