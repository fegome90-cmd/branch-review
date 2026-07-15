# Portable reviewctl wrapper - API first with deterministic local fallback
set -q BRANCH_REVIEW_API; or set -gx BRANCH_REVIEW_API "http://localhost:3001"

function _reviewctl_wrapper_dir
    cd (dirname (status filename)) >/dev/null 2>/dev/null
    pwd
end

function _reviewctl_repo_root
    cd (_reviewctl_wrapper_dir)/../.. >/dev/null 2>/dev/null
    pwd
end

function _reviewctl_source_repo_root
    if set -q REVIEWCTL_SOURCE_REPO_ROOT
        echo $REVIEWCTL_SOURCE_REPO_ROOT
        return 0
    end

    set -l cli_path (_reviewctl_core_cli_path)
    if test $status -ne 0
        return 1
    end

    cd (dirname "$cli_path")/../../.. >/dev/null 2>/dev/null
    pwd
end

function _reviewctl_target_repo_root
    git rev-parse --show-toplevel >/dev/null 2>/dev/null
    if test $status -eq 0
        git rev-parse --show-toplevel
    else
        pwd
    end
end

function _reviewctl_internal_layout
    test -f (_reviewctl_repo_root)"/mini-services/reviewctl/src/index.ts"
end

function _reviewctl_safe_mode
    if _reviewctl_internal_layout
        return 1
    end
    return 0
end

function _reviewctl_artifact_root
    if set -q REVIEWCTL_ARTIFACT_ROOT
        echo $REVIEWCTL_ARTIFACT_ROOT
    else if _reviewctl_safe_mode
        set -l repo_path (_reviewctl_target_repo_root)
        set -l source_repo_root (_reviewctl_source_repo_root)
        if test $status -ne 0
            return 1
        end
        bun "$source_repo_root/shared/reviewctl-artifact-root.ts" "$repo_path"
    else
        echo (_reviewctl_target_repo_root)
    end
end

function _reviewctl_core_cli_path
    if set -q REVIEWCTL_CORE_CLI_PATH
        echo $REVIEWCTL_CORE_CLI_PATH
    else
        set -l internal_path (_reviewctl_repo_root)"/mini-services/reviewctl/src/index.ts"
        if test -f "$internal_path"
            echo $internal_path
        else
            _reviewctl_log_error "REVIEWCTL_CORE_CLI_PATH is required outside the branch-review repository layout"
            return 1
        end
    end
end

function _reviewctl_log_info
    echo "[reviewctl:info] $argv" >&2
end

function _reviewctl_log_warn
    echo "[reviewctl:warn] $argv" >&2
end

function _reviewctl_log_error
    echo "[reviewctl:error] $argv" >&2
end

function _reviewctl_json_escape
    string escape --style=json -- $argv[1]
end

function _reviewctl_build_args_json
    set -l cmd $argv[1]
    set -e argv[1]

    set -l json_parts
    set -l positional

    while test (count $argv) -gt 0
        set -l arg $argv[1]
        set -e argv[1]

        if string match -qr '^--' -- $arg
            set -l key (string replace -r '^--' '' -- $arg)
            if test (count $argv) -gt 0; and not string match -qr '^--' -- $argv[1]
                set -l value $argv[1]
                set -e argv[1]
                set json_parts $json_parts '"'$key'":'(_reviewctl_json_escape "$value")
            else
                set json_parts $json_parts '"'$key'":true'
            end
        else
            set positional $positional $arg
        end
    end

    if test (count $positional) -gt 0
        if test "$cmd" = "explore"; and test (count $positional) -eq 1
            set json_parts $json_parts '"type":'(_reviewctl_json_escape "$positional[1]")
        else
            return 2
        end
    end

    if test (count $json_parts) -eq 0
        echo "{}"
    else
        echo '{'(string join ',' $json_parts)'}'
    end
end

function _reviewctl_execute_local
    set -l cmd $argv[1]
    set -e argv[1]
    set -l cli_path (_reviewctl_core_cli_path)
    if test $status -ne 0
        return 1
    end
    set -l repo_path (_reviewctl_target_repo_root)
    set -l artifact_root (_reviewctl_artifact_root)

    if not test -f "$cli_path"
        _reviewctl_log_error "CORE_CLI_PATH not found: $cli_path"
        return 1
    end

    mkdir -p "$artifact_root"

    if _reviewctl_safe_mode
        _reviewctl_log_warn "mode=local-direct safe_mode=1 command=$cmd repo_path=$repo_path artifact_root=$artifact_root core_cli_path=$cli_path"
        env REVIEWCTL_SAFE_MODE=1 REVIEWCTL_ARTIFACT_ROOT="$artifact_root" bun "$cli_path" $cmd $argv
    else
        _reviewctl_log_info "mode=local-direct command=$cmd repo_path=$repo_path core_cli_path=$cli_path"
        bun "$cli_path" $cmd $argv
    end
end

function _reviewctl_exec
    set -l cmd $argv[1]
    set -l args $argv[2..-1]
    set -l cli_path (_reviewctl_core_cli_path)
    if test $status -ne 0
        return 1
    end
    set -l repo_path (_reviewctl_target_repo_root)
    set -l artifact_root (_reviewctl_artifact_root)

    if set -q __REVIEWCTL_WRAPPER_LOOP
        _reviewctl_execute_local $cmd $args
        return $status
    end

    set -gx __REVIEWCTL_WRAPPER_LOOP 1

    if not set -q REVIEW_API_TOKEN
        _reviewctl_log_warn "mode=local-direct reason=missing-review-api-token command=$cmd repo_path=$repo_path artifact_root=$artifact_root core_cli_path=$cli_path"
        _reviewctl_execute_local $cmd $args
        set -l exit_code $status
        set -e __REVIEWCTL_WRAPPER_LOOP
        return $exit_code
    end

    set -l args_json (_reviewctl_build_args_json $cmd $args)
    if test $status -ne 0
        _reviewctl_log_warn "mode=local-direct reason=unsupported-positional-args command=$cmd"
        _reviewctl_execute_local $cmd $args
        set -l exit_code $status
        set -e __REVIEWCTL_WRAPPER_LOOP
        return $exit_code
    end

    _reviewctl_log_info "mode=api command=$cmd repo_path=$repo_path artifact_root=$artifact_root core_cli_path=$cli_path"

    set -l response (curl -sS -w "\n%{http_code}" --connect-timeout 2 \
        -H "X-Review-Token: $REVIEW_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"command":"'$cmd'","repoPath":'(_reviewctl_json_escape "$repo_path")',"args":'$args_json'}' \
        "$BRANCH_REVIEW_API/api/review/command" 2>/dev/null; or printf '\n000')

    set -l http_code (echo "$response" | tail -n 1)
    set -l body (echo "$response" | sed '$d')
    set -l exit_code 0

    switch $http_code
        case 200
            echo "$body"
        case 000
            _reviewctl_log_warn "mode=local-fallback reason=api-unreachable command=$cmd repo_path=$repo_path artifact_root=$artifact_root http_status=$http_code core_cli_path=$cli_path"
            _reviewctl_execute_local $cmd $args
            set exit_code $status
        case '4*'
            _reviewctl_log_error "mode=api command=$cmd http_status=$http_code outcome=client-error"
            echo "$body" >&2
            set exit_code 1
        case '5*'
            _reviewctl_log_error "mode=api command=$cmd http_status=$http_code outcome=server-error"
            echo "$body" >&2
            set exit_code 1
        case '*'
            _reviewctl_log_error "mode=api command=$cmd http_status=$http_code outcome=unexpected-status"
            echo "$body" >&2
            set exit_code 1
    end

    set -e __REVIEWCTL_WRAPPER_LOOP
    return $exit_code
end

function reviewctl_init
    if _reviewctl_safe_mode; and test (count $argv) -eq 0
        _reviewctl_exec init
    else
        _reviewctl_exec init $argv
    end
end
function reviewctl_plan;    _reviewctl_exec plan $argv; end
function reviewctl_run;     _reviewctl_exec run $argv; end
function reviewctl_verdict
    if test (count $argv) -eq 0
        _reviewctl_exec verdict --allow-incomplete
    else
        _reviewctl_exec verdict $argv
    end
end
function reviewctl_status;  _reviewctl_exec status $argv; end
function reviewctl_doctor;  _reviewctl_exec doctor $argv; end
function reviewctl_full_workflow
    set -l artifact_root (_reviewctl_artifact_root)
    if test "$argv[1]" = "--reset"
        _reviewctl_log_warn "Resetting run state..."
        rm -f "$artifact_root/_ctx/review_runs/current.json"
    end
    reviewctl_init; and reviewctl_plan; and reviewctl_run; and reviewctl_verdict
end
