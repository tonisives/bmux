#!/bin/sh
set -eu
image="${BMUX_TEST_IMAGE:-bmux-test:local}"
suffix="$$"
database="bmux-test-db-${suffix}"
turn="bmux-test-turn-${suffix}"
cleanup() {
  docker rm -f "$turn" "$database" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
docker run -d --name "$database" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine >/dev/null
attempt=0
until docker exec "$database" pg_isready -U postgres >/dev/null 2>&1; do
  attempt=$((attempt + 1)); test "$attempt" -lt 30; sleep 1
done
docker run -d --name "$turn" --network "container:${database}" coturn/coturn:4.6.3 \
  --no-cli --no-tls --no-dtls --fingerprint --use-auth-secret --static-auth-secret=fixture \
  --realm=bmux-fixture --allow-loopback-peers --no-multicast-peers >/dev/null
docker run --rm --network "container:${database}" --shm-size=256m \
  --security-opt seccomp=containers/chromium-seccomp.json \
  -e BMUX_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres \
  "$image" node_modules/.bin/playwright test tests/remote-host.electron.test.ts tests/remote-capture.electron.test.ts tests/host-proxy.electron.test.ts --output=/tmp/results
docker run --rm --network "container:${database}" --entrypoint node \
  -e BMUX_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres \
  "$image" tests/remote-service.integration.mjs
