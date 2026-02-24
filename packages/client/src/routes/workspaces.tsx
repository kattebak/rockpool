import { Link } from "@tanstack/react-router";
import { ExternalLink, Loader2, Pencil, Play, Search, Square, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmPanel } from "@/components/confirm-panel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useNotify } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspaceStatusBadge } from "@/components/workspace-status-badge";
import {
	useDeleteWorkspace,
	useStartWorkspace,
	useStopWorkspace,
	useWorkspaces,
} from "@/hooks/use-workspaces";
import type { Workspace } from "@/lib/api-types";
import { timeAgo } from "@/lib/time";
import { buildIdeUrl } from "@/lib/urls";

export function WorkspaceListPage() {
	const {
		data,
		isPending,
		isError,
		error,
		refetch,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
	} = useWorkspaces();
	const notify = useNotify();
	const [search, setSearch] = useState("");
	const [stopTarget, setStopTarget] = useState<Workspace | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null);

	const startMutation = useStartWorkspace();
	const stopMutation = useStopWorkspace();
	const deleteMutation = useDeleteWorkspace();

	const workspaces = useMemo(() => {
		if (!data) return [];
		return data.pages.flatMap((page) => page.items);
	}, [data]);

	const filtered = useMemo(() => {
		if (!search) return workspaces;
		const lower = search.toLowerCase();
		return workspaces.filter((w) => w.name.includes(lower) || w.image.includes(lower));
	}, [workspaces, search]);

	if (isPending) return <WorkspaceListSkeleton />;

	if (isError) {
		return (
			<Alert variant="destructive">
				<AlertDescription className="flex items-center justify-between">
					<span>Failed to load workspaces: {error.message}</span>
					<Button variant="outline" size="sm" onClick={() => refetch()}>
						Retry
					</Button>
				</AlertDescription>
			</Alert>
		);
	}

	if (workspaces.length === 0) return <EmptyState />;

	return (
		<div className="space-y-8">
			<div className="flex items-center gap-6">
				<h1 className="text-2xl font-semibold">Workspaces</h1>
				<div className="relative ml-auto w-64">
					<Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						placeholder="Filter by name or image"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="pl-9"
					/>
				</div>
			</div>

			{stopTarget && (
				<ConfirmPanel
					title="Stop workspace"
					description="Stopping a workspace disconnects the IDE and any forwarded ports."
					confirmLabel="Stop workspace"
					variant="destructive"
					isPending={stopMutation.isPending}
					onConfirm={() => {
						stopMutation.mutate(stopTarget.id, {
							onSuccess: () => {
								notify.success(`Stopping ${stopTarget.name}`);
								setStopTarget(null);
							},
							onError: (err) => notify.error(err.message),
						});
					}}
					onCancel={() => setStopTarget(null)}
				/>
			)}

			{deleteTarget && (
				<ConfirmPanel
					title="Delete workspace"
					description={`This will permanently delete "${deleteTarget.name}" and all its data. This action cannot be undone.`}
					confirmLabel="Delete workspace"
					variant="destructive"
					isPending={deleteMutation.isPending}
					onConfirm={() => {
						deleteMutation.mutate(deleteTarget.id, {
							onSuccess: () => {
								notify.success(`Deleted ${deleteTarget.name}`);
								setDeleteTarget(null);
							},
							onError: (err) => notify.error(err.message),
						});
					}}
					onCancel={() => setDeleteTarget(null)}
				/>
			)}

			<div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-6">
				{filtered.map((workspace) => (
					<WorkspaceCard
						key={workspace.id}
						workspace={workspace}
						onStart={(w) => {
							startMutation.mutate(w.id, {
								onSuccess: () => notify.success(`Starting ${w.name}`),
								onError: (err) => notify.error(err.message),
							});
						}}
						onStop={setStopTarget}
						onDelete={setDeleteTarget}
					/>
				))}
			</div>

			{filtered.length === 0 && (
				<p className="text-center text-muted-foreground py-8">No workspaces match your filter.</p>
			)}

			{hasNextPage && !search && (
				<div className="flex justify-center">
					<Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
						{isFetchingNextPage && <Loader2 className="size-4 animate-spin" />}
						{isFetchingNextPage ? "Loading..." : "Load more"}
					</Button>
				</div>
			)}
		</div>
	);
}

function WorkspaceCard({
	workspace,
	onStart,
	onStop,
	onDelete,
}: {
	workspace: Workspace;
	onStart: (w: Workspace) => void;
	onStop: (w: Workspace) => void;
	onDelete: (w: Workspace) => void;
}) {
	const isTransitioning = workspace.status === "creating" || workspace.status === "stopping";
	const isRunning = workspace.status === "running";
	const isStopped = workspace.status === "stopped";

	return (
		<Card className="gap-0 py-0">
			<div className="flex items-center justify-between px-6 pt-6 pb-4">
				<Link
					to="/workspaces/$id"
					params={{ id: workspace.id }}
					className="text-base font-medium text-foreground hover:underline truncate"
				>
					{workspace.name}
				</Link>
				{isRunning && (
					<Button
						variant="ghost"
						size="icon-xs"
						className="shrink-0"
						onClick={() => onStop(workspace)}
					>
						<Square />
					</Button>
				)}
			</div>

			<CardContent className="space-y-4 px-6 pb-6">
				<div className="flex items-center gap-3">
					<WorkspaceStatusBadge status={workspace.status} />
					<code className="font-mono text-xs text-muted-foreground truncate">
						{workspace.image}
					</code>
				</div>

				<p className="text-sm text-muted-foreground">Updated {timeAgo(workspace.updatedAt)}</p>

				<div className="flex items-center gap-3">
					{isRunning && (
						<Button variant="outline" size="sm" asChild>
							<a href={buildIdeUrl(workspace.name)} target="_blank" rel="noopener noreferrer">
								<ExternalLink className="size-4" />
								Open IDE
							</a>
						</Button>
					)}
					{isStopped && (
						<Button
							variant="outline"
							size="sm"
							disabled={isTransitioning}
							onClick={() => onStart(workspace)}
						>
							<Play className="size-4" />
							Start
						</Button>
					)}
					<Button variant="outline" size="sm" asChild>
						<Link to="/workspaces/$id" params={{ id: workspace.id }}>
							<Pencil className="size-4" />
							Edit
						</Link>
					</Button>
					<Button variant="ghost" size="icon-xs" onClick={() => onDelete(workspace)}>
						<Trash2 className="size-4" />
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

function EmptyState() {
	return (
		<div className="flex flex-col items-center justify-center py-24">
			<Card className="max-w-md text-center">
				<CardContent className="pt-8 pb-8 space-y-4">
					<h2 className="text-xl font-semibold">No workspaces yet</h2>
					<p className="text-muted-foreground">
						Create your first workspace to start coding in minutes.
					</p>
				</CardContent>
			</Card>
		</div>
	);
}

function WorkspaceListSkeleton() {
	return (
		<div className="space-y-6">
			<div className="flex items-center gap-4">
				<Skeleton className="h-8 w-40" />
				<div className="ml-auto">
					<Skeleton className="h-9 w-64" />
				</div>
			</div>
			<div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-6">
				{["a", "b", "c", "d", "e", "f"].map((key) => (
					<Card key={key} className="gap-0 py-0">
						<div className="px-6 pt-6 pb-4">
							<Skeleton className="h-5 w-36" />
						</div>
						<CardContent className="space-y-4 px-6 pb-6">
							<Skeleton className="h-5 w-28" />
							<Skeleton className="h-4 w-24" />
							<Skeleton className="h-9 w-20" />
						</CardContent>
					</Card>
				))}
			</div>
		</div>
	);
}
