#!/usr/bin/env bash
if [ -z "${BUILD_JOBS:-}" ]; then
  task_cpu_count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || printf 2)"
  task_memory_jobs="$task_cpu_count"
  if [ -r /proc/meminfo ]; then
    task_memory_kb="$(awk '/MemAvailable:/ { print $2 }' /proc/meminfo)"
    task_memory_jobs=$((task_memory_kb / 2097152))
  elif command -v sysctl >/dev/null; then
    task_memory_bytes="$(sysctl -n hw.memsize 2>/dev/null || printf 0)"
    if [ "$task_memory_bytes" -gt 0 ]; then
      task_memory_jobs=$((task_memory_bytes * 3 / 4 / 2147483648))
    fi
  fi
  if [ "$task_memory_jobs" -lt 1 ]; then task_memory_jobs=1; fi
  BUILD_JOBS="$task_cpu_count"
  if [ "$task_memory_jobs" -lt "$BUILD_JOBS" ]; then BUILD_JOBS="$task_memory_jobs"; fi
  export BUILD_JOBS
fi
if ! [[ "$BUILD_JOBS" =~ ^[1-9][0-9]*$ ]]; then
  printf 'BUILD_JOBS must be a positive integer.\n' >&2
  return 1
fi
printf 'Parallel native compilation: %s jobs\n' "$BUILD_JOBS"
if command -v ccache >/dev/null; then
  export EM_COMPILER_WRAPPER="$(command -v ccache)"
  export CCACHE_DIR="${CCACHE_DIR:-$PWD/.cache/ccache}"
  export CCACHE_BASEDIR="$PWD"
  export CCACHE_COMPILERCHECK=content
  export CCACHE_NOHASHDIR=true
  ccache --max-size="${CCACHE_MAXSIZE:-512M}" >/dev/null
fi
