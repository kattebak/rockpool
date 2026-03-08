#!/usr/bin/env -S node --experimental-strip-types --no-warnings
import { init } from "./commands/init.ts";
import { logs } from "./commands/logs.ts";
import { run } from "./commands/run.ts";
import { stop } from "./commands/stop.ts";

const USAGE = `Usage: rockpool <command> [options]

Commands:
  run [config-file]    Start the rockpool stack
  stop [config-file]   Stop the running stack
  logs [config-file]   Tail compose logs
  init                 Create a config file interactively

Options:
  --help               Show this help message
`;

const argv = process.argv.slice(2);
const command = argv[0];
const args = argv.slice(1);

if (!command || command === "--help") {
	process.stdout.write(USAGE);
	process.exit(command === "--help" ? 0 : 1);
}

const commands: Record<string, (args: string[]) => Promise<void>> = {
	run,
	stop,
	logs,
	init,
};

const handler = commands[command];

if (!handler) {
	process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
	process.exit(1);
}

await handler(args);
