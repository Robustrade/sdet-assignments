#!/bin/sh

# Stop old Playwright report servers
for port in 9323 9324; do
  PIDS=$(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null || true)

  if [ -n "$PIDS" ]; then
    echo "Stopping old report server on port $port: $PIDS"
    kill -9 $PIDS 2>/dev/null || true
  fi
done

# Start a fresh report server
exec npx playwright show-report
