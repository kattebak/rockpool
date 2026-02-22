import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { SettingsPage } from "@/routes/settings";
import { WorkspaceDetailPage } from "@/routes/workspace-detail";
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
