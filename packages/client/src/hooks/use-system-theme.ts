import { useEffect } from "react";

export function useSystemTheme(): void {
	useEffect(() => {
		const media = matchMedia("(prefers-color-scheme: dark)");

		function apply(dark: boolean): void {
			document.documentElement.classList.toggle("dark", dark);
		}

		apply(media.matches);

		function onChange(e: MediaQueryListEvent): void {
			apply(e.matches);
		}

		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, []);
}
