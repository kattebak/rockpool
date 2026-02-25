import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api";
import { router } from "@/router";

const CURRENT_USER_KEY = ["currentUser"] as const;

export function useCurrentUser() {
	return useQuery({
		queryKey: CURRENT_USER_KEY,
		queryFn: () => api.getCurrentUser(),
		retry: false,
		staleTime: 60_000,
	});
}

export function useLogout() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () => api.logout(),
		onSuccess: () => {
			queryClient.clear();
			router.navigate({ to: "/login" });
		},
	});
}
