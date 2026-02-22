import { Link, Outlet, useRouter } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { CreateWorkspaceDialog } from "@/components/create-workspace-dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export function AppShell() {
	const router = useRouter();
	const [createOpen, setCreateOpen] = useState(false);

	return (
		<div className="min-h-screen bg-background">
			<header className="sticky top-0 z-50 border-b bg-card">
				<div className="mx-auto flex h-14 max-w-[1200px] items-center gap-6 px-6">
					<Link to="/workspaces" className="text-lg font-semibold tracking-tight">
						Rockpool
					</Link>

					<Separator orientation="vertical" className="h-6" />

					<nav className="flex items-center gap-4">
						<NavLink to="/workspaces">Workspaces</NavLink>
						<NavLink to="/settings">Settings</NavLink>
					</nav>

					<div className="ml-auto">
						<Button size="sm" onClick={() => setCreateOpen(true)}>
							<Plus />
							New workspace
						</Button>
					</div>
				</div>
			</header>

			<main className="mx-auto max-w-[1200px] px-6 py-8">
				<Outlet />
			</main>

			<CreateWorkspaceDialog
				open={createOpen}
				onOpenChange={setCreateOpen}
				onSuccess={(workspace) => {
					setCreateOpen(false);
					router.navigate({ to: "/workspaces/$id", params: { id: workspace.id } });
				}}
			/>
		</div>
	);
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
	return (
		<Link
			to={to}
			className="text-sm text-muted-foreground transition-colors hover:text-foreground [&.active]:text-foreground [&.active]:font-medium"
		>
			{children}
		</Link>
	);
}
