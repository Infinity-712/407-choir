#!/bin/sh
set -eu
cd "$(dirname "$0")"
exec 9>state/renew.lock
flock -n 9 || exit 0
docker compose run --rm certbot renew --non-interactive --quiet --deploy-hook 'touch /etc/letsencrypt/.reload-needed'
if [ -f state/certs/.reload-needed ]; then
  docker compose exec -T proxy nginx -t
  docker compose exec -T proxy nginx -s reload
  # coturn 4.6.1 reloads TLS certificates on SIGUSR2 without losing allocations.
  docker compose --profile https kill -s SIGUSR2 turn
  docker compose run --rm --entrypoint sh certbot -c 'rm -f /etc/letsencrypt/.reload-needed'
fi
