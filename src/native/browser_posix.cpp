#include <cerrno>
#include <spawn.h>

extern "C" int posix_spawnp(pid_t *, const char *,
                            const posix_spawn_file_actions_t *,
                            const posix_spawnattr_t *, char *const[], char *const[])
{
    return ENOSYS;
}
