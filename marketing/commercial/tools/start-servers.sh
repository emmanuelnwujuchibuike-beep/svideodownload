#!/bin/bash
# Starts the local mock Supabase and the app's dev server pointed at it.
# Needs "127.0.0.1 media.frenz.test" in /etc/hosts and mock/cert.pem + key.pem (see README).
set -euo pipefail
P=$(cd "$(dirname "$0")/.." && pwd); REPO=$(cd "$P/../.." && pwd); LOGS=${LOGS:-/tmp}
export NO_PROXY="${NO_PROXY:-},media.frenz.test" no_proxy="${no_proxy:-},media.frenz.test" GLOBAL_AGENT_NO_PROXY="${GLOBAL_AGENT_NO_PROXY:-},media.frenz.test"
cd "$P/mock" && MOCK_LOG=1 nohup node mock-supabase.cjs > "$LOGS/frenz-mock.log" 2>&1 &
cd "$REPO" && NODE_EXTRA_CA_CERTS="$P/mock/cert.pem" \
  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:59999 NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy \
  SUPABASE_SERVICE_ROLE_KEY=dummy NEXT_PUBLIC_SITE_URL=https://frenzsave.com \
  nohup npx next dev -p 3100 > "$LOGS/frenz-next-dev.log" 2>&1 &
echo "mock on :59999/:59443, app on http://localhost:3100 (logs in $LOGS)"
