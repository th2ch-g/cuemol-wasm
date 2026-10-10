#include <tbb/global_control.h>

extern "C" void cuemol_browser_init_rendering()
{
    // Initialize after the statically linked TBB runtime constructors.
    // One render thread and three TBB workers fit the preloaded pthread pool.
    static tbb::global_control threads(tbb::global_control::max_allowed_parallelism, 4);
    static tbb::global_control stack(tbb::global_control::thread_stack_size, 2 * 1024 * 1024);
}
