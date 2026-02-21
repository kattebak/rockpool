# TypeSpec Build System for Bookstore API
# ========================================

.PHONY: all clean typespec

# Default target - build all generated packages
all: build/bookstore-openapi3 \
	build/bookstore-types

# Compile TypeSpec to OpenAPI and other outputs
build/openapi3/openapi.json: typespec/**/*.tsp typespec/bookstore-api/tspconfig.yaml
	npx tsp compile ./typespec/bookstore-api

# Generate the OpenAPI spec npm package (includes openapi.json and schema.json)
build/bookstore-openapi3: build/openapi3/openapi.json
	./npm-scripts/generate_spec_package.sh --scope @bookstore $< $@
	@touch $@

# Generate TypeScript types from OpenAPI spec
build/bookstore-types: build/openapi3/openapi.json
	./npm-scripts/generate_types_package.sh --scope @bookstore $< $@
	@touch $@

# Shorthand for TypeSpec compilation only
typespec: build/openapi3/openapi.json

# Clean all generated files
clean:
	rm -rf build
