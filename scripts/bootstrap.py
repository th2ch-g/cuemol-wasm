import argparse
import hashlib
import json
import os
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

root = Path(__file__).resolve().parent.parent
config = json.loads((root / "upstream.json").read_text())
parser = argparse.ArgumentParser()
parser.add_argument("--upstream-ref", default=config["ref"], help="latest release (default), Git tag, commit, or branch")
mode = parser.add_mutually_exclusive_group()
mode.add_argument("--source-only", action="store_true")
mode.add_argument("--dependencies-only", action="store_true")
args = parser.parse_args()
if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_./-]*", args.upstream_ref):
    parser.error("Use latest, a Git commit, tag, or branch name.")

def run(*command, cwd=root):
    subprocess.run(command, cwd=cwd, check=True)

cache = root / ".cache"
(cache / "downloads").mkdir(parents=True, exist_ok=True)
(cache / "deps").mkdir(exist_ok=True)
if not args.dependencies_only:
    resolved_ref = args.upstream_ref
    fetch_ref = resolved_ref
    release = None
    if resolved_ref == "latest":
        repository = urlparse(config["repository"])
        repository_path = repository.path.strip("/").removesuffix(".git")
        if repository.hostname != "github.com" or len(repository_path.split("/")) != 2:
            raise SystemExit("Latest release resolution requires a GitHub repository URL.")
        headers = {"Accept": "application/vnd.github+json", "User-Agent": "cuemol-wasm-build"}
        token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = Request(f"https://api.github.com/repos/{repository_path}/releases/latest", headers=headers)
        try:
            with urlopen(request, timeout=30) as response:
                latest = json.load(response)
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
            raise SystemExit(f"Could not resolve the latest CueMol release: {error}") from None
        resolved_ref = latest.get("tag_name")
        if latest.get("draft") or latest.get("prerelease") or not isinstance(resolved_ref, str) or not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_./-]*", resolved_ref):
            raise SystemExit("GitHub did not return a published stable release with a valid tag.")
        fetch_ref = f"refs/tags/{resolved_ref}"
        release = {"tag": resolved_ref, "url": latest["html_url"], "publishedAt": latest["published_at"]}
    upstream = cache / "upstream"
    patch = root / "patches/browser-napi.patch"
    if not (upstream / ".git").exists():
        run("git", "clone", "--no-checkout", "--filter=blob:none", config["repository"], str(upstream))
    else:
        diff = subprocess.check_output(["git", "diff", "--name-only"], cwd=upstream, text=True).strip()
        if diff:
            run("git", "apply", "--reverse", "--check", str(patch), cwd=upstream)
            run("git", "apply", "--reverse", str(patch), cwd=upstream)
    run("git", "fetch", "--depth=1", "origin", fetch_ref, cwd=upstream)
    run("git", "checkout", "--detach", "FETCH_HEAD", cwd=upstream)
    run("git", "apply", "--check", str(patch), cwd=upstream)
    run("git", "apply", str(patch), cwd=upstream)
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=upstream, text=True).strip()
    selection = {"requestedRef": args.upstream_ref, "resolvedRef": resolved_ref, "commit": commit, "release": release}
    (cache / "upstream-source.json").write_text(json.dumps(selection, indent=2) + "\n")
    print(f"CueMol source: {args.upstream_ref} -> {resolved_ref} ({commit})", flush=True)

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
