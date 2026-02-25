import { cva } from "class-variance-authority";
import { CircleCheck, Info, OctagonX, TriangleAlert, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type BannerVariant = "success" | "error" | "warning" | "info";

interface BannerItem {
	id: string;
	variant: BannerVariant;
	message: string;
}

interface BannerContextValue {
	banners: BannerItem[];
	addBanner: (variant: BannerVariant, message: string) => void;
	dismissBanner: (id: string) => void;
}

const BannerContext = createContext<BannerContextValue | null>(null);

const AUTO_DISMISS_MS = 5000;

export function BannerProvider({ children }: { children: React.ReactNode }) {
	const [banners, setBanners] = useState<BannerItem[]>([]);
	const counterRef = useRef(0);

	const dismissBanner = useCallback((id: string) => {
		setBanners((prev) => prev.filter((b) => b.id !== id));
	}, []);

	const addBanner = useCallback(
		(variant: BannerVariant, message: string) => {
			const id = String(++counterRef.current);
			setBanners((prev) => [...prev, { id, variant, message }]);

			if (variant !== "error") {
				setTimeout(() => dismissBanner(id), AUTO_DISMISS_MS);
			}
		},
		[dismissBanner],
	);

	const value = useMemo(
		() => ({ banners, addBanner, dismissBanner }),
		[banners, addBanner, dismissBanner],
	);

	return <BannerContext.Provider value={value}>{children}</BannerContext.Provider>;
}

export function useBanner() {
	const ctx = useContext(BannerContext);
	if (!ctx) throw new Error("useBanner must be used within BannerProvider");
	return ctx;
}

export function useNotify() {
	const { addBanner } = useBanner();
	return useMemo(
		() => ({
			success: (message: string) => addBanner("success", message),
			error: (message: string) => addBanner("error", message),
			warning: (message: string) => addBanner("warning", message),
			info: (message: string) => addBanner("info", message),
		}),
		[addBanner],
	);
}

const bannerVariants = cva(
	"flex items-center gap-3 px-4 py-3 text-sm border-b last:border-b-0 animate-in slide-in-from-top-2 fade-in duration-200",
	{
		variants: {
			variant: {
				success: "bg-success/10 text-success border-success/20",
				error: "bg-destructive/10 text-destructive border-destructive/20",
				warning: "bg-warning/10 text-warning border-warning/20",
				info: "bg-primary/10 text-primary border-primary/20",
			},
		},
	},
);

const variantIcons: Record<BannerVariant, React.ReactNode> = {
	success: <CircleCheck className="size-4 shrink-0" />,
	error: <OctagonX className="size-4 shrink-0" />,
	warning: <TriangleAlert className="size-4 shrink-0" />,
	info: <Info className="size-4 shrink-0" />,
};

function Banner({ item, onDismiss }: { item: BannerItem; onDismiss: () => void }) {
	return (
		<div className={cn(bannerVariants({ variant: item.variant }))} role="alert">
			{variantIcons[item.variant]}
			<span className="flex-1">{item.message}</span>
			<button
				type="button"
				onClick={onDismiss}
				className="shrink-0 rounded-sm p-0.5 opacity-70 transition-opacity hover:opacity-100"
			>
				<X className="size-3.5" />
				<span className="sr-only">Dismiss</span>
			</button>
		</div>
	);
}

export function BannerContainer() {
	const { banners, dismissBanner } = useBanner();

	if (banners.length === 0) return null;

	return (
		<div className="sticky top-0 z-50 w-full">
			{banners.map((banner) => (
				<Banner key={banner.id} item={banner} onDismiss={() => dismissBanner(banner.id)} />
			))}
		</div>
	);
}
