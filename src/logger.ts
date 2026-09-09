import { format } from "node:util";
import { Logger, type LoggerService } from "@nestjs/common";
import type { LoggerContext, LoggerTransport } from "@restatedev/restate-sdk";

type LogMethod = "verbose" | "debug" | "log" | "warn" | "error";

const methods: Record<string, LogMethod> = {
	trace: "verbose",
	debug: "debug",
	info: "log",
	warn: "warn",
	error: "error",
};

function prefix(context: LoggerContext | undefined): string {
	if (!context) return "";
	return `[${context.invocationTarget}][${context.invocationId}] `;
}

/**
 * A Restate SDK `LoggerTransport` that writes through a NestJS logger.
 * Replay logs are skipped, like the SDK's default console transport.
 */
export function nestLoggerTransport(
	logger: LoggerService = new Logger("Restate"),
): LoggerTransport {
	return (meta, message, ...optionalParams) => {
		if (meta.replaying) return;
		const method = methods[meta.level] ?? "log";
		logger[method]?.(prefix(meta.context) + format(message, ...optionalParams));
	};
}
