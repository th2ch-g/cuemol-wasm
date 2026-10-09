import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
config = json.loads((root / "upstream.json").read_text())
lock = json.loads((root / "package-lock.json").read_text())
bindings = {name: lock["packages"].get("node_modules/" + name) for name in [
    "emnapi", "node-addon-api", "@emnapi/runtime", "@emnapi/wasi-threads",
]}
for name, value in {
    "toolchain": {key: config[key] for key in ["emsdk", "emsdkCommit"]},
    "sources": config["archives"],
    "bindings": bindings,
}.items():
    digest = hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()[:24]
    print(f"{name}={digest}")
