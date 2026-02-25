import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { GitHubRepo } from "@/lib/api-types";
import { cn } from "@/lib/utils";

interface RepoCardProps {
	repo: GitHubRepo;
	action?: React.ReactNode;
	className?: string;
}

export function RepoCard({ repo, action, className }: RepoCardProps) {
	return (
		<div className={cn("flex items-start gap-3 rounded-lg border p-3", className)}>
			<img src={repo.owner_avatar} alt={repo.owner} className="size-8 shrink-0 rounded-full" />
			<div className="min-w-0 flex-1 grid gap-0.5">
				<div className="flex items-center gap-2">
					<span className="font-medium truncate">{repo.full_name}</span>
					{repo.private && (
						<Badge variant="outline" className="shrink-0 gap-1 text-xs">
							<Lock className="size-3" />
							Private
						</Badge>
					)}
				</div>
				{repo.description && (
					<p className="text-sm text-muted-foreground truncate">{repo.description}</p>
				)}
			</div>
			{action && <div className="shrink-0">{action}</div>}
		</div>
	);
}
