import { Link, useRouter } from "@tanstack/react-router";
import { ChevronRight, FolderPlus, Github } from "lucide-react";
import { SourceCard } from "@/components/source-card";

export function WorkspaceNewPage() {
	const router = useRouter();

	return (
		<div className="space-y-6">
			<nav className="flex items-center gap-1 text-sm text-muted-foreground">
				<Link to="/workspaces" className="hover:text-foreground">
					Workspaces
				</Link>
				<ChevronRight className="size-4" />
				<span className="text-foreground font-medium">New workspace</span>
			</nav>

			<h1 className="text-2xl font-semibold">Create workspace</h1>
			<p className="text-muted-foreground">Choose how to start your new workspace.</p>

			<div className="grid max-w-lg gap-3">
				<SourceCard
					icon={Github}
					title="Clone from GitHub"
					description="Start from an existing repository"
					onClick={() => router.navigate({ to: "/workspaces/new/repo" })}
				/>
				<SourceCard
					icon={FolderPlus}
					title="Blank workspace"
					description="Start with an empty environment"
					onClick={() =>
						router.navigate({ to: "/workspaces/new/configure", search: { repo: undefined } })
					}
				/>
			</div>
		</div>
	);
}
