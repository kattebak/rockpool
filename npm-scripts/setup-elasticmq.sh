#!/bin/bash
set -e

ELASTICMQ_VERSION="1.6.16"
ELASTICMQ_JAR=".elasticmq/elasticmq-server.jar"
ELASTICMQ_URL="https://s3-eu-west-1.amazonaws.com/softwaremill-public/elasticmq-server-${ELASTICMQ_VERSION}.jar"

if [ ! -f "$ELASTICMQ_JAR" ]; then
    echo "Downloading ElasticMQ ${ELASTICMQ_VERSION}..."
    mkdir -p .elasticmq
    curl -L -o "$ELASTICMQ_JAR" "$ELASTICMQ_URL"
fi

if [ "$1" = "download" ]; then
    echo "ElasticMQ jar downloaded to $ELASTICMQ_JAR"
    exit 0
fi

CONFIG_FILE="elasticmq.conf"
if [ "$1" = "test" ]; then
    CONFIG_FILE="elasticmq.test.conf"
elif [ "$1" = "production" ]; then
    CONFIG_FILE="elasticmq.production.conf"
fi

exec java -Dconfig.file="$CONFIG_FILE" -jar "$ELASTICMQ_JAR"
