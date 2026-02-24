import { Link, useRouter } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useNotify } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCreateWorkspace } from "@/hooks/use-workspaces";

const NAME_PATTERN = /^[a-z0-9-]+$/;
const DEFAULT_IMAGE = "rockpool-workspace";

export function WorkspaceNewPage() {
	const router = useRouter();
	const notify = useNotify();
	const [name, setName] = useState("");
	const [nameError, setNameError] = useState<string | null>(null);
	const createMutation = useCreateWorkspace();

	function validateName(value: string): string | null {
		if (value.length < 3) return "Name must be at least 3 characters";
		if (value.length > 63) return "Name must be at most 63 characters";
		if (!NAME_PATTERN.test(value)) return "Only lowercase letters, numbers, and hyphens";
		return null;
	}

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		const error = validateName(name);
		if (error) {
			setNameError(error);
			return;
		}

		createMutation.mutate(
			{ name, image: DEFAULT_IMAGE },
			{
				onSuccess: (workspace) => {
					notify.success(`Workspace "${workspace.name}" created`);
					router.navigate({ to: "/workspaces/$id", params: { id: workspace.id } });
				},
			},
		);
	}

	return (
		<div className="space-y-6">
			<nav className="flex items-center gap-1 text-sm text-muted-foreground">
				<Link to="/workspaces" className="hover:text-foreground">
					Workspaces
				</Link>
				<ChevronRight className="size-4" />
				<span className="text-foreground font-medium">New workspace</span>
			</nav>

			<h1 className="text-2xl font-semibold">Create workspace</h1>
			<p className="text-muted-foreground">Start a new isolated development environment.</p>

			<Card className="max-w-lg">
				<CardHeader>
					<CardTitle>Workspace details</CardTitle>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSubmit} className="space-y-6">
						<div className="grid gap-2">
							<label htmlFor="workspace-name" className="text-sm font-medium">
								Name
							</label>
							<Input
								id="workspace-name"
								value={name}
								onChange={(e) => {
									setName(e.target.value);
									if (nameError) setNameError(validateName(e.target.value));
								}}
								onBlur={() => {
									if (name) setNameError(validateName(name));
								}}
								placeholder="my-workspace"
								autoFocus
							/>
							{nameError && <p className="text-sm text-destructive">{nameError}</p>}
						</div>

						<div className="grid gap-2">
							<label htmlFor="workspace-image" className="text-sm font-medium">
								Image
							</label>
							<Input id="workspace-image" value={DEFAULT_IMAGE} disabled />
						</div>

						{createMutation.isError && (
							<Alert variant="destructive">
								<AlertDescription>
									{createMutation.error?.message ?? "Failed to create workspace"}
								</AlertDescription>
							</Alert>
						)}

						<div className="flex items-center gap-3">
							<Button type="submit" disabled={createMutation.isPending}>
								{createMutation.isPending ? "Creating..." : "Create workspace"}
							</Button>
							<Link to="/workspaces">
								<Button type="button" variant="outline">
									Cancel
								</Button>
							</Link>
						</div>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
