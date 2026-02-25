import { Loader2, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@/components/ui/combobox";
import { useGitHubRepoSearch, useGitHubRepos } from "@/hooks/use-github";
import type { GitHubRepo } from "@/lib/api-types";

interface RepoComboboxProps {
	onSelect: (repo: GitHubRepo) => void;
	selected?: GitHubRepo;
}

export function RepoCombobox({ onSelect, selected }: RepoComboboxProps) {
	const [inputValue, setInputValue] = useState("");
	const [debouncedQuery, setDebouncedQuery] = useState("");
	const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	const listQuery = useGitHubRepos();
	const searchQuery = useGitHubRepoSearch(debouncedQuery);

	const isSearching = debouncedQuery.length > 0;
	const activeQuery = isSearching ? searchQuery : listQuery;
	const repos = activeQuery.data?.pages.flatMap((page) => page.items) ?? [];
	const hasNextPage = activeQuery.hasNextPage;
	const isFetchingNextPage = activeQuery.isFetchingNextPage;

	useEffect(() => {
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, []);

	function handleInputChange(value: string) {
		setInputValue(value);

		if (debounceRef.current) clearTimeout(debounceRef.current);

		debounceRef.current = setTimeout(() => {
			setDebouncedQuery(value.trim());
		}, 300);
	}

	function handleValueChange(value: string | null, _eventDetails: unknown) {
		if (!value) return;
		const repo = repos.find((r) => r.full_name === value);
		if (repo) onSelect(repo);
	}

	return (
		<Combobox value={selected?.full_name ?? null} onValueChange={handleValueChange}>
			<ComboboxInput
				placeholder="Search repositories..."
				value={inputValue}
				onChange={(e) => handleInputChange((e.target as HTMLInputElement).value)}
				showTrigger
				showClear={inputValue.length > 0}
				className="w-full"
			/>
			<ComboboxContent>
				<ComboboxList>
					{activeQuery.isLoading && (
						<div className="flex items-center justify-center py-4">
							<Loader2 className="size-4 animate-spin text-muted-foreground" />
						</div>
					)}
					{repos.map((repo) => (
						<ComboboxItem key={repo.full_name} value={repo.full_name}>
							<img
								src={repo.owner_avatar}
								alt={repo.owner}
								className="size-5 shrink-0 rounded-full"
							/>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<span className="truncate text-sm">{repo.full_name}</span>
									{repo.private && (
										<Badge variant="outline" className="shrink-0 gap-1 text-xs py-0">
											<Lock className="size-3" />
											Private
										</Badge>
									)}
								</div>
								{repo.description && (
									<p className="truncate text-xs text-muted-foreground">{repo.description}</p>
								)}
							</div>
						</ComboboxItem>
					))}
					{hasNextPage && (
						<div className="p-1">
							<Button
								variant="ghost"
								size="sm"
								className="w-full"
								disabled={isFetchingNextPage}
								onClick={(e) => {
									e.preventDefault();
									e.stopPropagation();
									activeQuery.fetchNextPage();
								}}
							>
								{isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : "Load more"}
							</Button>
						</div>
					)}
				</ComboboxList>
				<ComboboxEmpty>No repositories found</ComboboxEmpty>
			</ComboboxContent>
		</Combobox>
	);
}
