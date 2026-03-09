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

function _reviewctl_core_cli_path
    if set -q REVIEWCTL_CORE_CLI_PATH
        echo $REVIEWCTL_CORE_CLI_PATH
    else
        echo (_reviewctl_repo_root)"/mini-services/reviewctl/src/index.ts"
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

    if not test -f "$cli_path"
        _reviewctl_log_error "CORE_CLI_PATH not found: $cli_path"
        return 1
    end

    _reviewctl_log_info "mode=local-direct command=$cmd core_cli_path=$cli_path"
    bun "$cli_path" $cmd $argv
end

function _reviewctl_exec
    set -l cmd $argv[1]
    set -l args $argv[2..-1]
    set -l cli_path (_reviewctl_core_cli_path)

    if set -q __REVIEWCTL_WRAPPER_LOOP
        _reviewctl_execute_local $cmd $args
        return $status
    end

    set -gx __REVIEWCTL_WRAPPER_LOOP 1

    if not set -q REVIEW_API_TOKEN
        _reviewctl_log_warn "mode=local-direct reason=missing-review-api-token command=$cmd core_cli_path=$cli_path"
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

    _reviewctl_log_info "mode=api command=$cmd core_cli_path=$cli_path"

    set -l response (curl -sS -w "\n%{http_code}" --connect-timeout 2 \
        -H "X-Review-Token: $REVIEW_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"command":"'$cmd'","args":'$args_json'}' \
        "$BRANCH_REVIEW_API/api/review/command" 2>/dev/null; or echo -e "\n000")

    set -l http_code (echo "$response" | tail -n 1)
    set -l body (echo "$response" | head -n -1)
    set -l exit_code 0

    switch $http_code
        case 200
            echo "$body"
        case 000
            _reviewctl_log_warn "mode=local-fallback reason=api-unreachable command=$cmd http_status=$http_code core_cli_path=$cli_path"
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

function reviewctl_init;    _reviewctl_exec init --create; end
function reviewctl_plan;    _reviewctl_exec plan; end
function reviewctl_run;     _reviewctl_exec run; end
function reviewctl_verdict; _reviewctl_exec verdict --allow-incomplete; end
function reviewctl_status;  _reviewctl_exec status; end
function reviewctl_full_workflow
    if test "$argv[1]" = "--reset"
        _reviewctl_log_warn "Resetting run state..."
        rm -f (_reviewctl_repo_root)/_ctx/review_runs/current.json
    end
    reviewctl_init; and reviewctl_plan; and reviewctl_run; and reviewctl_verdict
end
