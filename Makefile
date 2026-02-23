.PHONY: all clean

DRIZZLE_ORM_VERSION := 1.0.0-beta.15-859cf75
STAMP_DIR := .stamps
TART_HOME := $(CURDIR)/.tart
export TART_HOME

TSP_SOURCES := typespec/main.tsp typespec/tspconfig.yaml

all: build/sdk/index.ts $(STAMP_DIR)/rockpool-workspace

$(STAMP_DIR):
	mkdir -p $(STAMP_DIR)

build/openapi/openapi.yaml: $(TSP_SOURCES)
	npx tsp compile typespec/
	npm-scripts/generate-openapi-package.sh build/openapi
	npm-scripts/patch-db-schema-deps.sh build/db-schema $(DRIZZLE_ORM_VERSION)

build/sdk/index.ts: build/openapi/openapi.yaml
	npm-scripts/generate-sdk.sh build/openapi/openapi.yaml build/sdk

clean:
	rm -rf build $(STAMP_DIR)

.envrc:
	@echo 'export TART_HOME="$$PWD/.tart"' > $@
	@echo 'export GITHUB_OAUTH_CLIENT_ID=<your-client-id>' >> $@
	@echo 'export GITHUB_OAUTH_CLIENT_SECRET=<your-client-secret>' >> $@
	@echo "Created .envrc — fill in your GitHub OAuth credentials."
	@echo "See doc/EDD/003_Caddy_Reverse_Proxy.md appendix for setup instructions."

$(STAMP_DIR)/rockpool-workspace: images/workspace.pkr.hcl images/scripts/setup.sh | $(STAMP_DIR)
	packer init images/workspace.pkr.hcl
	packer build images/workspace.pkr.hcl
	touch $@
