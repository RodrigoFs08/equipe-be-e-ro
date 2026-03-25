FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production --no-audit --no-fund

COPY server.js ./
COPY public ./public
COPY squads ./squads
COPY docs ./docs

ENV NODE_ENV=production
ENV PORT=3030
ENV DOCS_DIR=/app/docs
ENV SQUADS_DIR=/app/squads

EXPOSE 3030

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://localhost:3030/api/squads > /dev/null || exit 1

CMD ["node", "server.js"]
