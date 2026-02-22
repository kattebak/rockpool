import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { WorkspaceStatus } from "@/lib/api-types";
import { cn } from "@/lib/utils";

const statusConfig: Record<
	WorkspaceStatus,
	{
		label: string;
		variant: "default" | "secondary" | "destructive" | "outline";
		className: string;
		spin: boolean;
	}
> = {
	creating: {
		label: "Creating",
		variant: "secondary",
		className: "bg-muted text-muted-foreground",
		spin: true,
	},
	running: {
		label: "Running",
		variant: "default",
		className: "bg-success text-success-foreground",
		spin: false,
	},
	stopping: {
		label: "Stopping",
		variant: "secondary",
		className: "bg-warning/20 text-warning",
		spin: true,
	},
	stopped: {
		label: "Stopped",
		variant: "secondary",
		className: "bg-muted text-muted-foreground",
		spin: false,
	},
	error: {
		label: "Error",
		variant: "destructive",
		className: "bg-destructive text-destructive-foreground",
		spin: false,
	},
};

export function WorkspaceStatusBadge({ status }: { status: WorkspaceStatus }) {
	const config = statusConfig[status];

	return (
		<Badge variant={config.variant} className={cn("gap-1", config.className)}>
			{config.spin && <Loader2 className="size-3 animate-spin" />}
			{config.label}
		</Badge>
	);
}
