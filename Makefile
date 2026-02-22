.PHONY: all clean build-typespec

all: build-typespec

build-typespec:
	npx tsp compile typespec/ || echo "TypeSpec not yet installed, skipping"
	test -d build/openapi && npm-scripts/generate-openapi-package.sh build/openapi || true

clean:
	rm -rf build
