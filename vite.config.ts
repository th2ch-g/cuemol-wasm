import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, relative, dirname } from 'node:path';
import { readFileSync } from 'node:fs';

const root = import.meta.dirname;
const upstream = resolve(root, '.cache/upstream/tritium');
const renderer = resolve(upstream, 'react-gui/src/renderer');
function adapt(code: string, id: string, changes: [string | RegExp, string][]) {
  for (const [before, after] of changes) {
    const next = code.replace(before, after);
    if (next === code) throw new Error('Upstream browser integration changed: ' + id + ' (' + before + ')');
    code = next;
  }
  return code;
}
function browserAdapter() {
  return {
    name: 'cuemol-browser-host',
    enforce: 'pre' as const,
    resolveId(source: string, importer?: string) {
      if (importer?.startsWith(resolve(upstream, 'core/src')) && source.startsWith('./wrappers/')) {
        return resolve(root, 'build/core/ts/wrappers', source.slice('./wrappers/'.length) + '.ts');
      }
      if (importer?.startsWith(resolve(root, 'build/core/ts/wrappers')) && source === '../BaseWrapper') {
        return resolve(upstream, 'core/src/BaseWrapper.ts');
      }
      return null;
    },
    transform(code: string, id: string) {
      if (id.endsWith('/worker/client/WorkerTransport.ts')) {
        const target = relative(dirname(id), resolve(root, 'src/browser/worker.ts')).replaceAll('\\', '/');
        return adapt(code, id, [
          ["new Worker(new URL('../server/worker_launcher.ts', import.meta.url))", `new Worker(new URL('${target}', import.meta.url), { type: 'module' })`],
          ["log.info('launch worker OK');", "globalThis.__cuemolWasmAttachWorker?.(this._worker);"],
        ]);
      }
      if (id.endsWith('/worker/server/gfx_manager.ts')) return adapt(code, id, [
        ["canvas.getContext('webgl2', { antialias: false })", "canvas.getContext('webgl2', { antialias: false, stencil: true })"],
      ]);
      if (id.endsWith('/shell/Toolbar.tsx')) return adapt(code, id, [
        ['text: "Save As"', 'text: "Save Object"'],
      ]);
      if (id === resolve(upstream, 'react-gui/src/plugins/index.ts')) return readFileSync(resolve(root, 'src/browser/plugins.ts'), 'utf8');
      if (id.endsWith('/commands/useRenderCommands.ts')) return readFileSync(resolve(root, 'src/browser/render-commands.ts'), 'utf8').replace("'./recording'", JSON.stringify(resolve(root, 'src/browser/recording.ts')));
      if (id.endsWith('/features/render/renderwindow/RenderWindowApp.tsx')) return adapt(code, id, [
        ['? RENDER_BACKEND_IDS', '? RENDER_BACKEND_IDS.filter(id => id !== "povray")'],
      ]);
      if (id.endsWith('/data/renderBackends.ts')) return adapt(code, id, [
        ['options: ["OIDN", "A-trous", "None"]', 'options: ["A-trous", "None"]'],
      ]);
      if (id.endsWith('/features/render/sceneRenderSettings.ts')) return adapt(code, id, [
        ['const rawBackend = values.backend;', 'const rawBackend = values.backend === "povray" ? "umbreon" : values.backend;'],
      ]);
      if (id.endsWith('/shared/menuTemplate.ts')) return adapt(code, id, [
        ["label: 'Image rendering...'", "label: 'Ray tracing (Umbreon)...'"],
        ["label: 'Movie rendering...'", "label: 'Record viewport (WebM)...'"],
        [/^[ \t]*\{ id: 'apbs',.*\n/m, ''],
      ]);
      if (id.endsWith('/features/settings/settings/settingsConfig.ts')) return adapt(code, id, [
        ['export const CATEGORY_TREE:', 'const NATIVE_CATEGORY_TREE:'],
        ['/** Leaf-node ids of', "export const CATEGORY_TREE = NATIVE_CATEGORY_TREE.filter(node => node.id !== 'tools').map(node => ({ ...node, children: node.children.filter(child => child.id !== 'display.rendering') }));\n\n/** Leaf-node ids of"],
        ['export const SETTINGS:', 'const NATIVE_SETTINGS:'],
        ['// --- Default values ---', "export const SETTINGS = NATIVE_SETTINGS.filter(setting => !['display.rendering', 'tools.apbs'].includes(setting.category) && setting.key !== 'files.shellTarget');\n\n// --- Default values ---"],
      ]);
      if (id.endsWith('/worker/server/workerLifecycle.ts')) {
        const start = code.indexOf('export function loadUserStyle(');
        const end = code.indexOf('/**\n * Save the "user" style', start);
        if (start < 0 || end < 0) throw new Error('Upstream style lifecycle changed.');
        return code.slice(0, start) + 'export { loadUserStyle } from ' + JSON.stringify(resolve(root, 'src/browser/user-styles.ts')) + ';\n\n' + code.slice(end);
      }
      if (id.endsWith('/contexts/AppSettingsContext.tsx')) return adapt(code, id, [
        ["cm?.invokeService('setLabelDefaults', { [key]: value } as SetLabelDefaultsArgs)", "cm?.invokeService('setLabelDefaults', { [key]: value } as SetLabelDefaultsArgs).then(() => cm.saveUserStyle('/settings/user_styles.xml'))"],
        ["cm?.invokeService('setViewInputParams', { [key]: value } as SetViewInputParamsArgs)", "cm?.invokeService('setViewInputParams', { [key]: value } as SetViewInputParamsArgs).then(() => cm.saveUserStyle('/settings/user_styles.xml'))"],
      ]);
      if (id.endsWith('/plugins/console/manifest.ts')) {
        const start = code.indexOf("    statusBar:");
        const end = code.indexOf("    bottomTabs:", start);
        if (start < 0 || end < 0) throw new Error('Upstream console manifest changed.');
        return code.slice(0, start) + code.slice(end);
      }
      if (id.endsWith('/plugins/mdtools/manifest.ts')) return adapt(code, id, [['defaultEnabled: false', 'defaultEnabled: true']]);
      if (id.endsWith('/dialogs/QscWriterOptionDialog.tsx')) return adapt(code, id, [
        ['useState(false)', 'useState(true)'], ['setEmbedAll(false)', 'setEmbedAll(true)'],
        ['label="Embed possible"', 'label="Include structure data in this scene file"'],
      ]);
      if (id.endsWith('/services/scene/saveScene.ts')) return adapt(code, id, [
        ['const o = args.options;', 'const o = { embedAll: true, ...args.options };'],
      ]);
      return null;
    },
  };
}
const aliases = [
  { find: /^@cuemol\/core$/, replacement: resolve(root, 'src/browser/core.ts') },
  { find: '@cuemol/core/src/wrappers', replacement: resolve(root, 'build/core/ts/wrappers') },
  { find: '@cuemol/core/src/logger', replacement: resolve(root, 'src/shims/logger.ts') },
  { find: '@cuemol/core/src', replacement: resolve(upstream, 'core/src') },
  { find: '@/logger', replacement: resolve(root, 'src/shims/logger.ts') },
  { find: '@/wrappers', replacement: resolve(root, 'build/core/ts/wrappers') },
  { find: '@/', replacement: resolve(upstream, 'core/src') + '/' },
  { find: '@renderer', replacement: renderer },
  { find: '@shared', replacement: resolve(upstream, 'react-gui/src/shared') },
  { find: '@plugins', replacement: resolve(upstream, 'react-gui/src/plugins') },
  { find: /^(node:)?fs$/, replacement: resolve(root, 'src/shims/fs.ts') },
  { find: /^(node:)?os$/, replacement: resolve(root, 'src/shims/os.ts') },
  { find: /^(node:)?path$/, replacement: resolve(root, 'node_modules/path-browserify/index.js') },
];
export default defineConfig({
  base: process.env.BASE_PATH || '/cuemol-wasm/',
  plugins: [browserAdapter(), react()],
  resolve: { alias: aliases, dedupe: ['react', 'react-dom'] },
  define: { __DEV_UI__: 'false', 'process.env.NODE_ENV': '"production"' },
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 1800, rollupOptions: { input: { index: resolve(root, 'index.html'), render: resolve(root, 'render.html') } } },
  worker: { format: 'es', plugins: () => [browserAdapter()] },
  server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  preview: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
});
