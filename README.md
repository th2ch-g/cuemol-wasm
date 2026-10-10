# cuemol-wasm
CueMol-wasm inspired by https://github.com/yakomaxa/PyMOL-Wasm

[Open CueMol Wasm](https://th2ch-g.github.io/cuemol-wasm/) · [Manual deployment workflow](https://github.com/th2ch-g/cuemol-wasm/actions/workflows/deploy.yml)

CueMol's C++ molecular engine compiled to WebAssembly, with its upstream Tritium React interface and WebGL2 renderer. Umbreon and Embree provide CPU ray tracing through WebAssembly SIMD and threads. Structures, selections, surfaces, density calculations, and scene serialization run in the browser. This is a browser port of CueMol, not a replacement molecular viewer.

## Using the app

- **Open File** imports a local structure or map. Choose the renderer in the file options dialog. **Get PDB** retrieves a structure directly from RCSB.
- Right-click an object or renderer in the scene tree to change its representation, selection, coloring, visibility, or properties. Drag the viewport to rotate; use the mouse wheel to zoom.
- On phones and narrow windows, use **Model**, **Tools**, **Properties**, and **Panels** to switch the workspace. Drag with one finger to rotate; pinch to zoom; drag with two fingers to move. Long-press a scene-tree row to open its menu, then tap submenu headings. Rectangle and lasso selection accept finger drags. Menus and the top toolbar scroll sideways. The rendering window separates **Preview** and **Settings** on small screens.
- **Save Object** downloads molecular coordinates. The save dialog offers the available output formats.
- **Save Scene** downloads a CueMol QSC scene. Structure data is included by default, so the downloaded file can be reopened without the original PDB. XZ and gzip compression are available.
- **Render** or **Rendering → Ray tracing (Umbreon)** opens the upstream rendering settings and result viewer. Choose **Umbreon** for GI/AO/shadows or **Umbreon (NPR)** for ink-style drawing. Set image dimensions and transparency, press **Start Render**, then **Save image** to download the PNG. Rendering shows progress and can be stopped; completed images remain in the render history for this tab.
- **Rendering → Export scene → PNG image** exports the WebGL viewport. **Rendering → Record viewport** records the view as WebM while you rotate it or play an animation or trajectory.
- Scene exports that produce companion files, such as POV-Ray's include and label images, are downloaded together as a ZIP.
- The **Trajectory** panel supports the upstream GRO topology and DCD/XTC/TRR workflow. Use **File → Open MD Trajectory** to select the files.
- The **Console**, **Sequence**, **Animation**, camera, selection, property, and coloring tools reuse the upstream interface.

Uploaded files and user styles stay in this browser's local storage. Opening a local file does not upload it to a server. Browser storage is not a backup: download QSC files for work you want to keep. Get PDB makes an explicit request to the selected public data provider.

The first visit reloads once to enable WebAssembly threads on GitHub Pages. A current browser with WebGL2, OffscreenCanvas, SharedArrayBuffer, WebAssembly SIMD, and service workers is required. The verification suite runs in Chromium, Firefox, and WebKit.

## Browser scope

The port retains the upstream molecular, surface, crystallographic, density, animation, and trajectory modules, including FFTW, XZ compression, and Little CMS. The CueMol source patches enable graphics peer binding under Emscripten, make OIDN optional, report allocation failures, and repair atom deletion Undo/Redo. Browser integration and compatibility adaptations live in this repository.

Native external programs cannot run inside this page. POV-Ray/APBS/FFmpeg execution, Python embedding, desktop window management, and the local MCP server/OS keychain integrations are unavailable. Umbreon still images, WebGL PNG export, and viewport recording run in the browser. POV-Ray scene export remains available for desktop rendering. The browser plugin registry omits the native agent and MCP integrations.

Umbreon uses four rendering threads and the built-in A-trous denoiser. Intel OIDN is not included; saved OIDN settings are shown as A-trous in the browser rendering editor. The rendering window offers still images; the separate WebM command records viewport animations. CueMol source follows the selected release, while Umbreon, Embree, and oneTBB are pinned with archive checksums in `upstream.json`.

This uses CueMol's current Tritium interface, which differs from the legacy XUL interface. Features already marked experimental upstream, including the console and trajectory UI, retain that status. Large maps, structures, and trajectories are constrained by browser memory and the 4 GiB WebAssembly memory limit.

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

The default local build resolves GitHub Releases **Latest** at the start of the build, then checks out that exact release tag. It excludes drafts and prereleases and fails if release resolution fails. To reproduce an earlier deployment, use its tag or commit from `version.json`:

```sh
uv run --no-project --python 3.12 python scripts/bootstrap.py --upstream-ref 'RELEASE_TAG_OR_COMMIT'
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

The tests serve the production build without COOP/COEP server headers, exercising the same service-worker isolation used on GitHub Pages. They check actual native parsing and rendering, PNG pixel data, camera interaction, context menus, selections, undo/redo, compressed QSC download and reload, browser persistence, molecule copy/paste, atom picking and distance labels, RCSB downloads, CCP4 maps, DCD frames, and video downloads. Ray-tracing checks cover real GI and NPR pixel output, transparent PNG downloads, render history, cancellation, and successful rendering after cancellation. They include 8GNG ribbon rendering at the default 1200 × 1200 size with 3× supersampling, and consecutive GI/NPR/GI renders. Forced allocation-failure and recovery checks run in Chromium and Firefox; that fault-injection test is skipped in WebKit because the injected worker memory-growth failure is not reliable there. Additional checks exercise atom editing, LSQ/SSM superposition, merging, surface cutting, morph/animation playback, coordinate and geometry exports, console commands, sequence-panel selection, and style-file round trips.

Mobile checks use touch-enabled phone viewports in Chromium, Firefox, and WebKit, including portrait/landscape and desktop-size transitions, long-press menus, panel switching, and coordinate downloads. Chromium also receives multi-touch input through its browser input protocol to verify rotation, translation, pinch zoom, gesture cancellation, rectangle selection, and lasso selection. These checks emulate mobile screens and input; physical Android and iOS devices have not been tested.

To test a deployed build, set `BASE_URL` to its application URL. Reports, exported images, and failure traces are written locally. Browser tests run outside GitHub Actions to conserve Actions minutes.

## Update and deploy

There are no scheduled or push-triggered deployments.

1. Open **Actions → Build and deploy CueMol Wasm → Run workflow**.
2. Keep `upstream_ref` as `latest` to use GitHub Releases **Latest**, or enter a specific tag or commit. The workflow resolves the release once and builds the source at that tag, rather than the release's target branch.
3. The workflow builds the native engine and UI and deploys the artifact to GitHub Pages. It does not install test browsers or run tests.
4. Run `node scripts/check-deployment.mjs` and `npm run test:e2e` locally with `BASE_URL` set to the published application URL. Set `EXPECTED_COMMIT` and `EXPECTED_UPSTREAM` to the expected commits; optionally set `EXPECTED_RELEASE` to check the release tag too.

The workflow caches the compiled Wasm engine and generated TypeScript wrappers by CueMol commit, build configuration, compiler/dependency versions, and native patches. An exact match skips Emscripten setup and C++ compilation; build metadata and runtime data are still regenerated for the current adapter commit. Upstream changes reuse the SDK, downloaded sources, compiled dependency libraries, and ccache. npm downloads are cached by the lockfile. Cache expiration falls back to a complete build.

A failed build leaves the current site in place. The workflow fails if the upstream patch no longer applies. Review compatibility changes before retrying an upstream update.

[version.json](https://th2ch-g.github.io/cuemol-wasm/version.json) identifies the resolved release tag, release URL, deployed commits, and native binary. [source.json](https://th2ch-g.github.io/cuemol-wasm/source.json) provides the exact source archives and dependency checksums. Native binaries and runtime data use content-addressed URLs to avoid mixing old and new files across updates.

See [THIRD_PARTY.md](THIRD_PARTY.md) for source and license information.
