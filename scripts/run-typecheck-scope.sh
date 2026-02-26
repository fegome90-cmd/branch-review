#!/usr/bin/env bash
set -euo pipefail

SCOPE="${1:-app}"

run_app_scope() {
  if [[ ! -f "tsconfig.app.json" ]]; then
    echo "❌ typecheck scope 'app' requires tsconfig.app.json"
    exit 2
  fi

  echo "▶ typecheck: scope=app"
  bun run typecheck:app
}

run_mini_services_scope() {
  if [[ ! -f "tsconfig.mini-services.json" ]]; then
    echo "❌ typecheck scope 'mini-services' requires tsconfig.mini-services.json"
    exit 2
  fi

  echo "▶ typecheck: scope=mini-services"
  bun run typecheck:mini-services
}

case "$SCOPE" in
  app)
    run_app_scope
    ;;
  mini-services)
    run_mini_services_scope
    ;;
  all)
    run_app_scope
    run_mini_services_scope
    ;;
  none)
    echo "ℹ typecheck: scope=none (SKIPPED by configuration)"
    ;;
  *)
    echo "❌ invalid typecheck scope: '$SCOPE'"
    echo "Allowed scopes: app | mini-services | all | none"
    exit 2
    ;;
esac
