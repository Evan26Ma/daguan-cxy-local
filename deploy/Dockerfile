FROM node:20.19.3-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY web/ ./web/
COPY local-server/ ./local-server/
RUN mkdir -p /app/data/cxyonly-backups

ENV HOST=0.0.0.0
ENV PORT=8080
ENV DAGUAN_PULL_INTERVAL_MINUTES=30
EXPOSE 8080
CMD ["node", "local-server/server.mjs"]
