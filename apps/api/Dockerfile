FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/contracts/package.json ./apps/contracts/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY infra/package.json ./infra/package.json
RUN npm ci

COPY apps/contracts ./apps/contracts
COPY apps/api ./apps/api
RUN npm run build --workspace @attendance/contracts \
    && npm run build --workspace @attendance/api \
    && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/contracts/dist ./apps/contracts/dist
COPY --from=build /app/apps/contracts/package.json ./apps/contracts/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
EXPOSE 3000
USER node
CMD ["node", "apps/api/dist/main.js"]
