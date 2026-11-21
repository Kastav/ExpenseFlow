# Multi-stage Cloud Run / Node.js 22 container for ExpenseFlow Backend & Web App.
# Build TypeScript server in the builder; production image contains no esbuild/dev tooling.
# Secrets are provided only at runtime through Cloud Run / Secret Manager.

FROM node:22-alpine AS builder
WORKDIR /app

# This repository currently has no package-lock.json, so copy package.json explicitly.
COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build
RUN npx esbuild server.ts --bundle --platform=node --format=esm --packages=external --outfile=server.mjs

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/server.mjs ./server.mjs

USER node
EXPOSE 8080

CMD ["node", "server.mjs"]
