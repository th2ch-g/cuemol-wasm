import argparse
import hashlib
import json
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

root = Path(__file__).resolve().parent.parent
config = json.loads((root / "upstream.json").read_text())
parser = argparse.ArgumentParser()
parser.add_argument("--upstream-ref", default=config["ref"])
mode = parser.add_mutually_exclusive_group()
mode.add_argument("--source-only", action="store_true")
mode.add_argument("--dependencies-only", action="store_true")
args = parser.parse_args()
if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_./-]*", args.upstream_ref):
    parser.error("Use a Git commit, tag, or branch name.")

def run(*command, cwd=root):
    subprocess.run(command, cwd=cwd, check=True)

cache = root / ".cache"
(cache / "downloads").mkdir(parents=True, exist_ok=True)
(cache / "deps").mkdir(exist_ok=True)
if not args.dependencies_only:
    upstream = cache / "upstream"
    patch = root / "patches/browser-napi.patch"
    if not (upstream / ".git").exists():
        run("git", "clone", "--no-checkout", "--filter=blob:none", config["repository"], str(upstream))
    else:
        diff = subprocess.check_output(["git", "diff", "--name-only"], cwd=upstream, text=True).strip()
        if diff:
            run("git", "apply", "--reverse", "--check", str(patch), cwd=upstream)
            run("git", "apply", "--reverse", str(patch), cwd=upstream)
    run("git", "fetch", "--depth=1", "origin", args.upstream_ref, cwd=upstream)
    run("git", "checkout", "--detach", "FETCH_HEAD", cwd=upstream)
    run("git", "apply", "--check", str(patch), cwd=upstream)
    run("git", "apply", str(patch), cwd=upstream)

if args.source_only:
    raise SystemExit(0)

def prepare_toolchain():
    emsdk = cache / "emsdk"
    if not (emsdk / ".git").exists():
        run("git", "clone", "--no-checkout", "https://github.com/emscripten-core/emsdk.git", str(emsdk))
    run("git", "fetch", "--depth=1", "origin", config["emsdkCommit"], cwd=emsdk)
    run("git", "checkout", "--detach", "FETCH_HEAD", cwd=emsdk)
    run("uv", "run", "--no-project", "--python", "3.12", "python", str(emsdk / "emsdk.py"), "install", config["emsdk"])
    run("uv", "run", "--no-project", "--python", "3.12", "python", str(emsdk / "emsdk.py"), "activate", config["emsdk"])

def prepare_archive(entry):
    archive = cache / "downloads" / entry["file"]
    if not archive.exists():
        run("curl", "--fail", "--location", "--silent", "--show-error", "--retry", "3", entry["url"], "--output", str(archive))
    digest = hashlib.file_digest(archive.open("rb"), "sha256").hexdigest()
    if digest != entry["sha256"]:
        raise RuntimeError(f"Checksum mismatch: {archive.name}")
    if not (cache / "deps" / entry["directory"]).exists():
        run("tar", "-xf", str(archive), "-C", str(cache / "deps"))
with ThreadPoolExecutor(max_workers=4) as executor:
    futures = [executor.submit(prepare_toolchain)]
    futures.extend(executor.submit(prepare_archive, entry) for entry in config["archives"])
    for future in futures:
        future.result()
print("Source and dependencies are ready.")
