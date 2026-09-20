# Multi-stage build for Google Cloud Run.
# Stage 1 builds the frontend (web/dist).
# Stage 2 installs and compiles the Nest backend.
# Stage 3 ships only dist/ + web/dist/ + production deps.
# No secrets pass through ARG or ENV; they are read from Secret Manager at runtime.

FROM node:20-alpine AS web-builder
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=Asia/Bangkok
# Cloud Run sends traffic to $PORT (defaults to 8080). main.ts already reads
# process.env.PORT, so no code change is needed — this default matches Cloud Run.
ENV PORT=8080
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=web-builder /web/dist ./web/dist
COPY package.json ./
EXPOSE 8080
CMD ["node", "dist/main"]
