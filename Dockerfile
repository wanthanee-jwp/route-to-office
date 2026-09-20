# Multi-stage build per requirement.md §10.
# Stage 1 builds the frontend (web/dist).
# Stage 2 installs and compiles the Nest backend.
# Stage 3 ships only dist/ + web/dist/ + production deps.
# No secrets pass through ARG or ENV; they are read from Secrets Manager at runtime.

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
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=web-builder /web/dist ./web/dist
COPY package.json ./
EXPOSE 3000
CMD ["node", "dist/main"]
