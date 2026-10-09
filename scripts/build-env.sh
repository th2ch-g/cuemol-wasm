#!/usr/bin/env bash
if command -v ccache >/dev/null; then
  export EM_COMPILER_WRAPPER="$(command -v ccache)"
  export CCACHE_DIR="${CCACHE_DIR:-$PWD/.cache/ccache}"
  export CCACHE_BASEDIR="$PWD"
  export CCACHE_COMPILERCHECK=content
  export CCACHE_NOHASHDIR=true
  ccache --max-size="${CCACHE_MAXSIZE:-512M}" >/dev/null
fi
