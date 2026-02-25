import type { UserPrefsFileName } from "@rockpool/db";

export const PREFS_FILE_PATHS: Record<UserPrefsFileName, string> = {
	CodeServerSettings: ".local/share/code-server/User/settings.json",
	CodeServerKeybindings: ".local/share/code-server/User/keybindings.json",
	GitConfig: ".gitconfig",
};
