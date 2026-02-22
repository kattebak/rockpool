import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

interface ConfirmDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	confirmLabel: string;
	variant?: "default" | "destructive";
	isPending?: boolean;
	onConfirm: () => void;
}

export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel,
	variant = "default",
	isPending = false,
	onConfirm,
}: ConfirmDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[420px]">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button variant={variant} disabled={isPending} onClick={onConfirm}>
						{isPending ? "Processing..." : confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
