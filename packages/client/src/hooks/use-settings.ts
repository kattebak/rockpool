import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserPrefsFileName } from "@/lib/api";
import * as api from "@/lib/api";

const SETTINGS_KEY = ["settings"] as const;

export function useSettings() {
	return useQuery({
		queryKey: SETTINGS_KEY,
		queryFn: () => api.listSettings(),
	});
}

export function useSaveSettings() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ name, workspaceId }: { name: UserPrefsFileName; workspaceId: string }) =>
			api.saveSettings(name, workspaceId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
		},
	});
}
