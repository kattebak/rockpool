import { Link } from "@tanstack/react-router";
import { ExternalLink, MoreHorizontal, Play, Search, Square, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { WorkspaceStatusBadge } from "@/components/workspace-status-badge";
import {
	useDeleteWorkspace,
	useStartWorkspace,
	useStopWorkspace,
	useWorkspaces,
} from "@/hooks/use-workspaces";
import type { Workspace } from "@/lib/api-types";
import { timeAgo } from "@/lib/time";

export function WorkspaceListPage() {
	const { data: workspaces, isPending, isError, error, refetch } = useWorkspaces();
	const [search, setSearch] = useState("");
	const [stopTarget, setStopTarget] = useState<Workspace | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null);

	const startMutation = useStartWorkspace();
	const stopMutation = useStopWorkspace();
	const deleteMutation = useDeleteWorkspace();

	const filtered = useMemo(() => {
		if (!workspaces) return [];
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
		<div className="space-y-4">
			<div className="flex items-center gap-4">
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

			<div className="rounded-lg border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Image</TableHead>
							<TableHead>Updated</TableHead>
							<TableHead className="w-[120px]">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{filtered.map((workspace) => (
							<WorkspaceRow
								key={workspace.id}
								workspace={workspace}
								onStart={(w) => {
									startMutation.mutate(w.id, {
										onSuccess: () => toast.success(`Starting ${w.name}`),
										onError: (err) => toast.error(err.message),
									});
								}}
								onStop={setStopTarget}
								onDelete={setDeleteTarget}
							/>
						))}
						{filtered.length === 0 && (
							<TableRow>
								<TableCell colSpan={5} className="text-center text-muted-foreground py-8">
									No workspaces match your filter.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>

			<ConfirmDialog
				open={stopTarget !== null}
				onOpenChange={(open) => !open && setStopTarget(null)}
				title="Stop workspace"
				description="Stopping a workspace disconnects the IDE and any forwarded ports."
				confirmLabel="Stop workspace"
				variant="destructive"
				isPending={stopMutation.isPending}
				onConfirm={() => {
					if (!stopTarget) return;
					stopMutation.mutate(stopTarget.id, {
						onSuccess: () => {
							toast.success(`Stopping ${stopTarget.name}`);
							setStopTarget(null);
						},
						onError: (err) => toast.error(err.message),
					});
				}}
			/>

			<ConfirmDialog
				open={deleteTarget !== null}
				onOpenChange={(open) => !open && setDeleteTarget(null)}
				title="Delete workspace"
				description={`This will permanently delete "${deleteTarget?.name ?? ""}" and all its data. This action cannot be undone.`}
				confirmLabel="Delete workspace"
				variant="destructive"
				isPending={deleteMutation.isPending}
				onConfirm={() => {
					if (!deleteTarget) return;
					deleteMutation.mutate(deleteTarget.id, {
						onSuccess: () => {
							toast.success(`Deleted ${deleteTarget.name}`);
							setDeleteTarget(null);
						},
						onError: (err) => toast.error(err.message),
					});
				}}
			/>
		</div>
	);
}

function WorkspaceRow({
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
		<TableRow>
			<TableCell>
				<Link
					to="/workspaces/$id"
					params={{ id: workspace.id }}
					className="font-medium text-foreground hover:underline"
				>
					{workspace.name}
				</Link>
			</TableCell>
			<TableCell>
				<WorkspaceStatusBadge status={workspace.status} />
			</TableCell>
			<TableCell>
				<code className="font-mono text-xs text-muted-foreground">{workspace.image}</code>
			</TableCell>
			<TableCell className="text-muted-foreground text-sm">
				{timeAgo(workspace.updatedAt)}
			</TableCell>
			<TableCell>
				<div className="flex items-center gap-1">
					{isRunning && (
						<Button variant="outline" size="xs" asChild>
							<a href={`/workspace/${workspace.name}/`} target="_blank" rel="noopener noreferrer">
								<ExternalLink className="size-3" />
								Open
							</a>
						</Button>
					)}
					{isStopped && (
						<Button
							variant="outline"
							size="xs"
							disabled={isTransitioning}
							onClick={() => onStart(workspace)}
						>
							<Play className="size-3" />
							Start
						</Button>
					)}
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="icon-xs">
								<MoreHorizontal />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							{isRunning && (
								<DropdownMenuItem onClick={() => onStop(workspace)}>
									<Square className="size-4" />
									Stop
								</DropdownMenuItem>
							)}
							{isStopped && (
								<DropdownMenuItem onClick={() => onStart(workspace)}>
									<Play className="size-4" />
									Start
								</DropdownMenuItem>
							)}
							<DropdownMenuItem className="text-destructive" onClick={() => onDelete(workspace)}>
								<Trash2 className="size-4" />
								Delete
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</TableCell>
		</TableRow>
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
		<div className="space-y-4">
			<div className="flex items-center gap-4">
				<Skeleton className="h-8 w-40" />
				<div className="ml-auto">
					<Skeleton className="h-9 w-64" />
				</div>
			</div>
			<div className="rounded-lg border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Image</TableHead>
							<TableHead>Updated</TableHead>
							<TableHead>Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{["a", "b", "c", "d", "e"].map((key) => (
							<TableRow key={key}>
								<TableCell>
									<Skeleton className="h-4 w-24" />
								</TableCell>
								<TableCell>
									<Skeleton className="h-5 w-16" />
								</TableCell>
								<TableCell>
									<Skeleton className="h-4 w-28" />
								</TableCell>
								<TableCell>
									<Skeleton className="h-4 w-16" />
								</TableCell>
								<TableCell>
									<Skeleton className="h-6 w-20" />
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}
