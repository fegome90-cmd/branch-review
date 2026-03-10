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

resolve_core_cli_path() {
    if [[ -n "${REVIEWCTL_CORE_CLI_PATH:-}" ]]; then
        printf '%s' "$REVIEWCTL_CORE_CLI_PATH"
        return 0
    fi

    printf '%s/mini-services/reviewctl/src/index.ts' "$(_reviewctl_repo_root)"
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
    cli_path="$(resolve_core_cli_path)"

    if [[ ! -f "$cli_path" ]]; then
        log_error "CORE_CLI_PATH not found: $cli_path"
        return 1
    fi

    log_info "mode=local-direct command=$cmd core_cli_path=$cli_path"
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
    cli_path="$(resolve_core_cli_path)"
    export __REVIEWCTL_WRAPPER_LOOP=1

    local exit_code=0

    if [[ -z "${REVIEW_API_TOKEN:-}" ]]; then
        log_warn "mode=local-direct reason=missing-review-api-token command=$cmd core_cli_path=$cli_path"
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

    log_info "mode=api command=$cmd core_cli_path=$cli_path"

    local response
    response=$(curl -sS -w "\n%{http_code}" --connect-timeout 2 \
        -H "X-Review-Token: $REVIEW_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"command\":\"$(json_escape "$cmd")\",\"args\":$args_json}" \
        "$BRANCH_REVIEW_API/api/review/command" 2>/dev/null || printf '\n000')

    local http_code
    http_code=$(echo "$response" | tail -n 1)
    local body
    body=$(echo "$response" | head -n -1)

    case "$http_code" in
        200)
            echo "$body"
            exit_code=0
            ;;
        000)
            log_warn "mode=local-fallback reason=api-unreachable command=$cmd http_status=$http_code core_cli_path=$cli_path"
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

reviewctl_init()    { execute_cmd "init" "--create"; }
reviewctl_plan()    { execute_cmd "plan"; }
reviewctl_run()     { execute_cmd "run"; }
reviewctl_verdict() { execute_cmd "verdict" "--allow-incomplete"; }
reviewctl_status()  { execute_cmd "status"; }
reviewctl_full_workflow() {
    if [[ "${1:-}" == "--reset" ]]; then
        log_warn "Resetting run state..."
        rm -f "$(_reviewctl_repo_root)/_ctx/review_runs/current.json"
    fi
    reviewctl_init && reviewctl_plan && reviewctl_run && reviewctl_verdict
}
