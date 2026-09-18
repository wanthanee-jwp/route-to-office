# Multi-stage build per requirement.md §10.
# Stage 1 installs and compiles. Stage 2 ships only dist/ + production deps.
# No secrets pass through ARG or ENV; they are read from Secrets Manager at runtime.

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
COPY package.json ./
EXPOSE 3000
CMD ["node", "dist/main"]
