import { Router } from "express";
import type { createPortService } from "../services/port-service.ts";

type PortService = ReturnType<typeof createPortService>;

export function createPortRouter(service: PortService): Router {
	const router = Router({ mergeParams: true });

	router.get<{ id: string }>("/", async (req, res, next) => {
		try {
			const ports = await service.list(req.params.id);
			res.json(ports);
		} catch (err) {
			next(err);
		}
	});

	router.post<{ id: string }>("/", async (req, res, next) => {
		try {
			const { port, label } = req.body;
			const created = await service.add(req.params.id, port, label);
			res.status(201).json(created);
		} catch (err) {
			next(err);
		}
	});

	router.delete<{ id: string; port: string }>("/:port", async (req, res, next) => {
		try {
			const port = Number.parseInt(req.params.port, 10);
			await service.remove(req.params.id, port);
			res.status(204).end();
		} catch (err) {
			next(err);
		}
	});

	return router;
}
