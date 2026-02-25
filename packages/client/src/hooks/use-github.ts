import { useInfiniteQuery } from "@tanstack/react-query";
import * as api from "@/lib/api";

const GITHUB_REPOS_KEY = ["github", "repos"] as const;

function githubSearchKey(q: string) {
	return ["github", "repos", "search", q] as const;
}

export function useGitHubRepos() {
	return useInfiniteQuery({
		queryKey: GITHUB_REPOS_KEY,
		queryFn: ({ pageParam }) =>
			api.listGitHubRepos({
				sort: "updated",
				page: pageParam as number | undefined,
			}),
		initialPageParam: undefined as number | undefined,
		getNextPageParam: (lastPage) => lastPage.next_page ?? undefined,
	});
}

export function useGitHubRepoSearch(q: string) {
	return useInfiniteQuery({
		queryKey: githubSearchKey(q),
		queryFn: ({ pageParam }) =>
			api.searchGitHubRepos({
				q,
				page: pageParam as number | undefined,
			}),
		initialPageParam: undefined as number | undefined,
		getNextPageParam: (lastPage) => lastPage.next_page ?? undefined,
		enabled: q.length > 0,
	});
}
