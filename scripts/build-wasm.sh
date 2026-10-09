#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root_dir="$PWD"
source .cache/emsdk/emsdk_env.sh >/dev/null 2>&1
if command -v brew >/dev/null; then
  export PATH="$(brew --prefix bison)/bin:$(brew --prefix flex)/bin:$PATH"
fi
python_exe="$(uv run --no-project --python 3.12 python -c 'import sys; print(sys.executable)')"
emcmake cmake -S .cache/upstream -B build/core -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PROJECT_CueMol_INCLUDE="$root_dir/cmake/project.cmake" \
  -DCMAKE_INSTALL_PREFIX="$root_dir/build/install" \
  -DPython3_EXECUTABLE="$python_exe" \
  -DCMAKE_CXX_FLAGS_RELEASE="-O2 -DNDEBUG" \
  -DCMAKE_C_FLAGS_RELEASE="-O2 -DNDEBUG"
cmake --build build/core --target cuemol_wasm --parallel "${BUILD_JOBS:-4}"
uv run --no-project --python 3.12 python scripts/stage-runtime.py
