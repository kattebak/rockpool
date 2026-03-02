FROM node:22-bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends podman make python3 g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
