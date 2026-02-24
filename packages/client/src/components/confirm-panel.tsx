import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ConfirmPanelProps {
	title: string;
	description: string;
	confirmLabel: string;
	variant?: "default" | "destructive";
	isPending?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}

export function ConfirmPanel({
	title,
	description,
	confirmLabel,
	variant = "default",
	isPending = false,
	onConfirm,
	onCancel,
}: ConfirmPanelProps) {
	return (
		<div className="animate-in fade-in slide-in-from-top-1 duration-200 rounded-lg border bg-card p-4 space-y-3">
			<div className="flex items-start gap-3">
				<AlertTriangle className="size-5 shrink-0 text-warning mt-0.5" />
				<div className="space-y-1">
					<p className="font-medium text-sm">{title}</p>
					<p className="text-sm text-muted-foreground">{description}</p>
				</div>
			</div>
			<div className="flex items-center gap-2 pl-8">
				<Button size="sm" variant={variant} disabled={isPending} onClick={onConfirm}>
					{isPending ? "Processing..." : confirmLabel}
				</Button>
				<Button size="sm" variant="outline" disabled={isPending} onClick={onCancel}>
					Cancel
				</Button>
			</div>
		</div>
	);
}
