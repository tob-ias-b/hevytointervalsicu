#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="$REPO_ROOT/wwwroot/apifeed"
PYTHON=""

if command -v node >/dev/null 2>&1; then
  echo "Checking JavaScript syntax with Node..."
  node --check "$APP_DIR/app.js"
else
  echo "Node not found; skipping JavaScript syntax check."
fi

if command -v python3 >/dev/null 2>&1; then
  PYTHON="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
  PYTHON="$(command -v python)"
else
  echo "Python 3 is required to run the API app contract tests." >&2
  exit 1
fi

echo "Running API app contract tests with $PYTHON..."
"$PYTHON" "$REPO_ROOT/tests/apifeed/test_app.py"
