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
