#!/bin/bash
set -e

ELASTICMQ_VERSION="1.6.9"
ELASTICMQ_JAR=".elasticmq/elasticmq-server.jar"
ELASTICMQ_URL="https://s3-eu-west-1.amazonaws.com/softwaremill-public/elasticmq-server-${ELASTICMQ_VERSION}.jar"

if [ ! -f "$ELASTICMQ_JAR" ]; then
    echo "Downloading ElasticMQ ${ELASTICMQ_VERSION}..."
    mkdir -p .elasticmq
    curl -L -o "$ELASTICMQ_JAR" "$ELASTICMQ_URL"
fi

exec java -Dconfig.file=elasticmq.conf -jar "$ELASTICMQ_JAR"
