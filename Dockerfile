FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates util-linux openssh-client sshpass \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json server.js ./
COPY public ./public
COPY scripts ./scripts
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh /app/scripts/update-mihomo-subscription

ENV NODE_ENV=production \
  PORT=5178 \
  LISTEN_HOST=0.0.0.0 \
  DATA_DIR=/app/data \
  MIHOMO_MODE=local

EXPOSE 5178

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
