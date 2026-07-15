#!/usr/bin/env bash
# Portable reviewctl wrapper - API first with deterministic local fallback
: "${BRANCH_REVIEW_API:=http://localhost:3001}"

_reviewctl_wrapper_dir() {
    local source_path=""

    if [[ -n "${ZSH_VERSION:-}" ]]; then
        source_path="$(eval 'printf %s "${(%):-%x}"' 2>/dev/null)"
    elif [[ -n "${BASH_SOURCE[0]:-}" ]]; then
        source_path="${BASH_SOURCE[0]}"
    else
        source_path="$0"
    fi

    cd "$(dirname "$source_path")" >/dev/null 2>&1 && pwd
}

_reviewctl_repo_root() {
    cd "$(_reviewctl_wrapper_dir)/../.." >/dev/null 2>&1 && pwd
}

_reviewctl_source_repo_root() {
    if [[ -n "${REVIEWCTL_SOURCE_REPO_ROOT:-}" ]]; then
        printf '%s' "$REVIEWCTL_SOURCE_REPO_ROOT"
        return 0
    fi

    local cli_path
    cli_path="$(resolve_core_cli_path)" || return 1
    cd "$(dirname "$cli_path")/../../.." >/dev/null 2>&1 && pwd
}

_reviewctl_target_repo_root() {
    if git rev-parse --show-toplevel >/dev/null 2>&1; then
        git rev-parse --show-toplevel
    else
        pwd
    fi
}

_reviewctl_internal_layout() {
    [[ -f "$(_reviewctl_repo_root)/mini-services/reviewctl/src/index.ts" ]]
}

_reviewctl_safe_mode() {
    ! _reviewctl_internal_layout
}

resolve_artifact_root() {
    if [[ -n "${REVIEWCTL_ARTIFACT_ROOT:-}" ]]; then
        printf '%s' "$REVIEWCTL_ARTIFACT_ROOT"
        return 0
    fi

    if _reviewctl_safe_mode; then
        local repo_path source_repo_root
        repo_path="$(_reviewctl_target_repo_root)"
        source_repo_root="$(_reviewctl_source_repo_root)" || return 1
        bun "$source_repo_root/shared/reviewctl-artifact-root.ts" "$repo_path"
        return $?
    fi

    printf '%s' "$(_reviewctl_target_repo_root)"
}

resolve_core_cli_path() {
    if [[ -n "${REVIEWCTL_CORE_CLI_PATH:-}" ]]; then
        printf '%s' "$REVIEWCTL_CORE_CLI_PATH"
        return 0
    fi

    local internal_path
    internal_path="$(_reviewctl_repo_root)/mini-services/reviewctl/src/index.ts"
    if [[ -f "$internal_path" ]]; then
        printf '%s' "$internal_path"
        return 0
    fi

    log_error "REVIEWCTL_CORE_CLI_PATH is required outside the branch-review repository layout"
    return 1
}

log_info() { echo "[reviewctl:info] $1" >&2; }
log_warn() { echo "[reviewctl:warn] $1" >&2; }
log_error() { echo "[reviewctl:error] $1" >&2; }

json_escape() {
    local value="$1"
    value=${value//\\/\\\\}
    value=${value//\"/\\\"}
    value=${value//$'\n'/\\n}
    value=${value//$'\r'/\\r}
    value=${value//$'\t'/\\t}
    printf '%s' "$value"
}

build_args_json() {
    local cmd="$1"
    shift

    local json="{"
    local positional=()

    while (($# > 0)); do
        local arg="$1"
        shift

        if [[ "$arg" == --* ]]; then
            local key="${arg#--}"
            if (($# > 0)) && [[ "$1" != --* ]]; then
                local value="$1"
                shift
                json+="\"$(json_escape "$key")\":\"$(json_escape "$value")\","
            else
                json+="\"$(json_escape "$key")\":true,"
            fi
        else
            positional+=("$arg")
        fi
    done

    if ((${#positional[@]} > 0)); then
        if [[ "$cmd" == "explore" && ${#positional[@]} -eq 1 ]]; then
            json+="\"type\":\"$(json_escape "${positional[0]}")\","
        else
            return 2
        fi
    fi

    json="${json%,}}"
    if [[ "$json" == "}" ]]; then
        json="{}"
    fi

    printf '%s' "$json"
}

execute_local() {
    local cmd="$1"
    shift
    local cli_path
    cli_path="$(resolve_core_cli_path)" || return 1
    local repo_path artifact_root
    repo_path="$(_reviewctl_target_repo_root)"
    artifact_root="$(resolve_artifact_root)"

    if [[ ! -f "$cli_path" ]]; then
        log_error "CORE_CLI_PATH not found: $cli_path"
        return 1
    fi

    mkdir -p "$artifact_root"

    if _reviewctl_safe_mode; then
        log_warn "mode=local-direct safe_mode=1 command=$cmd repo_path=$repo_path artifact_root=$artifact_root core_cli_path=$cli_path"
        env REVIEWCTL_SAFE_MODE=1 REVIEWCTL_ARTIFACT_ROOT="$artifact_root" bun "$cli_path" "$cmd" "$@"
        return $?
    fi

    log_info "mode=local-direct command=$cmd repo_path=$repo_path core_cli_path=$cli_path"
    bun "$cli_path" "$cmd" "$@"
}

execute_cmd() {
    local cmd="$1"
    shift
    local args_raw=("$@")

    if [[ -n "${__REVIEWCTL_WRAPPER_LOOP:-}" ]]; then
        execute_local "$cmd" "${args_raw[@]}"
        return $?
    fi

    local cli_path
    cli_path="$(resolve_core_cli_path)" || return 1
    local repo_path artifact_root
    repo_path="$(_reviewctl_target_repo_root)"
    artifact_root="$(resolve_artifact_root)"
    export __REVIEWCTL_WRAPPER_LOOP=1

    local exit_code=0

    if [[ -z "${REVIEW_API_TOKEN:-}" ]]; then
        log_warn "mode=local-direct reason=missing-review-api-token command=$cmd repo_path=$repo_path artifact_root=$artifact_root core_cli_path=$cli_path"
        execute_local "$cmd" "${args_raw[@]}"
        exit_code=$?
        unset __REVIEWCTL_WRAPPER_LOOP
        return $exit_code
    fi

    local args_json
    if ! args_json="$(build_args_json "$cmd" "${args_raw[@]}")"; then
        log_warn "mode=local-direct reason=unsupported-positional-args command=$cmd"
        execute_local "$cmd" "${args_raw[@]}"
        exit_code=$?
        unset __REVIEWCTL_WRAPPER_LOOP
        return $exit_code
    fi

    log_info "mode=api command=$cmd repo_path=$repo_path artifact_root=$artifact_root core_cli_path=$cli_path"

    local response
    response=$(curl -sS -w "\n%{http_code}" --connect-timeout 2 \
        -H "X-Review-Token: $REVIEW_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"command\":\"$(json_escape "$cmd")\",\"repoPath\":\"$(json_escape "$repo_path")\",\"args\":$args_json}" \
        "$BRANCH_REVIEW_API/api/review/command" 2>/dev/null || printf '\n000')

    local http_code
    http_code=$(echo "$response" | tail -n 1)
    local body
    body=$(echo "$response" | sed '$d')

    case "$http_code" in
        200)
            echo "$body"
            exit_code=0
            ;;
        000)
            log_warn "mode=local-fallback reason=api-unreachable command=$cmd repo_path=$repo_path artifact_root=$artifact_root http_status=$http_code core_cli_path=$cli_path"
            execute_local "$cmd" "${args_raw[@]}"
            exit_code=$?
            ;;
        4*)
            log_error "mode=api command=$cmd http_status=$http_code outcome=client-error"
            echo "$body" >&2
            exit_code=1
            ;;
        5*)
            log_error "mode=api command=$cmd http_status=$http_code outcome=server-error"
            echo "$body" >&2
            exit_code=1
            ;;
        *)
            log_error "mode=api command=$cmd http_status=$http_code outcome=unexpected-status"
            echo "$body" >&2
            exit_code=1
            ;;
    esac

    unset __REVIEWCTL_WRAPPER_LOOP
    return $exit_code
}

reviewctl_init() {
    if _reviewctl_safe_mode && (($# == 0)); then
        execute_cmd "init"
        return $?
    fi
    execute_cmd "init" "$@"
}
reviewctl_plan()    { execute_cmd "plan" "$@"; }
reviewctl_run()     { execute_cmd "run" "$@"; }
reviewctl_verdict() {
    if (($# == 0)); then
        execute_cmd "verdict" "--allow-incomplete"
        return $?
    fi
    execute_cmd "verdict" "$@"
}
reviewctl_status()  { execute_cmd "status" "$@"; }
reviewctl_doctor()  { execute_cmd "doctor" "$@"; }
reviewctl_full_workflow() {
    local artifact_root
    artifact_root="$(resolve_artifact_root)"
    if [[ "${1:-}" == "--reset" ]]; then
        log_warn "Resetting run state..."
        rm -f "$artifact_root/_ctx/review_runs/current.json"
    fi
    reviewctl_init && reviewctl_plan && reviewctl_run && reviewctl_verdict
}
