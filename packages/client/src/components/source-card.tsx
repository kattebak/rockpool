import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SourceCardProps {
	icon: LucideIcon;
	title: string;
	description: string;
	onClick: () => void;
	className?: string;
}

export function SourceCard({
	icon: Icon,
	title,
	description,
	onClick,
	className,
}: SourceCardProps) {
	return (
		<Card
			className={cn(
				"cursor-pointer transition-colors hover:border-primary hover:bg-accent/50",
				className,
			)}
			onClick={onClick}
			role="button"
			tabIndex={0}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onClick();
				}
			}}
		>
			<CardContent className="flex items-center gap-4">
				<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
					<Icon className="size-5" />
				</div>
				<div className="grid gap-0.5">
					<p className="font-medium">{title}</p>
					<p className="text-sm text-muted-foreground">{description}</p>
				</div>
			</CardContent>
		</Card>
	);
}
