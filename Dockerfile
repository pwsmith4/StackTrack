FROM node:22-alpine

WORKDIR /app

# Copy manifests first so dependency installation can be cached separately from
# source changes. Every workspace manifest is needed for npm workspaces.
COPY package.json package-lock.json ./
COPY apps/admin/package.json apps/admin/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/offline-queue/package.json packages/offline-queue/package.json

RUN npm ci

COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/domain packages/domain

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "run", "start", "--workspace", "@stacktrack/api"]
