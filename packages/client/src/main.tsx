import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BannerProvider } from "@/components/ui/banner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSystemTheme } from "@/hooks/use-system-theme";
import { router } from "@/router";
import "@/styles/globals.css";

function isUnauthorized(error: unknown): boolean {
	if (typeof error === "object" && error !== null && "status" in error) {
		return (error as { status: number }).status === 401;
	}
	return false;
}

function handleGlobal401(error: unknown): void {
	if (!isUnauthorized(error)) return;
	if (window.location.pathname === "/app/login") return;
	router.navigate({ to: "/login" });
}

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: (failureCount, error) => {
				if (isUnauthorized(error)) return false;
				return failureCount < 1;
			},
			staleTime: 2000,
		},
		mutations: {
			onError: handleGlobal401,
		},
	},
});

queryClient.getQueryCache().config.onError = handleGlobal401;

function App() {
	useSystemTheme();

	return (
		<QueryClientProvider client={queryClient}>
			<BannerProvider>
				<TooltipProvider>
					<RouterProvider router={router} />
				</TooltipProvider>
			</BannerProvider>
		</QueryClientProvider>
	);
}

const rootElement = document.getElementById("app");
if (!rootElement) {
	throw new Error("Root element #app not found");
}

createRoot(rootElement).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
