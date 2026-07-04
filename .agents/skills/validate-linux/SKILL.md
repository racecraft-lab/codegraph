---
name: validate-linux
description: "Validate codegraph on Linux via Docker on the macOS host. Use when the user asks to test, validate, or reproduce behavior on Linux — especially platform-sensitive work: file watching, inotify budget, sockets, path/symlink handling, process lifecycle, daemon reaping. Optionally takes a test file/pattern to run, or 'watcher' for inotify-focused checks."
---

<!-- Codex mirror of .claude/skills/validate-linux/SKILL.md — keep the two in sync. -->

# Validate on Linux (Docker)

There is no Linux box — Docker on the macOS host is the Linux target. Build a
throwaway image from the working tree and run the suite inside it. Never reuse
the Mac `node_modules` (esbuild/rollup ship platform-specific binaries).

## Prerequisites

Check Docker is up before anything else:

```bash
docker info >/dev/null 2>&1 || echo "Docker not running — start Docker Desktop first"
```

## Steps

**1. Temporary build context files.** The repo has no checked-in `.dockerignore`
or Dockerfile. Create both as temporaries at the repo root; track what you
created so cleanup removes only your files (if a `.dockerignore` already exists,
leave it alone and skip creating it):

```bash
cat > .dockerignore <<'EOF'
node_modules
dist
.git
.codegraph
EOF

cat > Dockerfile.linux-validate <<'EOF'
FROM node:22-bookworm
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
EOF
```

**2. Build.**

```bash
docker build -f Dockerfile.linux-validate -t codegraph-linux-validate .
```

**3. Run the tests — `--init` is load-bearing.** Without a zombie-reaping PID 1,
a SIGKILL'd or exited process lingers as a zombie and `process.kill(pid, 0)`
still reports it *alive*, so any process-lifecycle assertion (daemon reaping,
PPID watchdog, idle-timeout) false-fails even though the process did exit.
Always pass `--rm --init`:

```bash
docker run --rm --init codegraph-linux-validate npm test
```

Single file or pattern (use the argument if the user gave one):

```bash
docker run --rm --init codegraph-linux-validate npx vitest run __tests__/<file>.test.ts
```

**4. Watcher / inotify work only.** Linux is where the inotify watch budget
actually bites. Count a process's watches from inside the container: find the fd
whose `readlink` is `anon_inode:inotify`, then sum its `^inotify ` lines:

```bash
docker run --rm --init codegraph-linux-validate bash -c '
  npm test -- __tests__/<watcher-test> &  TESTPID=$!
  sleep 2
  for pid in $(pgrep node); do
    for fd in /proc/$pid/fd/*; do
      [ "$(readlink "$fd")" = "anon_inode:inotify" ] &&
        echo "pid $pid: $(grep -c ^inotify /proc/$pid/fdinfo/${fd##*/}) watches"
    done
  done
  wait $TESTPID'
```

**5. Triage failures.** Before blaming the current change, confirm a failing
test also fails on `origin/main` in the same container (`git stash` the change
or rebuild from a clean checkout) — pre-existing platform failures must not be
pinned on the branch. Report failures with the actual vitest output, never a
summary alone.

**6. Cleanup.** Remove only what this run created:

```bash
rm -f Dockerfile.linux-validate .dockerignore   # .dockerignore only if step 1 created it
docker rmi codegraph-linux-validate >/dev/null 2>&1 || true
```

## Notes

- On Apple Silicon the image builds/runs as native `linux/arm64` — right for
  kernel-level behavior (inotify, sockets, process lifecycle). Add
  `--platform linux/amd64` to build+run only when an x64-specific issue is
  suspected (slower, emulated).
- Rebuilds are cheap after the first run: the `npm ci` layer caches until
  `package-lock.json` changes.
