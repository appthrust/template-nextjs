# ============================================
# Stage 1: Dependencies Installation Stage
# ============================================

# Node.js is used only to build the code artifact.
# AppThrust Managed Runtime nodejs-24 owns execution and runtime updates.
ARG NODE_VERSION=24.13.0-slim

FROM node:${NODE_VERSION} AS dependencies

# Set working directory
WORKDIR /app

# Copy package-related files first to leverage Docker's caching mechanism
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* .npmrc* ./

# Install project dependencies with frozen lockfile for reproducible builds
RUN --mount=type=cache,target=/root/.npm \
    --mount=type=cache,target=/usr/local/share/.cache/yarn \
    --mount=type=cache,target=/root/.local/share/pnpm/store \
  if [ -f package-lock.json ]; then \
    npm ci --no-audit --no-fund; \
  elif [ -f yarn.lock ]; then \
    corepack enable yarn && yarn install --frozen-lockfile --production=false; \
  elif [ -f pnpm-lock.yaml ]; then \
    corepack enable pnpm && pnpm install --frozen-lockfile; \
  else \
    echo "No lockfile found." && exit 1; \
  fi

# ============================================
# Stage 2: Build Next.js application in standalone mode
# ============================================

FROM node:${NODE_VERSION} AS builder

# Set working directory
WORKDIR /app

# Copy project dependencies from dependencies stage
COPY --from=dependencies /app/node_modules ./node_modules

# Copy application source code
COPY . .

ENV NODE_ENV=production

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
# ENV NEXT_TELEMETRY_DISABLED=1

# Build Next.js application
RUN npm run build

# Prepare the mount point for the Managed Runtime's writable cache volume.
RUN mkdir -p /app/out/.next/cache

# ============================================
# Stage 3: Package the code-only artifact for AppThrust Managed Runtime
# ============================================

FROM scratch AS artifact

# Document the launch environment; image-volume mounts do not apply image ENV.
ENV PORT=3000 HOSTNAME=0.0.0.0 NODE_ENV=production

# The image root is the code tree: the Managed Runtime mounts it at
# /workspace/app and runs node server.js there as UID/GID 1000.
COPY --from=builder --chown=1000:1000 /app/.next/standalone/ /
COPY --from=builder --chown=1000:1000 /app/.next/static /.next/static
COPY --from=builder --chown=1000:1000 /app/public /public
COPY --from=builder --chown=1000:1000 /app/out/ /

EXPOSE 3000
