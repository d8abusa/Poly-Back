#!/usr/bin/env bash
# PolyBack startup — runs backend (HTTPS :8000) and frontend (HTTPS :5173)
set -e

REPO="$(cd "$(dirname "$0")" && pwd)"
CERTS="$REPO/certs"
CERT="$CERTS/localhost+2.pem"
KEY="$CERTS/localhost+2-key.pem"

if [[ ! -f "$CERT" || ! -f "$KEY" ]]; then
  echo "ERROR: TLS certs not found in $CERTS"
  echo "Run: cd $CERTS && mkcert localhost 127.0.0.1 10.0.0.46"
  exit 1
fi

echo "Starting backend  → https://localhost:8000"
source "$REPO/venv/bin/activate"
uvicorn backend.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --ssl-keyfile  "$KEY" \
  --ssl-certfile "$CERT" \
  --reload \
  &
BACKEND_PID=$!

echo "Starting frontend → https://localhost:5173"
cd "$REPO/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "  Backend:  https://localhost:8000"
echo "  Frontend: https://localhost:5173"
echo "  LAN:      https://10.0.0.46:5173"
echo ""
echo "Press Ctrl+C to stop both servers."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
