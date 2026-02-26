import { Save } from "lucide-react";
import { useState } from "react";
import { useNotify } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useSaveSettings, useSettings } from "@/hooks/use-settings";
import type { UserPrefsFileName } from "@/lib/api";
import { timeAgo } from "@/lib/time";

const PREF_LABELS: Record<UserPrefsFileName, string> = {
	CodeServerSettings: "Editor Settings",
	CodeServerKeybindings: "Keybindings",
	GitConfig: "Git Config",
};

const ALL_PREFS: UserPrefsFileName[] = ["CodeServerSettings", "CodeServerKeybindings", "GitConfig"];

interface PrefsPanelProps {
	workspaceId: string;
}

export function PrefsPanel({ workspaceId }: PrefsPanelProps) {
	const { data: settings, isPending } = useSettings();
	const saveMutation = useSaveSettings();
	const notify = useNotify();
	const [savingAll, setSavingAll] = useState(false);

	async function saveAll() {
		setSavingAll(true);
		const results = await Promise.allSettled(
			ALL_PREFS.map((name) => saveMutation.mutateAsync({ name, workspaceId })),
		);
		let savedCount = 0;
		for (const result of results) {
			if (result.status === "fulfilled") savedCount++;
		}
		if (savedCount > 0) {
			notify.success(`Saved ${savedCount} preference${savedCount > 1 ? "s" : ""}`);
		}
		setSavingAll(false);
	}

	const settingsMap = new Map(settings?.map((s) => [s.name, s]));

	return (
		<Card>
			<CardHeader className="flex-row items-center justify-between space-y-0">
				<CardTitle>Preferences</CardTitle>
				<Button variant="outline" size="xs" disabled={savingAll} onClick={saveAll}>
					<Save className="size-3" />
					{savingAll ? "Saving..." : "Save all"}
				</Button>
			</CardHeader>
			<CardContent>
				{isPending && <PrefsSkeleton />}

				{!isPending && (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Setting</TableHead>
								<TableHead>Last saved</TableHead>
								<TableHead className="w-[80px]">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{ALL_PREFS.map((name) => {
								const stored = settingsMap.get(name);
								return (
									<PrefRow
										key={name}
										name={name}
										lastSaved={stored?.updatedAt}
										workspaceId={workspaceId}
									/>
								);
							})}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}

function PrefRow({
	name,
	lastSaved,
	workspaceId,
}: {
	name: UserPrefsFileName;
	lastSaved?: string;
	workspaceId: string;
}) {
	const saveMutation = useSaveSettings();
	const notify = useNotify();

	return (
		<TableRow>
			<TableCell className="text-sm">{PREF_LABELS[name]}</TableCell>
			<TableCell className="text-sm text-muted-foreground">
				{lastSaved ? timeAgo(lastSaved) : "Never"}
			</TableCell>
			<TableCell>
				<Button
					variant="ghost"
					size="icon-xs"
					disabled={saveMutation.isPending}
					onClick={() =>
						saveMutation.mutate(
							{ name, workspaceId },
							{
								onSuccess: () => notify.success(`Saved ${PREF_LABELS[name]}`),
							},
						)
					}
				>
					<Save className="size-3" />
				</Button>
			</TableCell>
		</TableRow>
	);
}

function PrefsSkeleton() {
	return (
		<div className="space-y-2">
			<Skeleton className="h-8 w-full" />
			<Skeleton className="h-8 w-full" />
			<Skeleton className="h-8 w-full" />
		</div>
	);
}
