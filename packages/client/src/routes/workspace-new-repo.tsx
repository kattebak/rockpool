import { Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { RepoCombobox } from "@/components/repo-combobox";
import { Button } from "@/components/ui/button";
import type { GitHubRepo } from "@/lib/api-types";

export function WorkspaceNewRepoPage() {
	const router = useRouter();

	function handleSelect(repo: GitHubRepo) {
		router.navigate({
			to: "/workspaces/new/configure",
			search: { repo: repo.full_name },
		});
	}

	return (
		<div className="space-y-6">
			<nav className="flex items-center gap-1 text-sm text-muted-foreground">
				<Link to="/workspaces" className="hover:text-foreground">
					Workspaces
				</Link>
				<ChevronRight className="size-4" />
				<Link to="/workspaces/new" className="hover:text-foreground">
					New workspace
				</Link>
				<ChevronRight className="size-4" />
				<span className="text-foreground font-medium">Choose repository</span>
			</nav>

			<div className="flex items-center gap-3">
				<Link to="/workspaces/new">
					<Button variant="ghost" size="icon" className="size-8">
						<ArrowLeft className="size-4" />
					</Button>
				</Link>
				<div>
					<h1 className="text-2xl font-semibold">Choose a repository</h1>
					<p className="text-muted-foreground">
						Select a GitHub repository to clone into your workspace.
					</p>
				</div>
			</div>

			<div className="max-w-lg">
				<RepoCombobox onSelect={handleSelect} />
			</div>
		</div>
	);
}
