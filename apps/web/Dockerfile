FROM node:20-bookworm-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS builder

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

FROM node:20-bookworm-slim AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

WORKDIR /app

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/public ./app/public
COPY --from=builder /app/public ./apps/web/public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/static ./app/.next/static
COPY --from=builder /app/.next/static ./apps/web/.next/static

EXPOSE 8080

CMD ["sh", "-c", "if [ -f /app/server.js ]; then node /app/server.js; elif [ -f /app/app/server.js ]; then node /app/app/server.js; elif [ -f /app/apps/web/server.js ]; then node /app/apps/web/server.js; else echo 'server.js not found'; find /app -maxdepth 4 -name server.js; exit 1; fi"]
