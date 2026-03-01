#!/bin/sh
FOLDER_FILE="$HOME/.config/code-server/workspace-folder"
FOLDER=""
if [ -f "$FOLDER_FILE" ]; then
    FOLDER="$(cat "$FOLDER_FILE")"
fi
exec code-server --bind-addr=0.0.0.0:8080 --auth=none $FOLDER
