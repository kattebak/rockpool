import { Link, Outlet } from "@tanstack/react-router";
import { LayoutDashboard, LogOut, Plus, Settings, User } from "lucide-react";
import { BannerContainer } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { useCurrentUser, useLogout } from "@/hooks/use-auth";

const SIDEBAR_WIDTH = "w-60";

export function AppShell() {
	const { data: user } = useCurrentUser();
	const logoutMutation = useLogout();

	return (
		<div className="flex min-h-screen flex-col bg-background">
			<header className="sticky top-0 z-50 flex h-16 shrink-0 items-center border-b bg-card">
				<Link to="/workspaces" className={`flex ${SIDEBAR_WIDTH} shrink-0 items-center gap-3 px-5`}>
					<img src="/app/hermit.svg" alt="Rockpool" className="size-8" />
					<span className="text-lg font-semibold tracking-tight">Rockpool</span>
				</Link>

				<Separator orientation="vertical" className="h-6" />

				<div className="flex flex-1 self-stretch items-center justify-end gap-4 bg-sidebar px-8">
					<Link to="/workspaces/new">
						<Button size="sm">
							<Plus />
							New workspace
						</Button>
					</Link>

					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="sm" className="gap-2">
								<User className="size-4" />
								{user?.username ?? "Account"}
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-48">
							<DropdownMenuLabel>{user?.username ?? "My Account"}</DropdownMenuLabel>
							<DropdownMenuSeparator />
							<DropdownMenuItem asChild>
								<Link to="/settings">
									<Settings className="size-4" />
									Settings
								</Link>
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								onClick={() => logoutMutation.mutate()}
								disabled={logoutMutation.isPending}
							>
								<LogOut className="size-4" />
								Log out
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</header>

			<div className="flex flex-1">
				<aside
					className={`sticky top-16 flex h-[calc(100vh-4rem)] ${SIDEBAR_WIDTH} shrink-0 flex-col border-r bg-card`}
				>
					<nav className="flex flex-col gap-3 px-5 pt-8">
						<NavLink to="/workspaces">
							<LayoutDashboard className="size-4" />
							Workspaces
						</NavLink>
						<NavLink to="/settings">
							<Settings className="size-4" />
							Settings
						</NavLink>
					</nav>
				</aside>

				<div className="flex flex-1 flex-col">
					<BannerContainer />
					<main className="flex-1 px-12 py-12">
						<Outlet />
					</main>
				</div>
			</div>
		</div>
	);
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
	return (
		<Link
			to={to}
			className="flex items-center gap-3 rounded-md px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&.active]:bg-accent [&.active]:text-foreground [&.active]:font-medium"
		>
			{children}
		</Link>
	);
}
