import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function SettingsPage() {
	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-semibold">Settings</h1>
			<Card>
				<CardHeader>
					<CardTitle>Preferences</CardTitle>
					<CardDescription>Settings will be available in a future update.</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="text-muted-foreground text-sm">No configurable settings yet.</p>
				</CardContent>
			</Card>
		</div>
	);
}
