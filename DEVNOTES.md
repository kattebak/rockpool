# Dev Notes — MVP Vertical Slice (2026-02-22)

## Status
- MVP path is live: Caddy routes /workspace/test/* to a Tart VM running code-server.
- code-server health is OK and the IDE loads at http://localhost:8080/workspace/test/.

## What was implemented
- Packer template + Alpine provisioning script for a future baked image.
- Local-only fast path using a public Tart Ubuntu runner image to avoid registry auth.
- Helper scripts to bootstrap Caddy, start VM, and configure code-server.
- Makefile + npm scripts wired for MVP tasks.

## Files changed/added
- images/alpine-workspace.pkr.hcl
- images/scripts/alpine-setup.sh
- npm-scripts/mvp-build-image.sh
- npm-scripts/mvp-start-vm.sh
- npm-scripts/mvp-setup-vm.sh
- npm-scripts/caddy-bootstrap.sh
- npm-scripts/caddy-add-workspace-route.sh
- npm-scripts/caddy-remove-workspace-route.sh
- Makefile
- package.json
- README.md
- doc/EDD/006_Vertical_Slice_MVP.md

## How to run (local fast path)
1. Start VM and print IP:
   - npm run mvp:start-vm
2. Configure code-server in the VM:
   - npm run mvp:setup-vm
3. Start Caddy and load config:
   - caddy start
   - npm run mvp:caddy:bootstrap
4. Add route:
   - npm run mvp:caddy:add-route -- -n test -i <VM_IP>
5. Open:
   - http://localhost:8080/workspace/test/

## Known issues / risks
- Tart registry access to ghcr.io/cirruslabs/alpine:latest returns 403 on this machine; use Ubuntu runner image for now.
- Packer image build still blocked until a public Alpine base image is accessible.

## Next
- Resolve Alpine Tart base image access (public registry or authenticated pull).
- Run the Packer path end-to-end and switch default image back to Alpine.
- Add cleanup/stop script for VM and Caddy route removal.
