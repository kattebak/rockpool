import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { SettingsPage } from "@/routes/settings";
import { WorkspaceDetailPage } from "@/routes/workspace-detail";
import { WorkspaceNewPage } from "@/routes/workspace-new";
import { WorkspaceListPage } from "@/routes/workspaces";

const rootRoute = createRootRoute({
	component: AppShell,
});

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	beforeLoad: () => {
		throw redirect({ to: "/workspaces" });
	},
});

const workspacesRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/workspaces",
	component: WorkspaceListPage,
});

const workspaceNewRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/workspaces/new",
	component: WorkspaceNewPage,
});

const workspaceDetailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/workspaces/$id",
	component: WorkspaceDetailPage,
});

const settingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings",
	component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
	indexRoute,
	workspacesRoute,
	workspaceNewRoute,
	workspaceDetailRoute,
	settingsRoute,
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
