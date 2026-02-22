import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api";
import type { AddPortRequest } from "@/lib/api-types";

function portsKey(workspaceId: string) {
	return ["workspaces", workspaceId, "ports"] as const;
}

export function usePorts(workspaceId: string) {
	return useQuery({
		queryKey: portsKey(workspaceId),
		queryFn: () => api.listPorts(workspaceId),
	});
}

export function useAddPort(workspaceId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (data: AddPortRequest) => api.addPort(workspaceId, data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: portsKey(workspaceId) });
		},
	});
}

export function useRemovePort(workspaceId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (port: number) => api.removePort(workspaceId, port),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: portsKey(workspaceId) });
		},
	});
}
