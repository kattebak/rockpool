#!/usr/bin/env node
// Chrome DevTools Protocol CLI
//
// Usage: node chrome-cdp.mjs <command> [args...]
//
// Commands:
//   list                    List open tabs
//   navigate <url>          Navigate to a URL
//   screenshot [path]       Take a screenshot (default: /tmp/screenshot.png)
//   eval <expression>       Evaluate JavaScript in the page
//   reload                  Reload the current page
//   version                 Show browser version info
//
// Environment:
//   CDP_PORT=9222           Remote debugging port (default: 9222)
//   CDP_TAB=0               Tab index to target (default: 0)

import http from "node:http";
import fs from "node:fs";

const PORT = process.env.CDP_PORT || 9222;
const TAB_INDEX = parseInt(process.env.CDP_TAB || "0", 10);

function httpGet(path) {
	return new Promise((resolve, reject) => {
		http.get(`http://localhost:${PORT}${path}`, (res) => {
			let data = "";
			res.on("data", (chunk) => (data += chunk));
			res.on("end", () => resolve(JSON.parse(data)));
			res.on("error", reject);
		}).on("error", reject);
	});
}

function cdpSend(wsUrl, method, params = {}) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(wsUrl);
		ws.onopen = () => {
			ws.send(JSON.stringify({ id: 1, method, params }));
		};
		ws.onmessage = (event) => {
			const msg = JSON.parse(event.data);
			if (msg.id === 1) {
				ws.close();
				if (msg.error) {
					reject(new Error(`${msg.error.message} (${msg.error.code})`));
				} else {
					resolve(msg.result);
				}
			}
		};
		ws.onerror = (err) => reject(err);
	});
}

async function getTab() {
	const tabs = await httpGet("/json/list");
	const pages = tabs.filter((t) => t.type === "page");

	if (pages.length === 0) {
		console.error("No open tabs. Launch Chrome with: chrome.sh launch");
		process.exit(1);
	}

	if (TAB_INDEX >= pages.length) {
		console.error(
			`Tab index ${TAB_INDEX} out of range (${pages.length} tabs open)`,
		);
		process.exit(1);
	}

	return pages[TAB_INDEX];
}

const commands = {
	async version() {
		const info = await httpGet("/json/version");
		console.log(JSON.stringify(info, null, 2));
	},

	async list() {
		const tabs = await httpGet("/json/list");
		for (const [i, tab] of tabs
			.filter((t) => t.type === "page")
			.entries()) {
			console.log(`[${i}] ${tab.title || "(untitled)"}\n    ${tab.url}`);
		}
	},

	async navigate(url) {
		if (!url) {
			console.error("Usage: chrome-cdp.mjs navigate <url>");
			process.exit(1);
		}
		const tab = await getTab();
		const result = await cdpSend(tab.webSocketDebuggerUrl, "Page.navigate", {
			url,
		});
		console.log(`Navigated to ${url} (frame: ${result.frameId})`);
	},

	async screenshot(path = "/tmp/screenshot.png") {
		const tab = await getTab();
		const result = await cdpSend(
			tab.webSocketDebuggerUrl,
			"Page.captureScreenshot",
			{ format: "png" },
		);
		fs.writeFileSync(path, Buffer.from(result.data, "base64"));
		console.log(`Screenshot saved to ${path}`);
	},

	async eval(expression) {
		if (!expression) {
			console.error("Usage: chrome-cdp.mjs eval <expression>");
			process.exit(1);
		}
		const tab = await getTab();
		const result = await cdpSend(
			tab.webSocketDebuggerUrl,
			"Runtime.evaluate",
			{ expression, returnByValue: true },
		);
		if (result.exceptionDetails) {
			console.error(result.exceptionDetails.text);
			process.exit(1);
		}
		const val = result.result;
		if (val.type === "undefined") {
			return;
		}
		console.log(val.value !== undefined ? val.value : val.description);
	},

	async reload() {
		const tab = await getTab();
		await cdpSend(tab.webSocketDebuggerUrl, "Page.reload");
		console.log("Page reloaded");
	},
};

const [command, ...args] = process.argv.slice(2);

if (!command || !commands[command]) {
	console.error(
		`Usage: chrome-cdp.mjs <command> [args...]\n\nCommands: ${Object.keys(commands).join(", ")}`,
	);
	process.exit(1);
}

commands[command](...args).catch((err) => {
	console.error(err.message);
	process.exit(1);
});
