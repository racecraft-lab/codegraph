#!/usr/bin/env bash
# Vendor the speckit-pro Python runner into <repo>/speckit-pro/speckit_pro_runner/.
#
# Why: the runner's repo-root locator anchors on a REAL
# <repo>/speckit-pro/speckit_pro_runner/ directory (symlinks fail — the trust
# boundary fully resolves paths). The Claude plugin-cache install doesn't
# satisfy it (installed-cache cutover is upstream speckit-pro XPLAT-007/008
# scope), so repo-anchored runner helpers (generate-spec-index-check,
# o5-topology, gate validators) fail with missing_prerequisite until a real
# copy exists here.
#
# Re-run after every speckit-pro plugin upgrade. The vendored tree is
# gitignored (see the SpecKit section of .gitignore).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_ROOT="${SPECKIT_PRO_PLUGIN_CACHE:-$HOME/.claude/plugins/cache/racecraft-public-plugins/speckit-pro}"

[ -d "$CACHE_ROOT" ] || { echo "error: plugin cache not found: $CACHE_ROOT" >&2; exit 1; }

VERSION="$(ls -1 "$CACHE_ROOT" | sort -V | tail -1)"
SRC="$CACHE_ROOT/$VERSION/speckit_pro_runner"
[ -d "$SRC" ] || { echo "error: runner package missing: $SRC" >&2; exit 1; }

DEST="$REPO_ROOT/speckit-pro/speckit_pro_runner"
mkdir -p "$DEST"
rsync -a --delete --exclude '__pycache__' "$SRC/" "$DEST/"

printf 'source: %s\nversion: %s\nsynced: %s\n' "$SRC" "$VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > "$REPO_ROOT/speckit-pro/VENDORED-FROM.txt"

echo "vendored speckit-pro runner $VERSION -> $DEST"
