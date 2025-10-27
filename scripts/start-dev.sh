#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v lsof >/dev/null 2>&1; then
  echo "Error: lsof is required but not installed." >&2
  exit 1
fi

resolve_port() {
  local default_port="$1"
  local env_file="$2"
  local env_key="$3"

  local value=""
  if [[ -n "${!env_key:-}" ]]; then
    value="${!env_key}"
  elif [[ -f "$env_file" ]]; then
    value=$(grep -E "^${env_key}=" "$env_file" | tail -n1 | cut -d '=' -f 2-)
  fi

  if [[ -z "$value" ]]; then
    echo "$default_port"
  else
    echo "$value"
  fi
}

BACKEND_PORT=$(resolve_port "8787" "$ROOT_DIR/backend/.env" "PORT_BACKEND")
FRONTEND_PORT=$(resolve_port "5173" "$ROOT_DIR/frontend/.env" "VITE_PORT")

# Deduplicate ports while preserving order
PORTS=()
for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  [[ -z "$port" ]] && continue
  if [[ " ${PORTS[*]} " != *" $port "* ]]; then
    PORTS+=("$port")
  fi
done

free_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti tcp:"$port" || true)

  if [[ -z "$pids" ]]; then
    echo "Port $port is free."
    return
  fi

  echo "Port $port is busy. Terminating processes: $pids"
  kill $pids || true

  for _ in {1..5}; do
    sleep 0.3
    if ! lsof -ti tcp:"$port" >/dev/null; then
      echo "Port $port freed."
      return
    fi
  done

  echo "Processes on port $port did not exit; forcing termination." >&2
  kill -9 $pids || true
  sleep 0.3

  if lsof -ti tcp:"$port" >/dev/null; then
    echo "Failed to free port $port." >&2
    exit 1
  fi
  echo "Port $port freed after SIGKILL."
}

for port in "${PORTS[@]}"; do
  free_port "$port"
done

echo "Starting app with npm run dev..."
exec npm run dev
