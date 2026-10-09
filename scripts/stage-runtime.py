import hashlib
import json
import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parent.parent
upstream = root / ".cache/upstream"
public = root / "public"
runtime = root / ".cache/runtime-stage"
if runtime.exists():
    shutil.rmtree(runtime)
if public.exists():
    shutil.rmtree(public)
public.mkdir()
runtime.mkdir(parents=True)
shutil.copytree(upstream / "data", runtime / "data")
shutil.copy2(upstream / "data/sysconfig.xml", runtime / "sysconfig.xml")
shutil.copytree(upstream / "data/icc_profiles", runtime / "icc_profiles")
shaders = runtime / "data/shaders"
shaders.mkdir(exist_ok=True)
include_dirs = [upstream / "src/sysdep/ogl_core", upstream / "src/modules/molvis", upstream / "src/modules/xtal"]
for folder in include_dirs:
    for path in folder.glob("*.glsl"):
        if path.name.endswith("_inc.glsl"):
            continue
        command = ["clang", "-E", "-P", "-x", "c", "-Wno-invalid-pp-token"]
        for include in include_dirs:
            command.extend(["-I", str(include)])
        command.append(str(path))
        result = subprocess.run(command, capture_output=True, check=True)
        (shaders / path.name).write_bytes(result.stdout)

files = sorted(str(path.relative_to(runtime)) for path in runtime.rglob("*") if path.is_file())
runtime_hash = hashlib.sha256()
for name in files:
    runtime_hash.update(name.encode())
    runtime_hash.update((runtime / name).read_bytes())
runtime_base = "runtime/" + runtime_hash.hexdigest()[:16] + "/"
runtime_target = public / runtime_base
runtime_target.parent.mkdir()
shutil.copytree(runtime, runtime_target)
(runtime_target / "manifest.json").write_text(json.dumps({"files": files}) + "\n")

wasm_hash = hashlib.sha256((root / "build/wasm/cuemol.wasm").read_bytes()).hexdigest()
wasm_base = "wasm/" + wasm_hash[:16] + "/"
wasm = public / wasm_base
wasm.mkdir(parents=True)
for source in (root / "build/wasm").iterdir():
    if source.is_file():
        shutil.copy2(source, wasm / source.name)
shutil.copy2(root / "node_modules/coi-serviceworker/coi-serviceworker.js", public / "coi-serviceworker.js")
sha = subprocess.check_output(["git", "-C", str(upstream), "rev-parse", "HEAD"], text=True).strip()
integration = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
version = {
    "upstream": sha, "repository": "CueMol/cuemol2", "integration": integration,
    "builtAt": datetime.now(timezone.utc).isoformat(),
    "wasmSha256": wasm_hash, "wasmBase": wasm_base, "runtimeBase": runtime_base,
    "workflowRun": os.environ.get("GITHUB_RUN_ID"),
}
(public / "version.json").write_text(json.dumps(version, indent=2) + "\n")
licenses = public / "licenses"
licenses.mkdir()
license_files = {
    "CueMol.txt": upstream / "LICENSE",
    "Boost.txt": root / ".cache/deps/boost_1_84_0/LICENSE_1_0.txt",
    "CGAL.txt": root / ".cache/deps/CGAL-6.1/LICENSE",
    "CGAL-GPL.txt": root / ".cache/deps/CGAL-6.1/LICENSE.GPL",
    "CGAL-LGPL.txt": root / ".cache/deps/CGAL-6.1/LICENSE.LGPL",
    "FFTW.txt": root / ".cache/deps/fftw-3.3.10/COPYING",
    "LCMS.txt": root / ".cache/deps/Little-CMS-lcms2.17/LICENSE",
    "Adapter.txt": root / "LICENSE",
    "XZ.txt": root / ".cache/deps/xz-5.8.1/COPYING",
    "emnapi.txt": root / "node_modules/emnapi/LICENSE",
    "node-addon-api.txt": root / "node_modules/node-addon-api/LICENSE.md",
}
cached_licenses = root / "build/native-licenses"
cached_licenses.mkdir(parents=True, exist_ok=True)
for name, source in license_files.items():
    cached = cached_licenses / name
    if source.exists():
        shutil.copy2(source, cached)
    if not cached.exists():
        raise RuntimeError(f"Native license is missing: {name}")
    shutil.copy2(cached, licenses / name)
if (root / "THIRD_PARTY.md").exists():
    shutil.copy2(root / "THIRD_PARTY.md", public / "THIRD_PARTY.md")
config = json.loads((root / "upstream.json").read_text())
(public / "source.json").write_text(json.dumps({
    "upstream": f"https://github.com/CueMol/cuemol2/archive/{sha}.tar.gz",
    "adapter": f"https://github.com/th2ch-g/cuemol-wasm/archive/{integration}.tar.gz",
    "dependencies": config["archives"],
    "emsdk": {"repository": "https://github.com/emscripten-core/emsdk", "commit": config["emsdkCommit"], "version": config["emsdk"]},
}, indent=2) + "\n")
(public / ".nojekyll").touch()
print(f"Staged {len(files)} runtime files from {sha}.")
