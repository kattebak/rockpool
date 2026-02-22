.PHONY: all clean build-typespec

all: build-typespec

build-typespec:
	npm run build -w typespec
	npm-scripts/generate-openapi-package.sh build/openapi

clean:
	rm -rf build
