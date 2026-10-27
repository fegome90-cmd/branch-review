#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: scripts/install-reviewctl.sh [--target <repo-path>] [--force]

Copies the portable reviewctl wrappers into a target repository.

Options:
  --target <repo-path>  Target repository root (default: current directory)
  --force               Overwrite existing wrapper files
  -h, --help            Show this help
EOF
}

log() {
    printf '[install-reviewctl] %s\n' "$1"
}

fail() {
    printf '[install-reviewctl:error] %s\n' "$1" >&2
    exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
SOURCE_REPO_ROOT="$(cd "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)"
TARGET_REPO_ROOT="$(pwd)"
FORCE=0

while (($# > 0)); do
    case "$1" in
        --target)
            shift
            (($# > 0)) || fail "Missing value for --target"
            TARGET_REPO_ROOT="$1"
            ;;
        --force)
            FORCE=1
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            fail "Unknown argument: $1"
            ;;
    esac
    shift
done

[[ -d "$TARGET_REPO_ROOT" ]] || fail "Target repository path does not exist: $TARGET_REPO_ROOT"
[[ -d "$SOURCE_REPO_ROOT/scripts/reviewctl-wrappers" ]] || fail "Wrapper source directory not found: $SOURCE_REPO_ROOT/scripts/reviewctl-wrappers"

INSTALL_DIR="$TARGET_REPO_ROOT/scripts/reviewctl-wrappers"
mkdir -p "$INSTALL_DIR"

for wrapper_name in reviewctl-wrapper.sh reviewctl-wrapper.fish; do
    source_file="$SOURCE_REPO_ROOT/scripts/reviewctl-wrappers/$wrapper_name"
    target_file="$INSTALL_DIR/$wrapper_name"

    [[ -f "$source_file" ]] || fail "Missing wrapper source file: $source_file"

    if [[ -e "$target_file" && "$FORCE" -ne 1 ]]; then
        fail "Target file already exists: $target_file (use --force to overwrite)"
    fi

    cp "$source_file" "$target_file"
    chmod +x "$target_file"
done

log "Installed wrappers into $INSTALL_DIR"
log "Next steps:"
log "  1. export REVIEWCTL_CORE_CLI_PATH=\"$SOURCE_REPO_ROOT/mini-services/reviewctl/src/index.ts\""
log "  2. export REVIEW_API_TOKEN=\"<token>\"   # optional; local mode works without it"
log "  3. source scripts/reviewctl-wrappers/reviewctl-wrapper.sh"
log "  4. run: reviewctl_status"
