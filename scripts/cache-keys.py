import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
config = json.loads((root / "upstream.json").read_text())
for name, value in {
    "toolchain": {key: config[key] for key in ["emsdk", "emsdkCommit"]},
    "sources": config["archives"],
}.items():
    digest = hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()[:24]
    print(f"{name}={digest}")
