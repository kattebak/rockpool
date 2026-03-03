FROM docker.io/softwaremill/elasticmq-native AS elasticmq

FROM node:22-bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends podman make python3 g++ && \
    rm -rf /var/lib/apt/lists/*

COPY --from=elasticmq /opt/elasticmq /opt/elasticmq
COPY --from=elasticmq /opt/elasticmq.conf /opt/elasticmq.conf
COPY --from=elasticmq /opt/logback.xml /opt/logback.xml

COPY entrypoint.sh /opt/entrypoint.sh

WORKDIR /app

ENTRYPOINT ["/opt/entrypoint.sh"]
CMD ["node", "--experimental-strip-types", "packages/server/src/index.ts"]
