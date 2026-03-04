.PHONY: all ci clean setup

STAMP_DIR := .stamps
TART_HOME := $(CURDIR)/.tart
UNAME_S := $(shell uname -s)
export TART_HOME

TSP_SOURCES := typespec/main.tsp typespec/tspconfig.yaml

ifeq ($(UNAME_S),Linux)
all: rockpool.config.json build/sdk $(STAMP_DIR)/node-modules-linux
else
all: rockpool.config.json build/sdk $(STAMP_DIR)/rockpool-workspace $(STAMP_DIR)/rockpool-root-vm-tart
endif

ci: rockpool.config.json build/sdk

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

rockpool.config.json:
	cp rockpool.config.example.json $@
	@echo "Created rockpool.config.json from template — edit to configure."

packages/config/rockpool.schema.json: packages/config/src/schema.ts
	npm run generate-schema -w packages/config

$(STAMP_DIR)/rockpool-workspace: images/workspace.pkr.hcl images/scripts/setup.sh | $(STAMP_DIR)
	packer init images/workspace.pkr.hcl
	packer build images/workspace.pkr.hcl
	touch $@

$(STAMP_DIR)/node-modules-linux: package-lock.json $(STAMP_DIR)/rockpool-control-plane | $(STAMP_DIR)
	podman run --rm -e CI=1 --entrypoint="" -v $(CURDIR):/app -v rockpool-node-modules:/app/node_modules -w /app rockpool-control-plane:latest npm ci
	touch $@

$(STAMP_DIR)/rockpool-control-plane: images/control-plane/Dockerfile images/control-plane/entrypoint.sh | $(STAMP_DIR)
	podman build -t rockpool-control-plane:latest images/control-plane/
	touch $@


$(STAMP_DIR)/rockpool-workspace-container: images/workspace/Dockerfile images/scripts/setup.sh | $(STAMP_DIR)
	podman build -t rockpool-workspace:latest images/workspace/
	touch $@

$(STAMP_DIR)/rockpool-root-vm: images/root-vm/build-root-vm.sh images/root-vm/setup-root-vm.sh images/root-vm/keys/rockpool-root-vm_ed25519.pub | $(STAMP_DIR)
	images/root-vm/build-root-vm.sh
	touch $@

$(STAMP_DIR)/rockpool-root-vm-tart: images/root-vm/build-root-vm-tart.sh images/root-vm/setup-root-vm.sh images/root-vm/keys/rockpool-root-vm_ed25519.pub | $(STAMP_DIR)
	images/root-vm/build-root-vm-tart.sh
	touch $@

setup:
ifeq ($(UNAME_S),Darwin)
	@echo "Detected macOS — install prerequisites via Homebrew:"
	@echo "  brew install cirruslabs/cli/tart"
	@echo "  make all"
else ifeq ($(UNAME_S),Linux)
	@echo "Detected Linux — install prerequisites:"
	@echo "  sudo apt install qemu-system-x86 qemu-utils virtiofsd mmdebstrap e2fsprogs podman"
	@echo "  make all"
else
	@echo "Unsupported platform: $(UNAME_S)"
	@echo "Rockpool supports macOS (Tart) and Linux (QEMU/KVM + Podman)."
	@exit 1
endif
