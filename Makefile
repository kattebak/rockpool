.PHONY: all clean

STAMP_DIR := .stamps
TART_HOME := $(CURDIR)/.tart
export TART_HOME

TSP_SOURCES := typespec/main.tsp typespec/tspconfig.yaml

all: development.env build/sdk $(STAMP_DIR)/rockpool-workspace

$(STAMP_DIR):
	mkdir -p $(STAMP_DIR)

build/openapi/openapi.yaml: $(TSP_SOURCES)
	npx tsp compile typespec/
	sed -i '' 's/\.optional()/\.nullish()/g' build/validators/schemas.ts
	cd build/db-schema && npm run build
	npm-scripts/generate-openapi-package.sh build/openapi

build/sdk: build/openapi/openapi.yaml
	npx @hey-api/openapi-ts -i build/openapi/openapi.yaml -o $@ -c @hey-api/client-fetch --plugins @hey-api/typescript @hey-api/sdk
	echo '{"name":"@rockpool/sdk","version":"0.0.1","type":"module","exports":{".":"./index.ts","./*":"./*"}}' > $@/package.json
	echo 'export { client } from "./client.gen.js";' >> $@/index.ts
	touch $@

clean:
	rm -rf build $(STAMP_DIR)

development.env:
	cp development.env.example $@
	@echo "Created development.env from template — fill in your secrets."
	@echo "See doc/EDD/003_Caddy_Reverse_Proxy.md appendix for setup instructions."

$(STAMP_DIR)/rockpool-workspace: images/workspace.pkr.hcl images/scripts/setup.sh | $(STAMP_DIR)
	packer init images/workspace.pkr.hcl
	packer build images/workspace.pkr.hcl
	touch $@
