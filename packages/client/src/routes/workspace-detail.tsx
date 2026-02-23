import { Link, useParams, useRouter } from "@tanstack/react-router";
import { ChevronRight, ExternalLink, Play, Square, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PortsPanel } from "@/components/ports-panel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspaceStatusBadge } from "@/components/workspace-status-badge";
import {
	useDeleteWorkspace,
	useStartWorkspace,
	useStopWorkspace,
	useWorkspace,
} from "@/hooks/use-workspaces";
import { timeAgo } from "@/lib/time";
import { buildIdeUrl } from "@/lib/urls";

export function WorkspaceDetailPage() {
	const { id } = useParams({ from: "/workspaces/$id" });
	const router = useRouter();
	const { data: workspace, isPending, isError, error, refetch } = useWorkspace(id);

	const startMutation = useStartWorkspace();
	const stopMutation = useStopWorkspace();
	const deleteMutation = useDeleteWorkspace();

	const [showStop, setShowStop] = useState(false);
	const [showDelete, setShowDelete] = useState(false);

	if (isPending) return <DetailSkeleton />;

	if (isError) {
		return (
			<Alert variant="destructive">
				<AlertDescription className="flex items-center justify-between">
					<span>Failed to load workspace: {error.message}</span>
					<Button variant="outline" size="sm" onClick={() => refetch()}>
						Retry
					</Button>
				</AlertDescription>
			</Alert>
		);
	}

	const isRunning = workspace.status === "running";
	const isStopped = workspace.status === "stopped";
	const isTransitioning = workspace.status === "creating" || workspace.status === "stopping";
	const hasError = workspace.status === "error";

	return (
		<div className="space-y-6">
			<nav className="flex items-center gap-1 text-sm text-muted-foreground">
				<Link to="/workspaces" className="hover:text-foreground">
					Workspaces
				</Link>
				<ChevronRight className="size-4" />
				<span className="text-foreground font-medium">{workspace.name}</span>
			</nav>

			<div className="flex items-start justify-between">
				<div className="flex items-center gap-3">
					<h1 className="text-2xl font-semibold">{workspace.name}</h1>
					<WorkspaceStatusBadge status={workspace.status} />
				</div>
				<div className="flex items-center gap-2">
					{isRunning && (
						<Button asChild>
							<a href={buildIdeUrl(workspace.name)} target="_blank" rel="noopener noreferrer">
								<ExternalLink />
								Open IDE
							</a>
						</Button>
					)}
					{isStopped && (
						<Button
							variant="secondary"
							disabled={isTransitioning || startMutation.isPending}
							onClick={() =>
								startMutation.mutate(id, {
									onSuccess: () => toast.success(`Starting ${workspace.name}`),
									onError: (err) => toast.error(err.message),
								})
							}
						>
							<Play />
							Start
						</Button>
					)}
					{isRunning && (
						<Button variant="outline" onClick={() => setShowStop(true)}>
							<Square />
							Stop
						</Button>
					)}
					{hasError && (
						<Button
							variant="secondary"
							disabled={startMutation.isPending}
							onClick={() =>
								startMutation.mutate(id, {
									onSuccess: () => toast.success(`Retrying ${workspace.name}`),
									onError: (err) => toast.error(err.message),
								})
							}
						>
							<Play />
							Retry start
						</Button>
					)}
					<Button
						variant="destructive"
						disabled={isTransitioning}
						onClick={() => setShowDelete(true)}
					>
						<Trash2 />
						Delete
					</Button>
				</div>
			</div>

			{hasError && workspace.errorMessage && (
				<Alert variant="destructive">
					<AlertDescription>{workspace.errorMessage}</AlertDescription>
				</Alert>
			)}

			<Separator />

			<div className="grid gap-6 md:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Details</CardTitle>
					</CardHeader>
					<CardContent>
						<dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
							<dt className="text-muted-foreground">Image</dt>
							<dd>
								<code className="font-mono text-xs">{workspace.image}</code>
							</dd>
							{workspace.vmIp && (
								<>
									<dt className="text-muted-foreground">VM IP</dt>
									<dd>
										<code className="font-mono text-xs">{workspace.vmIp}</code>
									</dd>
								</>
							)}
							<dt className="text-muted-foreground">Created</dt>
							<dd>{new Date(workspace.createdAt).toLocaleString()}</dd>
							<dt className="text-muted-foreground">Updated</dt>
							<dd>{timeAgo(workspace.updatedAt)}</dd>
						</dl>
					</CardContent>
				</Card>

				<PortsPanel workspaceId={workspace.id} workspaceName={workspace.name} />
			</div>

			<ConfirmDialog
				open={showStop}
				onOpenChange={setShowStop}
				title="Stop workspace"
				description="Stopping a workspace disconnects the IDE and any forwarded ports."
				confirmLabel="Stop workspace"
				variant="destructive"
				isPending={stopMutation.isPending}
				onConfirm={() =>
					stopMutation.mutate(id, {
						onSuccess: () => {
							toast.success(`Stopping ${workspace.name}`);
							setShowStop(false);
						},
						onError: (err) => toast.error(err.message),
					})
				}
			/>

			<ConfirmDialog
				open={showDelete}
				onOpenChange={setShowDelete}
				title="Delete workspace"
				description={`This will permanently delete "${workspace.name}" and all its data. This action cannot be undone.`}
				confirmLabel="Delete workspace"
				variant="destructive"
				isPending={deleteMutation.isPending}
				onConfirm={() =>
					deleteMutation.mutate(id, {
						onSuccess: () => {
							toast.success(`Deleted ${workspace.name}`);
							router.navigate({ to: "/workspaces" });
						},
						onError: (err) => toast.error(err.message),
					})
				}
			/>
		</div>
	);
}

function DetailSkeleton() {
	return (
		<div className="space-y-6">
			<Skeleton className="h-5 w-48" />
			<div className="flex items-center gap-3">
				<Skeleton className="h-8 w-40" />
				<Skeleton className="h-5 w-16" />
			</div>
			<Separator />
			<div className="grid gap-6 md:grid-cols-2">
				<Skeleton className="h-48 w-full rounded-lg" />
				<Skeleton className="h-48 w-full rounded-lg" />
			</div>
		</div>
	);
}
