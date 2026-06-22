#!/bin/bash
set -euo pipefail

INSTANCE="ros-dash-ie"
CONFIG_DIR="/var/snap/docker/common/${INSTANCE}"
APP_DIR="${CONFIG_DIR}/app"
PORT=3082

# Checkpoint WAL before stopping
echo "Checkpointing database WAL..."
sudo docker exec "${INSTANCE}" node -e "
const Database = require('better-sqlite3');
const db = new Database('/app/ros-dash.db');
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
console.log('WAL checkpointed');
" 2>/dev/null || echo "No running container to checkpoint"

# Clone/update the repo
if [ -d "${APP_DIR}" ]; then
  cd "${APP_DIR}"
  git pull
else
  git clone https://github.com/uniquestar/ROS-Dash.git "${APP_DIR}"
  cd "${APP_DIR}"
fi

cd "${APP_DIR}"

# Copy instance config files
cp "${CONFIG_DIR}/.env" .env
cp "${CONFIG_DIR}/switches.json" switches.json

# Ensure database file exists before mounting
if [ ! -f "${CONFIG_DIR}/ros-dash.db" ]; then
  echo "Database not found — creating empty file..."
  touch "${CONFIG_DIR}/ros-dash.db"
fi

# Build and run
sudo docker build -t "${INSTANCE}" .
sudo docker stop "${INSTANCE}" 2>/dev/null || true
sudo docker rm "${INSTANCE}" 2>/dev/null || true
sudo docker run -d \
  --name "${INSTANCE}" \
  --network host \
  --env-file "${CONFIG_DIR}/.env" \
  --mount type=bind,source="${CONFIG_DIR}/switches.json",target=/app/switches.json \
  --mount type=bind,source="${CONFIG_DIR}/ros-dash.db",target=/app/ros-dash.db \
  --mount type=bind,source="${CONFIG_DIR}/oui-cache.json",target=/app/oui-cache.json \
  --mount type=bind,source="${CONFIG_DIR}/users.json",target=/app/users.json \
  --restart unless-stopped \
  "${INSTANCE}"

# Verify database has users
sleep 3
USER_COUNT=$(sudo docker exec "${INSTANCE}" node -e "
const { initDb, getAllUsers } = require('./src/db');
initDb('/app/ros-dash.db');
console.log(getAllUsers().length);
" 2>/dev/null | tail -1)

if [ "$USER_COUNT" = "0" ] || [ -z "$USER_COUNT" ]; then
  echo ""
  echo "WARNING: No users in database!"
  echo "Run the following to create admin user:"
  echo ""
  echo "  sudo docker exec -it ${INSTANCE} node src/add-user.js admin changeme admin"
  echo ""
else
  echo "Database OK — $USER_COUNT user(s) found"
  cp "${CONFIG_DIR}/ros-dash.db" "${CONFIG_DIR}/ros-dash.db.bak"
  echo "Database backed up to ros-dash.db.bak"
fi
