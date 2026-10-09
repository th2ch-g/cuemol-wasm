# cuemol-wasm
CueMol-wasm inspired by https://github.com/yakomaxa/PyMOL-Wasm

[Open CueMol Wasm](https://th2ch-g.github.io/cuemol-wasm/) · [Manual deployment workflow](https://github.com/th2ch-g/cuemol-wasm/actions/workflows/deploy.yml)

CueMol's C++ molecular engine compiled to WebAssembly, with its upstream Tritium React interface and WebGL2 renderer. Structures, selections, surfaces, density calculations, and scene serialization run in the browser. This is a browser port of CueMol, not a replacement molecular viewer.

## Using the app

- **Open File** imports a local structure or map. Choose the renderer in the file options dialog. **Get PDB** retrieves a structure directly from RCSB.
- Right-click an object or renderer in the scene tree to change its representation, selection, coloring, visibility, or properties. Drag the viewport to rotate; use the mouse wheel to zoom.
- **Save Object** downloads molecular coordinates. The save dialog offers the available output formats.
- **Save Scene** downloads a CueMol QSC scene. Structure data is included by default, so the downloaded file can be reopened without the original PDB. XZ and gzip compression are available.
- **Export PNG** renders an image with selectable dimensions and transparency. **Rendering → Record viewport** records the view as WebM while you rotate it or play an animation or trajectory.
- Scene exports that produce companion files, such as POV-Ray's include and label images, are downloaded together as a ZIP.
- The **Trajectory** panel supports the upstream GRO topology and DCD/XTC/TRR workflow. Use **File → Open MD Trajectory** to select the files.
- The **Console**, **Sequence**, **Animation**, camera, selection, property, and coloring tools reuse the upstream interface.

Uploaded files and user styles stay in this browser's local storage. Opening a local file does not upload it to a server. Browser storage is not a backup: download QSC files for work you want to keep. Get PDB makes an explicit request to the selected public data provider.

The first visit reloads once to enable WebAssembly threads on GitHub Pages. A current browser with WebGL2, OffscreenCanvas, SharedArrayBuffer, and service workers is required. The verification suite runs in Chromium, Firefox, and WebKit.

## Browser scope

The port retains the upstream molecular, surface, crystallographic, density, animation, and trajectory modules, including FFTW, XZ compression, and Little CMS. The only patch to CueMol's source enables its existing graphics peer binding under Emscripten in two conditional guards. Browser integration and compatibility adaptations live in this repository.

Native external programs cannot run inside this page. POV-Ray/APBS/FFmpeg execution, Embree-based Umbreon rendering, Python embedding, desktop window management, and the local MCP server/OS keychain integrations are unavailable. PNG rendering and viewport recording use the browser, and POV-Ray scene export remains available for desktop rendering. The browser plugin registry omits the native agent and MCP integrations.

This uses CueMol's current Tritium interface, which differs from the legacy XUL interface. Features already marked experimental upstream, including the console and trajectory UI, retain that status. Large maps, structures, and trajectories are constrained by browser memory and the 2 GiB WebAssembly memory limit.

## Build locally

Requirements: Git, Node.js 24+, npm, uv, CMake, Ninja, Bison, Flex, and Clang. Install ccache to reuse C/C++ compilation results across local builds. The scripts support Linux and macOS and obtain the pinned Emscripten SDK and native dependency sources.

```sh
npm ci
uv run --no-project --python 3.12 python scripts/bootstrap.py
bash scripts/build-deps.sh
bash scripts/build-wasm.sh
npm run build
npm run preview
```

The default local build uses the tested CueMol commit in `upstream.json`. To select another revision:

```sh
uv run --no-project --python 3.12 python scripts/bootstrap.py --upstream-ref develop
bash scripts/build-deps.sh
bash scripts/build-wasm.sh
npm run build
```

SDK and dependency downloads run concurrently. Native compilation uses the available CPU count with a memory limit of approximately 2 GiB per compiler process; set `BUILD_JOBS` to override it. The three browser engines run concurrently; set `PLAYWRIGHT_WORKERS=1` on a memory-constrained machine.

Generated source checkouts, compiler downloads, binaries, runtime assets, and test output are ignored by Git. Do not edit `public/`, `build/`, or `.cache/` as project source. The deployment base path can be set with `BASE_PATH`; its default is `/cuemol-wasm/`.

## Verify

```sh
npx playwright install chromium firefox webkit
npm run test:e2e
```

The tests serve the production build without COOP/COEP server headers, exercising the same service-worker isolation used on GitHub Pages. They check actual native parsing and rendering, PNG pixel data, camera interaction, context menus, selections, undo/redo, compressed QSC download and reload, browser persistence, molecule copy/paste, atom picking and distance labels, RCSB downloads, CCP4 maps, DCD frames, and video downloads.

To test a deployed build, set `BASE_URL` to its application URL. Playwright reports, exported images, and failure traces are retained as workflow artifacts.

## Update and deploy

There are no scheduled or push-triggered deployments.

1. Open **Actions → Build and deploy CueMol Wasm → Run workflow**.
2. Enter a CueMol branch, tag, or commit. The default `develop` resolves the latest upstream commit at the start of that run.
3. The workflow builds the native engine and UI, tests them in three browser engines, and deploys the tested artifact to GitHub Pages.
4. A separate job checks the published adapter commit, CueMol commit, and Wasm SHA-256, then runs the browser suite against the public URL.

The workflow caches the compiled Wasm engine and generated TypeScript wrappers by CueMol commit, build configuration, compiler/dependency versions, and native patches. An exact match skips Emscripten setup and C++ compilation; build metadata and runtime data are still regenerated for the current adapter commit. Upstream changes reuse the SDK, downloaded sources, compiled dependency libraries, and ccache. npm downloads are cached by the lockfile. Browser tests and public-site verification always run, including on a cache hit. Cache expiration falls back to a complete build.

A failed build or predeployment test leaves the current site in place. The workflow fails if the upstream patch no longer applies. Review compatibility changes before retrying an upstream update.

[version.json](https://th2ch-g.github.io/cuemol-wasm/version.json) identifies the deployed commits and native binary. [source.json](https://th2ch-g.github.io/cuemol-wasm/source.json) provides the exact source archives and dependency checksums. Native binaries and runtime data use content-addressed URLs to avoid mixing old and new files across updates.

See [THIRD_PARTY.md](THIRD_PARTY.md) for source and license information.
