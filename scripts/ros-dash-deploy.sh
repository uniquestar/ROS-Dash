#!/bin/bash
# Rebuild and restart the ROS-Dash container from origin/main.
#
# Installed root-owned at /usr/local/sbin/ros-dash-deploy and allowed for the
# deploy user via /etc/sudoers.d/ros-dash-deploy, so deploys need no password:
#   sudo /usr/local/sbin/ros-dash-deploy
# It takes no arguments; everything it does is fixed here, so passwordless
# access is limited to "rebuild and restart ROS-Dash".
set -euo pipefail

PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin
export PATH

INSTANCE="ros-dash"
OWNER="proav"
CONFIG_DIR="/var/snap/docker/common/${INSTANCE}"
APP_DIR="${CONFIG_DIR}/app"
REPO_URL="https://github.com/uniquestar/ROS-Dash.git"
PORT=3081

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo $0" >&2
  exit 1
fi

# One deploy at a time
exec 9>"/run/${INSTANCE}-deploy.lock"
if ! flock -n 9; then
  echo "Another ${INSTANCE} deploy is already running" >&2
  exit 1
fi

as_owner() { sudo -u "${OWNER}" -- "$@"; }

echo "==> Checkpointing database WAL..."
docker exec "${INSTANCE}" node -e "
const Database = require('better-sqlite3');
const db = new Database('/app/ros-dash.db');
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
console.log('WAL checkpointed');
" 2>/dev/null || echo "No running container to checkpoint"

# Git runs as the owner (avoids git's dubious-ownership refusal as root).
# fetch + reset instead of pull, so a rewritten history can't wedge the deploy.
echo "==> Updating code..."
if [ -d "${APP_DIR}/.git" ]; then
  as_owner git -C "${APP_DIR}" fetch -q origin
  as_owner git -C "${APP_DIR}" reset -q --hard origin/main
else
  as_owner git clone -q "${REPO_URL}" "${APP_DIR}"
fi
echo "    at $(as_owner git -C "${APP_DIR}" log --oneline -1)"

# Instance config lives outside the repo
as_owner cp "${CONFIG_DIR}/.env" "${APP_DIR}/.env"
as_owner cp "${CONFIG_DIR}/switches.json" "${APP_DIR}/switches.json"
for f in ros-dash.db oui-cache.json; do
  [ -f "${CONFIG_DIR}/${f}" ] || as_owner touch "${CONFIG_DIR}/${f}"
done

echo "==> Building image..."
docker build -q -t "${INSTANCE}" "${APP_DIR}"

echo "==> Restarting container..."
docker stop "${INSTANCE}" >/dev/null 2>&1 || true
docker rm "${INSTANCE}" >/dev/null 2>&1 || true
docker run -d \
  --name "${INSTANCE}" \
  --network host \
  --env-file "${CONFIG_DIR}/.env" \
  --mount type=bind,source="${CONFIG_DIR}/switches.json",target=/app/switches.json \
  --mount type=bind,source="${CONFIG_DIR}/ros-dash.db",target=/app/ros-dash.db \
  --mount type=bind,source="${CONFIG_DIR}/oui-cache.json",target=/app/oui-cache.json \
  --restart unless-stopped \
  "${INSTANCE}" >/dev/null

echo "==> Verifying..."
sleep 3
USER_COUNT=$(docker exec "${INSTANCE}" node -e "
const { initDb, getAllUsers } = require('./src/db');
initDb('/app/ros-dash.db');
console.log(getAllUsers().length);
" 2>/dev/null | tail -1 || true)

if [ "${USER_COUNT}" = "0" ] || [ -z "${USER_COUNT}" ]; then
  echo "WARNING: no users in database (or check failed)."
  echo "Create an admin with: sudo docker exec -it ${INSTANCE} node src/add-user.js <username> <password> admin"
else
  echo "    database OK — ${USER_COUNT} user(s)"
  as_owner cp "${CONFIG_DIR}/ros-dash.db" "${CONFIG_DIR}/ros-dash.db.bak"
  echo "    database backed up to ros-dash.db.bak"
fi

HTTP=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "http://127.0.0.1:${PORT}/login.html" || true)
if [ "${HTTP}" = "200" ]; then
  echo "==> Deployed: login page responding on :${PORT}"
else
  echo "==> WARNING: login page returned '${HTTP}'. Check: sudo docker logs ${INSTANCE}" >&2
  exit 1
fi
