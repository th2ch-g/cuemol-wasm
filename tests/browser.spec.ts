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
  const objectName = path.split('/').pop()!.replace(/\.[^.]+$/, '').toLowerCase();
  await expect(page.getByText(new RegExp('^' + objectName + ' \\(MolCoord\\)$', 'i')).first()).toBeVisible();
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
  await openFile(page, '.cache/fixtures/8gng.cif');
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
  expect(await call(page, 'getSelHitCount', { ...state, molId: objects.objects[0].uid, selStr: '*' })).toEqual({ count: 11322 });
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


for (const exporter of [
  { name: 'PNG', label: 'PNG image...', width: 640 },
  { name: 'Umbreon', label: 'Umbreon ray-traced image...', width: 240 },
]) {
test(exporter.name + ' export downloads a rendered image', async ({ page }, testInfo) => {
  await boot(page);
  await openFile(page);
  await page.getByRole('menuitem', { name: 'Rendering', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export scene', exact: true }).hover();
  await page.getByRole('menuitem', { name: exporter.label, exact: true }).click();
  await page.getByLabel('File name', { exact: true }).fill('viewport.png');
  await page.getByRole('dialog', { name: 'Save file', exact: true }).getByRole('button', { name: 'Save', exact: true }).click();
  const options = page.getByRole('dialog', { name: 'PNG options', exact: true });
  await options.getByRole('spinbutton').first().fill(String(exporter.width));
  const downloaded = page.waitForEvent('download');
  await options.getByRole('button', { name: 'OK', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('viewport.png');
  const saved = testInfo.outputPath('viewport.png');
  await download.saveAs(saved);
  const { readFile } = await import('node:fs/promises');
  const png = PNG.sync.read(await readFile(saved));
  expect(png.width).toBe(exporter.width);
  expect(coloredPixels(png)).toBeGreaterThan(100);
});

}

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

test('8GNG ribbon renders at the default 1200px GI and NPR quality and renders again', async ({ page }, testInfo) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await boot(page);
  await openFile(page, '.cache/fixtures/8gng.cif');
  const state = await fs(page, 'state');
  const tree = await call(page, 'getSceneTree', state);
  const renderer = tree.tree.children.find((n: any) => n.type === 'object').children.find((n: any) => n.type === 'renderer');
  expect(await call(page, 'changeRendererType', { ...state, rendId: renderer.id, newType: 'ribbon' })).toMatchObject({ ok: true });
  await page.getByRole('button', { name: 'Render', exact: true }).click();
  const frame = page.frameLocator('iframe[title="Umbreon rendering"]');
  await expect(frame.locator('html')).toHaveAttribute('data-app-ready', 'true');
  await expect(frame.locator('.image-size-row input').first()).toHaveValue('1200');
  const result = frame.getByRole('img', { name: 'Render result', exact: true });
  let previous = '';
  for (const [index, backend] of ['umbreon', 'umbreon_npr', 'umbreon'].entries()) {
    await frame.locator('.render-panel-backend-select select').selectOption(backend);
    await frame.getByRole('button', { name: 'Start Render', exact: true }).click();
    await expect(frame.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await expect(frame.locator('.render-panel-status')).toContainText(/Completed|Error/, { timeout: 180000 });
    await expect(frame.locator('.render-panel-status')).toContainText('Completed');
    await expect(result).toBeVisible();
    const source = (await result.getAttribute('src'))!;
    expect(source).not.toBe(previous);
    previous = source;
    const data = Buffer.from(source.split(',')[1], 'base64');
    const png = PNG.sync.read(data);
    expect([png.width, png.height]).toEqual([1200, 1200]);
    expect(png.data.some((value, i) => i % 4 !== 3 && value > 32)).toBe(true);
    await expect(frame.locator('.render-panel')).toContainText('render 1200x1200 ss3 (grid 3600x3600)');
    if (backend === 'umbreon') await expect(frame.locator('.render-panel')).toContainText('GI pt2 32spp');
    await testInfo.attach(backend + '-' + index, { body: data, contentType: 'image/png' });
  }
  await expect(frame.locator('.rr-history-pos')).toHaveText('3 / 3');
  await page.getByRole('button', { name: 'Close rendering', exact: true }).click();
  expect((await call(page, 'getSceneTree', state)).tree).toBeTruthy();
  expect(await call(page, 'exportScene', { ...state, filePath: '/work/after-large-render.png', exporterName: 'png', width: 640, height: 480 })).toMatchObject({ ok: true });
  expect(coloredPixels(PNG.sync.read(await bytes(page, '/work/after-large-render.png')))).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
});

test('Umbreon reports a memory allocation failure and can render after it', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit does not reliably trigger the injected worker memory-growth failure.');
  await boot(page);
  await openFile(page);
  const state = await fs(page, 'state');
  await call(page, 'setSceneRenderSettings', { sceneId: state.sceneId, values: {
    backend: 'umbreon', width: 100, height: 100, 'umbreon.supersample': 1,
  } });
  await page.getByRole('button', { name: 'Render', exact: true }).click();
  const frame = page.frameLocator('iframe[title="Umbreon rendering"]');
  await expect(frame.locator('html')).toHaveAttribute('data-app-ready', 'true');
  await frame.getByRole('button', { name: 'Start Render', exact: true }).click();
  await expect(frame.locator('.render-panel-status')).toContainText('Completed');
  await call(page, 'setSceneRenderSettings', { sceneId: state.sceneId, values: {
    width: 600, height: 600, 'umbreon.supersample': 3,
  } });
  await expect(frame.locator('.image-size-row input').first()).toHaveValue('600');
  await upload(page, '.cache/fixtures/8gng.cif', '/work/allocation.cif');
  const loaded = await call(page, 'loadObject', {
    ...state, filePath: '/work/allocation.cif', contentFirst: false,
    options: { format: { kind: 'unknown', options: {} }, renderer: rendererOptions('allocation', 'cpk') },
  });
  expect(loaded, JSON.stringify(loaded)).toMatchObject({ ok: true });
  const workers = page.workers();
  expect(workers.length).toBeGreaterThan(0);
  for (const worker of workers) await worker.evaluate(() => {
    (globalThis as any).__savedMemoryGrow = WebAssembly.Memory.prototype.grow;
    WebAssembly.Memory.prototype.grow = function () { throw new RangeError('Injected memory allocation failure'); };
  });
  await frame.getByRole('button', { name: 'Start Render', exact: true }).click();
  await expect(frame.locator('.render-panel-status')).toContainText('Error');
  await expect(frame.getByRole('alertdialog')).toContainText('WebAssembly memory allocation failed');
  for (const worker of workers) await worker.evaluate(() => {
    WebAssembly.Memory.prototype.grow = (globalThis as any).__savedMemoryGrow;
    delete (globalThis as any).__savedMemoryGrow;
  });
  await frame.getByRole('button', { name: 'OK', exact: true }).click();
  expect(await call(page, 'deleteNode', { ...state, nodeId: loaded.objId, nodeType: 'object' })).toMatchObject({ ok: true });
  const remaining = (await call(page, 'listSceneObjects', state)).objects[0];
  expect(await call(page, 'focusOnNode', { ...state, nodeId: remaining.uid, nodeType: 'object' })).toMatchObject({ ok: true });
  await call(page, 'setSceneRenderSettings', { sceneId: state.sceneId, values: {
    width: 100, height: 100, 'umbreon.supersample': 1,
  } });
  await expect(frame.locator('.image-size-row input').first()).toHaveValue('100');
  await frame.getByRole('button', { name: 'Start Render', exact: true }).click();
  await expect(frame.locator('.render-panel-status')).toContainText('Completed');
  await expect(frame.getByRole('img', { name: 'Render result', exact: true })).toBeVisible();
});

async function loadedObject(page: Page) {
  const state = await fs(page, 'state');
  const object = (await call(page, 'listSceneObjects', state)).objects[0];
  const tree = await call(page, 'getSceneTree', state);
  const renderer = tree.tree.children.find((n: any) => n.type === 'object').children.find((n: any) => n.type === 'renderer');
  return { state, object, renderer };
}

test('8GNG representations, selection, coloring, projection and camera files work together', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await boot(page);
  await openFile(page, '.cache/fixtures/8gng.cif');
  const { state, object, renderer } = await loadedObject(page);
  expect(await call(page, 'getSelHitCount', { ...state, molId: object.uid, selStr: '*' })).toEqual({ count: 11322 });
  expect(await call(page, 'focusOnNode', { ...state, nodeId: object.uid, nodeType: 'object' })).toMatchObject({ ok: true });
  const hashes = new Set<string>();
  const { createHash } = await import('node:crypto');
  for (const type of ['simple', 'ribbon', 'cartoon', 'ballstick', 'cpk', 'dsurface']) {
    if (type !== 'simple') {
      const changed = await call(page, 'changeRendererType', { ...state, rendId: renderer.id, newType: type });
      expect(changed.ok).toBe(true);
      renderer.id = changed.newRendId;
    }
    const path = '/work/8gng-' + type + '.png';
    expect(await call(page, 'exportScene', { ...state, filePath: path, exporterName: 'png', width: 640, height: 480 })).toMatchObject({ ok: true });
    const data = await bytes(page, path);
    expect(coloredPixels(PNG.sync.read(data))).toBeGreaterThan(1000);
    hashes.add(createHash('sha256').update(data).digest('hex'));
    await testInfo.attach(type, { body: data, contentType: 'image/png' });
  }
  expect(hashes.size).toBe(6);
  expect(await call(page, 'applyMolSelString', { ...state, molId: object.uid, selStr: 'chain A and name CA' })).toMatchObject({ ok: true });
  expect((await call(page, 'getSelHitCount', { ...state, molId: object.uid, selStr: 'chain A and name CA' })).count).toBeGreaterThan(100);
  expect(await call(page, 'setRendererColoring', { ...state, rendId: renderer.id, coloringId: 'paint-type-rainbow' })).toMatchObject({ ok: true });
  expect(await call(page, 'exportScene', { ...state, filePath: '/work/rainbow.png', exporterName: 'png', width: 640, height: 480 })).toMatchObject({ ok: true });
  expect((await bytes(page, '/work/rainbow.png')).equals(await bytes(page, '/work/8gng-dsurface.png'))).toBe(false);
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Perspective', exact: true }).click();
  expect(await call(page, 'getViewProjection', state)).toMatchObject({ ok: true, perspective: true });
  await page.getByRole('menuitem', { name: 'Scene', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Background', exact: true }).hover();
  await page.getByRole('menuitemradio', { name: 'White', exact: true }).click();
  expect(await call(page, 'createCamera', { ...state, name: '8gng-camera' })).toMatchObject({ ok: true });
  expect(await call(page, 'saveViewToCamera', { ...state, name: '8gng-camera' })).toMatchObject({ ok: true });
  const original = await call(page, 'getViewXform', state);
  expect(await call(page, 'saveCameraToFile', { ...state, name: '8gng-camera', path: '/work/8gng.qcam' })).toMatchObject({ ok: true });
  expect((await bytes(page, '/work/8gng.qcam')).length).toBeGreaterThan(100);
  expect(await call(page, 'setViewXform', { ...state, zoom: original.zoom / 2 })).toMatchObject({ ok: true });
  expect(await call(page, 'loadCameraFromFile', { ...state, path: '/work/8gng.qcam' })).toMatchObject({ ok: true });
  expect((await call(page, 'getViewXform', state)).zoom).toBeCloseTo(original.zoom, 4);
  expect(errors).toEqual([]);
});

test('molecule editing changes native atoms and supports undo and redo', async ({ page }) => {
  await boot(page);
  await openFile(page);
  const { state, object } = await loadedObject(page);
  const target = { ...state, objId: object.uid };
  const count = (selStr: string) => call(page, 'getSelHitCount', { ...state, molId: object.uid, selStr }).then(result => result.count);
  expect(await call(page, 'changeChainName', { ...target, selStr: '*', chainName: 'X' })).toMatchObject({ ok: true });
  expect(await count('chain X')).toBe(327);
  expect(await call(page, 'changeResidueIndex', { ...target, selStr: '*', bshift: true, value: 100, renumber: false })).toMatchObject({ ok: true });
  expect(await count('resi 101:146')).toBe(327);
  expect(await call(page, 'deleteMolAtoms', { ...target, selStr: 'name CA' })).toMatchObject({ ok: true });
  await expect.poll(() => count('*')).toBe(281);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => count('*')).toBe(327);
  expect(await count('name CA')).toBe(46);
  expect(await count('chain X and resi 101:146')).toBe(327);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => count('*')).toBe(281);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => count('*')).toBe(327);
  const atoms = await call(page, 'getMolAtoms', { ...state, molId: object.uid, chainName: 'X', residueIndex: '101' });
  const atomId = atoms.atoms.find((atom: any) => atom.name === 'CA').id;
  expect(await count('aid ' + atomId)).toBe(1);
  expect(await call(page, 'deleteMolAtoms', { ...target, selStr: 'aid ' + atomId })).toMatchObject({ ok: true });
  expect(await count('*')).toBe(326);
  expect(await call(page, 'undo', state)).toMatchObject({ ok: true });
  expect(await count('*')).toBe(327);
  expect(await call(page, 'redo', state)).toMatchObject({ ok: true });
  expect(await count('*')).toBe(326);
  expect(await call(page, 'undo', state)).toMatchObject({ ok: true });
  expect(await count('name CA')).toBe(46);
  expect(await call(page, 'reassignProt2ndry', { ...target, mode: 'recalc', ignBulge: false, helixGapAngle: 20 })).toMatchObject({ ok: true });
  const interactions = await call(page, 'analyzeInteractions', { ...target, selStr: '*', useMol2: false, useSel2: false, minDist: 2.5, maxDist: 3.5, maxLabels: 100, hbondOnly: false, rendName: 'contacts' });
  expect(interactions).toMatchObject({ ok: true });
  expect(interactions.count).toBeGreaterThan(0);
});

test('surface generation and cutting produce a renderable native surface', async ({ page }, testInfo) => {
  await boot(page);
  await openFile(page);
  const { state, object } = await loadedObject(page);
  const surface = await call(page, 'makeMolSurf', { ...state, objId: object.uid, selStr: '*', surfName: 'protein-surface', density: 2, probeRadius: 1.4 });
  expect(surface).toMatchObject({ ok: true, newObjName: 'protein-surface' });
  expect((await call(page, 'listSceneObjects', state)).objects.some((entry: any) => entry.className === 'MolSurfObj')).toBe(true);
  const exported = () => call(page, 'exportScene', { ...state, filePath: '/work/surface.png', exporterName: 'png', width: 640, height: 480 });
  expect(await exported()).toMatchObject({ ok: true });
  const before = await bytes(page, '/work/surface.png');
  expect(coloredPixels(PNG.sync.read(before))).toBeGreaterThan(100);
  const camera = await call(page, 'getViewXform', state);
  expect(await call(page, 'setViewXform', { ...state, slab: 5 })).toMatchObject({ ok: true });
  expect(await call(page, 'cutSurfByPlane', { ...state, objId: surface.newObjId, mode: 'full', density: 2 })).toMatchObject({ ok: true });
  expect(await call(page, 'setViewXform', { ...state, slab: camera.slab })).toMatchObject({ ok: true });
  expect(await exported()).toMatchObject({ ok: true });
  const after = await bytes(page, '/work/surface.png');
  expect(after.equals(before)).toBe(false);
  await testInfo.attach('cut-surface', { body: after, contentType: 'image/png' });
});

test('morph frames and animation playback advance and can be paused and sought', async ({ page }) => {
  await boot(page);
  await openFile(page);
  const { state, object } = await loadedObject(page);
  const converted = await call(page, 'convertToMorphMol', { ...state, objId: object.uid });
  expect(converted).toMatchObject({ ok: true });
  const target = { ...state, objId: converted.morphObjId };
  expect(await call(page, 'getMorphFrames', target)).toMatchObject({ ok: true, isMorphMol: true });
  await upload(page, pdb, '/work/morph-frame.pdb');
  expect(await call(page, 'addMorphFrameFromFile', { ...target, path: '/work/morph-frame.pdb', insertIndex: -1 })).toMatchObject({ ok: true });
  expect((await call(page, 'getMorphFrames', target)).frames).toHaveLength(2);
  const spin = await call(page, 'animAddElement', { ...state, type: 'SimpleSpin' });
  expect(spin).toMatchObject({ ok: true });
  expect(await call(page, 'animSetElementTime', { ...state, uid: spin.uid, startMs: 0, endMs: 5000 })).toMatchObject({ ok: true });
  expect(await call(page, 'animPlay', state)).toMatchObject({ ok: true });
  await expect.poll(async () => (await call(page, 'animGetMgrState', state)).elapsedMs).toBeGreaterThan(200);
  const paused = await call(page, 'animPause', state);
  expect(paused).toMatchObject({ ok: true, mgr: { playState: 'pause' } });
  await page.waitForTimeout(200);
  expect((await call(page, 'animGetMgrState', state)).elapsedMs).toBe(paused.mgr.elapsedMs);
  expect(await call(page, 'animGoTime', { ...state, ms: 2500 })).toMatchObject({ ok: true, mgr: { elapsedMs: 2500 } });
  expect(await call(page, 'animStop', state)).toMatchObject({ ok: true, mgr: { playState: 'stop' } });
});

test('all molecule tool dialogs open from their menus without runtime errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await boot(page);
  await openFile(page);
  for (const [menu, entries] of [
    ['Edit', ['Merge molecule...', 'Delete mol atoms...', 'Change chain ID...', 'Change residue number...']],
    ['Tools', ['Molecular superposition...', 'Interaction...', 'Reassign secondary str...', 'Mol morphing animation...', 'Mol surface generation...', 'Mol surface cutter...']],
  ] as const) {
    for (const name of entries) {
      await page.getByRole('menuitem', { name: menu, exact: true }).click();
      await page.getByRole('menuitem', { name, exact: true }).click();
      const dialog = page.getByRole('dialog').last();
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: /^(Cancel|Close)$/ }).click();
      await expect(dialog).not.toBeVisible();
    }
  }
  await page.getByRole('menuitem', { name: 'Help', exact: true }).click();
  await page.getByRole('menuitem', { name: /^About / }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(errors).toEqual([]);
});

test('object coordinate formats and geometry exports preserve real molecular data', async ({ page }, testInfo) => {
  await boot(page);
  await openFile(page);
  const { state, object, renderer } = await loadedObject(page);
  await page.getByText(/1crn \(MolCoord\)/i).first().click();
  await page.getByRole('button', { name: 'Save Object', exact: true }).click();
  await page.getByLabel('File name', { exact: true }).fill('coordinates.pdb');
  const pending = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Save file', exact: true }).getByRole('button', { name: 'Save', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('coordinates.pdb');
  const saved = testInfo.outputPath('coordinates.pdb');
  await download.saveAs(saved);
  const { readFile } = await import('node:fs/promises');
  expect((await readFile(saved, 'utf8')).split('\n').filter(line => /^(ATOM  |HETATM)/.test(line))).toHaveLength(327);
  const writers = await call(page, 'getObjectSaveInfo', { ...state, objId: object.uid });
  expect(writers.ok).toBe(true);
  for (const writer of writers.filters) {
    const path = '/work/roundtrip.' + writer.extensions[0];
    expect(await call(page, 'saveObjectToFile', { ...state, objId: object.uid, writerName: writer.name, path })).toMatchObject({ ok: true });
    expect((await bytes(page, path)).length).toBeGreaterThan(100);
    if (writer.name === 'pqr' || writer.name === 'xyzr') {
      const lines = (await bytes(page, path)).toString().trim().split('\n');
      expect(lines).toHaveLength(327);
      for (const line of lines) {
        const fields = line.trim().split(/\s+/);
        const values = fields.slice(writer.name === 'pqr' ? -5 : -4).map(Number);
        expect(values.every(Number.isFinite)).toBe(true);
        expect(values.at(-1)).toBeGreaterThan(0);
      }
      continue;
    }
    const loaded = await call(page, 'loadObject', {
      ...state, filePath: path, contentFirst: true,
      options: { format: { kind: 'unknown', options: {} }, renderer: rendererOptions('roundtrip-' + writer.name, 'simple') },
    });
    expect(loaded, JSON.stringify(loaded)).toMatchObject({ ok: true });
    const mol = (await call(page, 'listSceneObjects', state)).objects.find((entry: any) => entry.name === 'roundtrip-' + writer.name);
    expect(mol).toBeTruthy();
    expect(await call(page, 'getSelHitCount', { ...state, molId: mol.uid, selStr: '*' })).toEqual({ count: 327 });
    expect(await call(page, 'deleteNode', { ...state, nodeId: mol.uid, nodeType: 'object' })).toMatchObject({ ok: true });
  }
  expect(await call(page, 'changeRendererType', { ...state, rendId: renderer.id, newType: 'cartoon' })).toMatchObject({ ok: true });
  for (const [label, filename] of [['STL...', 'protein.stl'], ['Metasequoia (MQO)...', 'protein.mqo']] as const) {
    await page.getByRole('menuitem', { name: 'Rendering', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Export scene', exact: true }).hover();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
    await page.getByLabel('File name', { exact: true }).fill(filename);
    const pending = page.waitForEvent('download');
    await page.getByRole('dialog', { name: 'Save file', exact: true }).getByRole('button', { name: 'Save', exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(filename);
    const path = testInfo.outputPath(filename);
    await download.saveAs(path);
    const data = await readFile(path);
    expect(data.length).toBeGreaterThan(10000);
    if (filename.endsWith('.mqo')) expect(data.toString()).toContain('Metasequoia Document');
    else expect(data.length).toBe(84 + data.readUInt32LE(80) * 50);
  }
});

test('LSQ and SSM superposition align shifted coordinates and molecule merge retains atoms', async ({ page }) => {
  await boot(page);
  await openFile(page);
  const { state, object } = await loadedObject(page);
  const { readFile } = await import('node:fs/promises');
  const original = await readFile(pdb, 'utf8');
  const shifted = original.split('\n').map(line => {
    if (!/^(ATOM  |HETATM)/.test(line)) return line;
    const xyz = [30, 38, 46].map((start, axis) => (Number(line.slice(start, start + 8)) + [10, 5, -3][axis]).toFixed(3).padStart(8)).join('');
    return line.slice(0, 30) + xyz + line.slice(54);
  }).join('\n');
  await fs(page, 'write', { path: '/work/shifted.pdb', data: Array.from(Buffer.from(shifted)) });
  const coords = (data: string) => data.split('\n').filter(line => /^ATOM  /.test(line)).map(line => [30, 38, 46].map(start => Number(line.slice(start, start + 8))));
  const reference = coords(original);
  let movingId = 0;
  for (const algo of ['LSQ', 'SSM']) {
    expect(await call(page, 'loadObject', {
      ...state, filePath: '/work/shifted.pdb', readerName: 'pdb', contentFirst: false,
      options: { format: { kind: 'unknown', options: {} }, renderer: rendererOptions('shifted-' + algo, 'simple') },
    })).toMatchObject({ ok: true });
    movingId = (await call(page, 'listSceneObjects', state)).objects.find((entry: any) => entry.name === 'shifted-' + algo).uid;
    const selection = algo === 'SSM' ? '*' : 'name CA';
    const alignedResult = await call(page, 'superposeMol', { ...state, algo, refObjId: object.uid, refSel: selection, movObjId: movingId, movSel: selection, useprop: false, autoRecenter: true });
    expect(alignedResult, JSON.stringify(alignedResult)).toMatchObject({ ok: true });
    expect(await call(page, 'saveObjectToFile', { ...state, objId: movingId, writerName: 'pdb', path: '/work/aligned.pdb' })).toMatchObject({ ok: true });
    const aligned = coords((await bytes(page, '/work/aligned.pdb')).toString());
    expect(aligned).toHaveLength(reference.length);
    const rmsd = Math.sqrt(aligned.reduce((sum, xyz, i) => sum + xyz.reduce((s, value, axis) => s + (value - reference[i][axis]) ** 2, 0), 0) / aligned.length);
    expect(rmsd).toBeLessThan(0.005);
  }
  expect(await call(page, 'changeChainName', { ...state, objId: movingId, selStr: '*', chainName: 'X' })).toMatchObject({ ok: true });
  expect(await call(page, 'mergeMol', { ...state, fromObjId: movingId, toObjId: object.uid, selStr: '*', copy: true })).toMatchObject({ ok: true });
  expect(await call(page, 'getSelHitCount', { ...state, molId: object.uid, selStr: '*' })).toEqual({ count: 654 });
  expect(await call(page, 'undo', state)).toMatchObject({ ok: true });
  expect(await call(page, 'getSelHitCount', { ...state, molId: object.uid, selStr: '*' })).toEqual({ count: 327 });
  expect(await call(page, 'redo', state)).toMatchObject({ ok: true });
  expect(await call(page, 'getSelHitCount', { ...state, molId: object.uid, selStr: '*' })).toEqual({ count: 654 });
});


test('console commands change native representations and report atom counts', async ({ page }) => {
  await boot(page);
  await openFile(page);
  await page.getByText('Console', { exact: true }).first().click();
  const native = page.getByLabel('CueMol> command', { exact: true });
  await native.fill('pymol');
  await native.press('Enter');
  const prompt = page.getByLabel('PyM> command', { exact: true });
  await prompt.fill('count_atoms all');
  await prompt.press('Enter');
  await expect(page.getByText('count_atoms: 327 atoms', { exact: false })).toBeVisible();
  await prompt.fill('as cartoon, all; color red, all; bg_color white');
  await prompt.press('Enter');
  const state = await fs(page, 'state');
  await expect.poll(async () => JSON.stringify(await call(page, 'getSceneTree', state))).toContain('cartoon');
  expect(await call(page, 'exportScene', { ...state, filePath: '/work/console.png', exporterName: 'png', width: 320, height: 240 })).toMatchObject({ ok: true });
  const image = PNG.sync.read(await bytes(page, '/work/console.png'));
  expect(coloredPixels(image)).toBeGreaterThan(100);
  expect(Array.from(image.data.subarray(0, 3))).toEqual([255, 255, 255]);
  await prompt.fill('count_atoms name CA');
  await prompt.press('Enter');
  await expect(page.getByText('count_atoms: 46 atoms', { exact: false })).toBeVisible();
});

test('custom style colors and selections survive file export and import', async ({ page }) => {
  await boot(page);
  await openFile(page);
  const state = await fs(page, 'state');
  const created = await call(page, 'createStyleSet', { ...state, name: 'test-style' });
  expect(created).toMatchObject({ ok: true });
  const target = { ...state, styleSetId: created.newId, scopeId: state.sceneId };
  expect(await call(page, 'setStyleSetColor', { ...target, name: 'accent', colorStr: '#123456' })).toMatchObject({ ok: true });
  expect(await call(page, 'setStyleSetSelection', { ...target, name: 'alpha', value: 'name CA' })).toMatchObject({ ok: true });
  const before = await call(page, 'getStyleSetContents', target);
  expect(before).toMatchObject({ ok: true, colors: [{ name: 'accent', hex: '#123456' }], selections: [{ name: 'alpha', value: 'name CA' }] });
  expect(await call(page, 'saveStyleSetToFile', { ...target, path: '/work/custom-style.xml' })).toMatchObject({ ok: true });
  const exported = (await bytes(page, '/work/custom-style.xml')).toString();
  expect(exported).toContain('accent');
  expect(exported).toContain('name CA');
  expect(await call(page, 'destroyStyleSet', target)).toMatchObject({ ok: true });
  const loaded = await call(page, 'loadStyleSetFromFile', { ...state, path: '/work/custom-style.xml' });
  expect(loaded).toMatchObject({ ok: true });
  const after = await call(page, 'getStyleSetContents', { styleSetId: loaded.newId });
  expect(after).toMatchObject({ ok: true, colors: before.colors, selections: before.selections, readonly: true });
});


test('sequence clicks and range selection update native residue selections', async ({ page }) => {
  await boot(page);
  await openFile(page);
  const { state, object } = await loadedObject(page);
  const chain = (await call(page, 'getMolChains', { ...state, molId: object.uid })).chains[0].name;
  const residues = () => call(page, 'getMolResidues', { ...state, molId: object.uid, chainName: chain }).then(result => result.residues);
  expect(await residues()).toHaveLength(46);
  expect(await call(page, 'selectObjectMol', { ...state, objId: object.uid, kind: 'unselect' })).toMatchObject({ ok: true });
  await page.getByText('Sequence', { exact: true }).first().click();
  const canvas = page.locator('.seq-canvas');
  await expect(canvas).toBeVisible();
  const width = await canvas.evaluate(element => element.getBoundingClientRect().width / 56);
  const height = await page.locator('.seq-name-item').first().evaluate(element => element.getBoundingClientRect().height);
  await canvas.click({ position: { x: width * 1.5, y: height / 2 } });
  await expect.poll(async () => (await residues()).filter((residue: any) => residue.sel).map((residue: any) => residue.index)).toEqual(['1']);
  await canvas.click({ position: { x: width * 5.5, y: height / 2 }, modifiers: ['Shift'] });
  await expect.poll(async () => (await residues()).filter((residue: any) => residue.sel).map((residue: any) => residue.index)).toEqual(['1', '2', '3', '4', '5']);
  await canvas.click({ position: { x: width * 1.5, y: height / 2 }, button: 'right' });
  await page.getByRole('menuitem', { name: 'Unselect all', exact: true }).click();
  await expect.poll(async () => (await residues()).filter((residue: any) => residue.sel).length).toBe(0);
});
