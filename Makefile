.PHONY: all clean build-typespec images/tidepool-alpine

DRIZZLE_ORM_VERSION := 1.0.0-beta.15-859cf75

all: build-typespec

build-typespec:
	npx tsp compile typespec/ || echo "TypeSpec not yet installed, skipping"
	test -d build/openapi && npm-scripts/generate-openapi-package.sh build/openapi || true
	test -d build/db-schema && npm-scripts/patch-db-schema-deps.sh build/db-schema $(DRIZZLE_ORM_VERSION) || true

clean:
	rm -rf build

images/tidepool-alpine: images/alpine-workspace.pkr.hcl images/scripts/alpine-setup.sh
	packer init images/alpine-workspace.pkr.hcl
	packer build images/alpine-workspace.pkr.hcl
