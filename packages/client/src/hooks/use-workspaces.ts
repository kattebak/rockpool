import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api";
import type { CreateWorkspaceRequest, PaginatedResponse, Workspace } from "@/lib/api-types";

const WORKSPACES_KEY = ["workspaces"] as const;
const PAGE_SIZE = 25;

function workspaceKey(id: string) {
	return ["workspaces", id] as const;
}

export function useWorkspaces() {
	return useInfiniteQuery<PaginatedResponse<Workspace>>({
		queryKey: WORKSPACES_KEY,
		queryFn: ({ pageParam }) =>
			api.listWorkspaces({
				limit: PAGE_SIZE,
				cursor: pageParam as string | undefined,
			}),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.nextCursor,
		refetchInterval: 5000,
	});
}

export function useWorkspace(id: string) {
	return useQuery({
		queryKey: workspaceKey(id),
		queryFn: () => api.getWorkspace(id),
		refetchInterval: 3000,
	});
}

export function useCreateWorkspace() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (data: CreateWorkspaceRequest) => api.createWorkspace(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: WORKSPACES_KEY });
		},
	});
}

export function useDeleteWorkspace() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => api.deleteWorkspace(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: WORKSPACES_KEY });
		},
	});
}

export function useStartWorkspace() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => api.startWorkspace(id),
		onSuccess: (_data, id) => {
			queryClient.invalidateQueries({ queryKey: WORKSPACES_KEY });
			queryClient.invalidateQueries({ queryKey: workspaceKey(id) });
		},
	});
}

export function useStopWorkspace() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => api.stopWorkspace(id),
		onSuccess: (_data, id) => {
			queryClient.invalidateQueries({ queryKey: WORKSPACES_KEY });
			queryClient.invalidateQueries({ queryKey: workspaceKey(id) });
		},
	});
}
