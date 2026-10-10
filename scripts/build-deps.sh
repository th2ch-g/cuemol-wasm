#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source .cache/emsdk/emsdk_env.sh >/dev/null 2>&1
source scripts/build-env.sh
jobs="${BUILD_JOBS:-4}"
emcmake cmake -S .cache/deps/fftw-3.3.10 -B .cache/build-fftw -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PWD/.cache/fftw" \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DENABLE_FLOAT=ON -DENABLE_THREADS=OFF \
  -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTS=OFF -DCMAKE_C_FLAGS="-O2 -pthread"
cmake --build .cache/build-fftw --parallel "$jobs"
cmake --install .cache/build-fftw
emcmake cmake -S .cache/deps/xz-5.8.1 -B .cache/build-xz -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PWD/.cache/xz" \
  -DBUILD_SHARED_LIBS=OFF -DXZ_TOOL_XZ=OFF -DXZ_TOOL_XZDEC=OFF \
  -DXZ_TOOL_LZMADEC=OFF -DXZ_TOOL_LZMAINFO=OFF -DXZ_DOC=OFF -DXZ_NLS=OFF \
  -DBUILD_TESTING=OFF -DCMAKE_C_FLAGS="-O2 -pthread"
cmake --build .cache/build-xz --target liblzma --parallel "$jobs"
cmake --install .cache/build-xz
emcmake cmake -S cmake/lcms -B .cache/build-lcms -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PWD/.cache/lcms" \
  -DCMAKE_C_FLAGS="-O2 -pthread"
cmake --build .cache/build-lcms --parallel "$jobs"
cmake --install .cache/build-lcms

emcmake cmake -S .cache/deps/oneTBB-2023.0.0 -B .cache/build-tbb-wasm -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PWD/.cache/tbb" \
  -DBUILD_SHARED_LIBS=OFF -DTBB_TEST=OFF -DTBB_EXAMPLES=OFF \
  -DTBBMALLOC_BUILD=OFF -DTBBMALLOC_PROXY_BUILD=OFF -DTBB_STRICT=OFF \
  -DCMAKE_CXX_FLAGS="-O2 -pthread -fexceptions"
cmake --build .cache/build-tbb-wasm --parallel "$jobs"
cmake --install .cache/build-tbb-wasm
emcmake cmake -S .cache/deps/embree-4.4.1 -B .cache/build-embree-wasm -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PWD/.cache/embree" \
  -DTBB_DIR="$PWD/.cache/tbb/lib/cmake/TBB" \
  -DEMBREE_STATIC_LIB=ON -DEMBREE_TUTORIALS=OFF -DEMBREE_ISPC_SUPPORT=OFF \
  -DEMBREE_SYCL_SUPPORT=OFF -DEMBREE_MAX_ISA=SSE2 -DEMBREE_TASKING_SYSTEM=TBB \
  -DEMBREE_TESTING_INTENSITY=0 -DFLAGS_SSE2="-msse -msse2" \
  -DCMAKE_CXX_FLAGS="-O2 -pthread -msimd128 -fexceptions"
cmake --build .cache/build-embree-wasm --parallel "$jobs"
cmake --install .cache/build-embree-wasm
umbreon_source="$(uv run --no-project --python 3.12 python -c 'import json; print(".cache/deps/umbreon-" + json.load(open("upstream.json"))["umbreon"])')"
emcmake cmake -S "$umbreon_source" -B .cache/build-umbreon-wasm -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PWD/.cache/umbreon-install" \
  -DTBB_DIR="$PWD/.cache/tbb/lib/cmake/TBB" \
  -Dembree_DIR="$PWD/.cache/embree/lib/cmake/embree-4.4.1" \
  -DUMBREON_WITH_OIDN=OFF -DCMAKE_CXX_FLAGS="-O2 -pthread -msimd128 -fexceptions"
cmake --build .cache/build-umbreon-wasm --target umbreon --parallel "$jobs"
cmake --install .cache/build-umbreon-wasm
