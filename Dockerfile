FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
# Patch node-routeros to handle RouterOS 7.18+ !empty API reply
COPY patch-routeros.js ./
RUN node patch-routeros.js
COPY . .
EXPOSE 3081
CMD ["node", "src/index.js"]
