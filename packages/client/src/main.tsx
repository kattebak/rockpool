import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BannerProvider } from "@/components/ui/banner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSystemTheme } from "@/hooks/use-system-theme";
import { router } from "@/router";
import "@/styles/globals.css";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: 1,
			staleTime: 2000,
		},
	},
});

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
