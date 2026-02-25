import { Link, useRouter, useSearch } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { RepoCard } from "@/components/repo-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useNotify } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useGitHubRepoSearch } from "@/hooks/use-github";
import { useCreateWorkspace } from "@/hooks/use-workspaces";
import type { GitHubRepo } from "@/lib/api-types";

const NAME_PATTERN = /^[a-z0-9-]+$/;
const DEFAULT_IMAGE = "rockpool-workspace";

function deriveNameFromRepo(fullName: string): string {
	const parts = fullName.split("/");
	const repoName = parts[parts.length - 1] ?? fullName;
	return repoName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

function validateName(value: string): string | null {
	if (value.length < 3) return "Name must be at least 3 characters";
	if (value.length > 63) return "Name must be at most 63 characters";
	if (!NAME_PATTERN.test(value)) return "Only lowercase letters, numbers, and hyphens";
	return null;
}

function useResolvedRepo(repoFullName: string | undefined): GitHubRepo | undefined {
	const searchQuery = useGitHubRepoSearch(repoFullName ?? "");

	if (!repoFullName) return undefined;

	const repos = searchQuery.data?.pages.flatMap((page) => page.items) ?? [];
	return repos.find((r) => r.full_name === repoFullName);
}

export function WorkspaceNewConfigurePage() {
	const router = useRouter();
	const notify = useNotify();
	const search = useSearch({ strict: false }) as { repo?: string };
	const repoFullName = search.repo;
	const resolvedRepo = useResolvedRepo(repoFullName);

	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [nameError, setNameError] = useState<string | null>(null);
	const [initialized, setInitialized] = useState(false);
	const createMutation = useCreateWorkspace();

	useEffect(() => {
		if (initialized || !resolvedRepo) return;
		setName(deriveNameFromRepo(resolvedRepo.full_name));
		setDescription(resolvedRepo.description ?? "");
		setInitialized(true);
	}, [resolvedRepo, initialized]);

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		const error = validateName(name);
		if (error) {
			setNameError(error);
			return;
		}

		createMutation.mutate(
			{
				name,
				image: DEFAULT_IMAGE,
				description: description || undefined,
				repositoryId: repoFullName,
			},
			{
				onSuccess: (workspace) => {
					notify.success(`Workspace "${workspace.name}" created`);
					router.navigate({ to: "/workspaces/$id", params: { id: workspace.id } });
				},
			},
		);
	}

	const backTo = repoFullName ? "/workspaces/new/repo" : "/workspaces/new";

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
				<span className="text-foreground font-medium">Configure</span>
			</nav>

			<div className="flex items-center gap-3">
				<Link to={backTo}>
					<Button variant="ghost" size="icon" className="size-8">
						<ArrowLeft className="size-4" />
					</Button>
				</Link>
				<div>
					<h1 className="text-2xl font-semibold">Configure workspace</h1>
					<p className="text-muted-foreground">Review settings and create your workspace.</p>
				</div>
			</div>

			<Card className="max-w-lg">
				<CardHeader>
					<CardTitle>Workspace details</CardTitle>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSubmit} className="space-y-6">
						{resolvedRepo && (
							<div className="grid gap-2">
								<label className="text-sm font-medium">Repository</label>
								<RepoCard
									repo={resolvedRepo}
									action={
										<Link to="/workspaces/new/repo">
											<Button variant="ghost" size="sm">
												Change
											</Button>
										</Link>
									}
								/>
							</div>
						)}

						<div className="grid gap-2">
							<label htmlFor="workspace-name" className="text-sm font-medium">
								Name
							</label>
							<Input
								id="workspace-name"
								value={name}
								onChange={(e) => {
									setName(e.target.value);
									if (nameError) setNameError(validateName(e.target.value));
								}}
								onBlur={() => {
									if (name) setNameError(validateName(name));
								}}
								placeholder="my-workspace"
								autoFocus
							/>
							{nameError && <p className="text-sm text-destructive">{nameError}</p>}
						</div>

						<div className="grid gap-2">
							<label htmlFor="workspace-description" className="text-sm font-medium">
								Description
							</label>
							<Input
								id="workspace-description"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder="Optional description"
							/>
						</div>

						<div className="grid gap-2">
							<label htmlFor="workspace-image" className="text-sm font-medium">
								Image
							</label>
							<Input id="workspace-image" value={DEFAULT_IMAGE} disabled />
						</div>

						{createMutation.isError && (
							<Alert variant="destructive">
								<AlertDescription>
									{createMutation.error?.message ?? "Failed to create workspace"}
								</AlertDescription>
							</Alert>
						)}

						<div className="flex items-center gap-3">
							<Button type="submit" disabled={createMutation.isPending}>
								{createMutation.isPending ? "Creating..." : "Create workspace"}
							</Button>
							<Link to="/workspaces">
								<Button type="button" variant="outline">
									Cancel
								</Button>
							</Link>
						</div>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
