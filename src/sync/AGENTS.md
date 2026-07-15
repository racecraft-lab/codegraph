# Sync - Local Rules

Full detail: root `AGENTS.md` and test platform guidance.

- Watcher behavior is platform-sensitive: FSEvents, inotify, and Windows
  directory notifications differ.
- Preserve debounce, filtering, git-hook, and daemon lifecycle semantics.
- Validate path, symlink, socket or pipe, and process-lifecycle changes on the
  affected real platform.
- Linux watcher budget issues must be checked through `/proc/<pid>/fdinfo/*`;
  do not infer them from macOS.
