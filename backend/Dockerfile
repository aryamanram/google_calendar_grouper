FROM node:20-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src/ ./src/

# Don't run as root inside the container.
USER node

# Cloud Run sets PORT (8080); the app reads it.
EXPOSE 8080
CMD ["node", "src/index.js"]
