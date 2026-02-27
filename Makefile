.PHONY: all ci clean setup

STAMP_DIR := .stamps
TART_HOME := $(CURDIR)/.tart
UNAME_S := $(shell uname -s)
export TART_HOME

TSP_SOURCES := typespec/main.tsp typespec/tspconfig.yaml

ifeq ($(UNAME_S),Linux)
all: development.env build/sdk
else
all: development.env build/sdk $(STAMP_DIR)/rockpool-workspace
endif

ci: development.env build/sdk

$(STAMP_DIR):
	mkdir -p $(STAMP_DIR)

build/openapi/openapi.yaml: $(TSP_SOURCES)
	npx tsp compile typespec/
	sed -i.bak 's/\.optional()/\.nullish()/g' build/validators/schemas.ts && rm -f build/validators/schemas.ts.bak
	sed -i.bak 's/where: { name },/where: { name: name as any },/g' build/db-schema/describe.ts && rm -f build/db-schema/describe.ts.bak
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

$(STAMP_DIR)/firecracker-rootfs: images/scripts/build-firecracker-rootfs.sh images/scripts/setup.sh images/firecracker/rockpool-net-setup.sh images/firecracker/rockpool-net.service | $(STAMP_DIR)
	sudo images/scripts/build-firecracker-rootfs.sh
	touch $@

setup:
ifeq ($(UNAME_S),Linux)
	@echo "Detected Linux — running Firecracker setup..."
	sudo npm-scripts/linux-setup.sh
else ifeq ($(UNAME_S),Darwin)
	@echo "Detected macOS — install prerequisites via Homebrew:"
	@echo "  brew install cirruslabs/cli/tart openjdk"
	@echo "  make all"
else
	@echo "Unsupported platform: $(UNAME_S)"
	@echo "Rockpool supports macOS (Tart) and Linux (Firecracker)."
	@exit 1
endif
