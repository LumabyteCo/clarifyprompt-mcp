FROM node:22-slim AS builder

WORKDIR /app

# better-sqlite3 needs either prebuilt binaries (via prebuild-install, the default)
# or a C++ toolchain to compile. prebuild-install covers linux-x64 / linux-arm64
# on Node 22 (the current active LTS) — so we do NOT pass --ignore-scripts here;
# we let the package's install script run, which fetches the prebuilt native
# binary. Note: better-sqlite3@12.10.0 dropped prebuilds for Node 20 (which
# reached EOL in April 2026); the Docker base must stay on a maintained LTS
# line. Our CI test matrix validates against node 18/20/22; the runtime image
# tracks current active LTS.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-slim

WORKDIR /app

# Same rule in the runtime stage: let install scripts run so the prebuilt
# better-sqlite3 .node binary lands in node_modules. sqlite-vec ships its
# own prebuilt loadable extension and doesn't need a toolchain.
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist/ ./dist/
COPY packs/ ./packs/

ENTRYPOINT ["node", "dist/index.js"]
