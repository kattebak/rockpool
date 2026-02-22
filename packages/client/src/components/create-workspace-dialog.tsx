import { type FormEvent, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCreateWorkspace } from "@/hooks/use-workspaces";
import type { Workspace } from "@/lib/api-types";

const NAME_PATTERN = /^[a-z0-9-]+$/;
const DEFAULT_IMAGE = "rockpool-workspace";

interface CreateWorkspaceDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess: (workspace: Workspace) => void;
}

export function CreateWorkspaceDialog({
	open,
	onOpenChange,
	onSuccess,
}: CreateWorkspaceDialogProps) {
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
					setName("");
					setNameError(null);
					createMutation.reset();
					onSuccess(workspace);
				},
			},
		);
	}

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen) {
			setName("");
			setNameError(null);
			createMutation.reset();
		}
		onOpenChange(nextOpen);
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-[480px]">
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>Create workspace</DialogTitle>
						<DialogDescription>Start a new isolated development environment.</DialogDescription>
					</DialogHeader>

					<div className="grid gap-4 py-6">
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
								onBlur={() => setNameError(validateName(name))}
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
					</div>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={createMutation.isPending}>
							{createMutation.isPending ? "Creating..." : "Create workspace"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
