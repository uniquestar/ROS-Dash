FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
# Patch node-routeros to handle RouterOS 7.18+ !empty API reply
COPY patch-routeros.js ./
RUN node patch-routeros.js
# Fail the build (not the running app) if a native module didn't install
RUN node -e "require('better-sqlite3'); require('ssh2'); console.log('native modules OK')"
COPY . .
EXPOSE 3081
CMD ["node", "src/index.js"]
