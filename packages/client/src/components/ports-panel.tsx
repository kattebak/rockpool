import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useAddPort, usePorts, useRemovePort } from "@/hooks/use-ports";
import type { Port } from "@/lib/api-types";
import { buildPortPreviewUrl } from "@/lib/urls";

interface PortsPanelProps {
	workspaceId: string;
	workspaceName: string;
}

export function PortsPanel({ workspaceId, workspaceName }: PortsPanelProps) {
	const { data: ports, isPending, isError, error } = usePorts(workspaceId);
	const [showAddForm, setShowAddForm] = useState(false);

	return (
		<Card>
			<CardHeader className="flex-row items-center justify-between space-y-0">
				<CardTitle>Ports</CardTitle>
				<Button variant="outline" size="xs" onClick={() => setShowAddForm(!showAddForm)}>
					<Plus className="size-3" />
					Add port
				</Button>
			</CardHeader>
			<CardContent className="space-y-4">
				{showAddForm && (
					<AddPortForm workspaceId={workspaceId} onDone={() => setShowAddForm(false)} />
				)}

				{isPending && <PortsSkeleton />}

				{isError && (
					<Alert variant="destructive">
						<AlertDescription>{error.message}</AlertDescription>
					</Alert>
				)}

				{ports && ports.length === 0 && !showAddForm && (
					<p className="text-sm text-muted-foreground py-4 text-center">No ports forwarded yet.</p>
				)}

				{ports && ports.length > 0 && (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Port</TableHead>
								<TableHead>Label</TableHead>
								<TableHead className="w-[100px]">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{ports.map((port) => (
								<PortRow
									key={port.port}
									port={port}
									workspaceId={workspaceId}
									workspaceName={workspaceName}
								/>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}

function PortRow({
	port,
	workspaceId,
	workspaceName,
}: {
	port: Port;
	workspaceId: string;
	workspaceName: string;
}) {
	const removeMutation = useRemovePort(workspaceId);

	return (
		<TableRow>
			<TableCell>
				<code className="font-mono text-sm">{port.port}</code>
			</TableCell>
			<TableCell className="text-muted-foreground text-sm">{port.label || "-"}</TableCell>
			<TableCell>
				<div className="flex items-center gap-1">
					<Button variant="ghost" size="icon-xs" asChild>
						<a
							href={buildPortPreviewUrl(workspaceName, port.port)}
							target="_blank"
							rel="noopener noreferrer"
						>
							<ExternalLink className="size-3" />
						</a>
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						disabled={removeMutation.isPending}
						onClick={() =>
							removeMutation.mutate(port.port, {
								onSuccess: () => toast.success(`Removed port ${port.port}`),
								onError: (err) => toast.error(err.message),
							})
						}
					>
						<Trash2 className="size-3" />
					</Button>
				</div>
			</TableCell>
		</TableRow>
	);
}

function AddPortForm({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
	const [portValue, setPortValue] = useState("");
	const [label, setLabel] = useState("");
	const [portError, setPortError] = useState<string | null>(null);
	const addMutation = useAddPort(workspaceId);

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		const num = Number.parseInt(portValue, 10);
		if (Number.isNaN(num) || num < 1024 || num > 65535) {
			setPortError("Port must be between 1024 and 65535");
			return;
		}

		addMutation.mutate(
			{ port: num, label: label || undefined },
			{
				onSuccess: () => {
					toast.success(`Port ${num} added`);
					onDone();
				},
				onError: (err) => toast.error(err.message),
			},
		);
	}

	return (
		<form onSubmit={handleSubmit} className="flex items-end gap-2 rounded-md border p-3">
			<div className="grid gap-1">
				<label htmlFor="port-number" className="text-xs font-medium">
					Port
				</label>
				<Input
					id="port-number"
					type="number"
					min={1024}
					max={65535}
					value={portValue}
					onChange={(e) => {
						setPortValue(e.target.value);
						setPortError(null);
					}}
					placeholder="3000"
					className="w-24"
					autoFocus
				/>
				{portError && <p className="text-xs text-destructive">{portError}</p>}
			</div>
			<div className="grid gap-1 flex-1">
				<label htmlFor="port-label" className="text-xs font-medium">
					Label (optional)
				</label>
				<Input
					id="port-label"
					value={label}
					onChange={(e) => setLabel(e.target.value)}
					placeholder="app-server"
				/>
			</div>
			<Button type="submit" size="sm" disabled={addMutation.isPending}>
				{addMutation.isPending ? "Adding..." : "Add"}
			</Button>
			<Button type="button" variant="ghost" size="sm" onClick={onDone}>
				Cancel
			</Button>
		</form>
	);
}

function PortsSkeleton() {
	return (
		<div className="space-y-2">
			<Skeleton className="h-8 w-full" />
			<Skeleton className="h-8 w-full" />
		</div>
	);
}
