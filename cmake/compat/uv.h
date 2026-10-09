#pragma once
#include <stdint.h>
typedef struct uv_loop_s { int unused; } uv_loop_t;
typedef struct uv_timer_s { void *data; } uv_timer_t;
typedef struct uv_handle_s { void *data; } uv_handle_t;
inline uv_loop_t *uv_default_loop() { static uv_loop_t loop{}; return &loop; }
inline int uv_timer_init(uv_loop_t *, uv_timer_t *) { return 0; }
inline int uv_timer_start(uv_timer_t *, void (*)(uv_timer_t *), uint64_t, uint64_t) { return 0; }
inline int uv_timer_stop(uv_timer_t *) { return 0; }
inline void uv_close(uv_handle_t *, void (*)(uv_handle_t *)) {}
