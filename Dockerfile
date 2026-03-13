# Stage 1: Download and extract MiniZinc bundle
FROM debian:bookworm-slim AS minizinc-bundle

ARG MINIZINC_VERSION=2.9.5
ARG MINIZINC_ARCHIVE=MiniZincIDE-${MINIZINC_VERSION}-bundle-linux-x86_64.tgz

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL \
      "https://github.com/MiniZinc/MiniZincIDE/releases/download/${MINIZINC_VERSION}/${MINIZINC_ARCHIVE}" \
      -o /tmp/minizinc.tgz \
    && mkdir -p /opt/minizinc \
    && tar -xzf /tmp/minizinc.tgz --strip-components=1 -C /opt/minizinc \
    && rm /tmp/minizinc.tgz

# Stage 2: Build the Node.js app
FROM node:25.8-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build && npm prune --omit=dev

# Stage 3: Runtime image
FROM node:25.8-slim AS runtime

# fzn-gecode is Qt-linked and requires X11/OpenGL libs even in headless mode
RUN apt-get update && apt-get install -y --no-install-recommends \
      libstdc++6 \
      libgcc-s1 \
      libgl1 \
      libegl1 \
      libfontconfig1 \
      libfreetype6 \
      libx11-6 \
      libxcb1 \
      libxau6 \
      libbz2-1.0 \
      libpng16-16 \
    && rm -rf /var/lib/apt/lists/*

# Copy MiniZinc CLI tools and solver libraries only (skip IDE/Qt plugins)
COPY --from=minizinc-bundle /opt/minizinc/bin/   /opt/minizinc/bin/
COPY --from=minizinc-bundle /opt/minizinc/lib/   /opt/minizinc/lib/
COPY --from=minizinc-bundle /opt/minizinc/share/ /opt/minizinc/share/

ENV PATH="/opt/minizinc/bin:$PATH"
ENV LD_LIBRARY_PATH="/opt/minizinc/lib"

WORKDIR /app

COPY --from=builder /app/dist/        ./dist/
COPY --from=builder /app/node_modules/ ./node_modules/
COPY package.json  ./

# Verify the binary works at build time
RUN minizinc --version

ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
ENV HOST=0.0.0.0
ENV PORT=3000
# Tell Qt not to connect to a display (headless Docker environment)
ENV QT_QPA_PLATFORM=offscreen

EXPOSE 3000

ENTRYPOINT ["node", "dist/index.js"]
