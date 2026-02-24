import {
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	redirect,
} from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/api";
import { LoginPage } from "@/routes/login";
import { SettingsPage } from "@/routes/settings";
import { WorkspaceDetailPage } from "@/routes/workspace-detail";
import { WorkspaceNewPage } from "@/routes/workspace-new";
import { WorkspaceListPage } from "@/routes/workspaces";

const rootRoute = createRootRoute({
	component: Outlet,
});

const loginRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/login",
	component: LoginPage,
});

const authenticatedRoute = createRoute({
	getParentRoute: () => rootRoute,
	id: "authenticated",
	component: AppShell,
	beforeLoad: async () => {
		try {
			await getCurrentUser();
		} catch {
			throw redirect({ to: "/login" });
		}
	},
});

const indexRoute = createRoute({
	getParentRoute: () => authenticatedRoute,
	path: "/",
	beforeLoad: () => {
		throw redirect({ to: "/workspaces" });
	},
});

const workspacesRoute = createRoute({
	getParentRoute: () => authenticatedRoute,
	path: "/workspaces",
	component: WorkspaceListPage,
});

const workspaceNewRoute = createRoute({
	getParentRoute: () => authenticatedRoute,
	path: "/workspaces/new",
	component: WorkspaceNewPage,
});

const workspaceDetailRoute = createRoute({
	getParentRoute: () => authenticatedRoute,
	path: "/workspaces/$id",
	component: WorkspaceDetailPage,
});

const settingsRoute = createRoute({
	getParentRoute: () => authenticatedRoute,
	path: "/settings",
	component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
	loginRoute,
	authenticatedRoute.addChildren([
		indexRoute,
		workspacesRoute,
		workspaceNewRoute,
		workspaceDetailRoute,
		settingsRoute,
	]),
]);

export const router = createRouter({
	routeTree,
	basepath: "/app",
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
