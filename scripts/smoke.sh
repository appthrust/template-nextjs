#!/usr/bin/env bash
set -euo pipefail

# Exercise startup without the connections injected by Platform.
while IFS= read -r variable; do
  case "$variable" in
    PLATFORM_*|APP_ACCESS_*|APTH_*|DATABASE_URL) unset "$variable" ;;
  esac
done < <(compgen -e)
export NEXT_TELEMETRY_DISABLED=1

npm run build

port="${SMOKE_PORT:-3000}"
server_log=$(mktemp)
response_headers=$(mktemp)
server_pid=""
cleanup() {
  status=$?
  trap - EXIT
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  if (( status != 0 )); then
    cat "$server_log" >&2
  fi
  rm -f "$server_log" "$response_headers"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

NODE_ENV=production HOSTNAME=127.0.0.1 PORT="$port" \
  node .next/standalone/server.js >"$server_log" 2>&1 &
server_pid=$!

# Wait for this server's readiness, not a different process using the port.
ready=false
for ((attempt = 0; attempt < 30; attempt++)); do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "Smoke server exited before becoming ready." >&2
    exit 1
  fi
  if grep -q 'Ready in' "$server_log"; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo "Smoke server did not become ready within 30 seconds." >&2
  exit 1
fi

health_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --connect-timeout 2 --max-time 10 "http://127.0.0.1:$port/healthz")
echo "GET /healthz -> $health_status"
if [[ "$health_status" != 200 ]]; then
  echo "Expected GET /healthz to return 200." >&2
  exit 1
fi

# Do not follow redirects: an unauthenticated app may redirect or return 401.
root_status=$(curl --silent --show-error --output /dev/null --dump-header "$response_headers" --write-out '%{http_code}' \
  --connect-timeout 2 --max-time 10 "http://127.0.0.1:$port/")
echo "GET / -> $root_status"
case "$root_status" in
  200|3[0-9][0-9]|401|403) ;;
  503)
    if ! grep -Eiq '^x-appthrust-access:[[:space:]]*unavailable[[:space:]]*$' "$response_headers"; then
      echo "GET / returned 503 without the deliberate app-access unavailable marker." >&2
      exit 1
    fi
    ;;
  *)
    echo "Expected GET / to return 200/3xx/401/403, or a marked app-access 503." >&2
    exit 1
    ;;
esac
