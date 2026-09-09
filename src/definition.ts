import type { Type } from "@nestjs/common";
import type { MetadataScanner } from "@nestjs/core";
import * as restate from "@restatedev/restate-sdk";
import type { HandlerMetadata, ServiceMetadata } from "./decorators.ts";
import { getServiceMetadata } from "./ref.ts";
import { RESTATE_HANDLER_KEY } from "./symbols.ts";

export type RestateDefinition =
	| restate.ServiceDefinition<string, unknown>
	| restate.VirtualObjectDefinition<string, unknown>
	| restate.WorkflowDefinition<string, unknown>;

// biome-ignore lint/suspicious/noExplicitAny: bound handler, typed by the SDK at registration
type BoundHandler = (ctx: any, input: any) => Promise<any>;

function wrapHandler(
	target: Type,
	{ kind }: ServiceMetadata,
	name: string,
	{ shared, options }: HandlerMetadata,
	fn: BoundHandler,
): BoundHandler {
	if (kind === "service") {
		if (shared) {
			throw new Error(
				`${target.name}.${name}: @Shared() is only valid on @VirtualObject() and @Workflow() classes.`,
			);
		}
		return restate.handlers.handler(options, fn);
	}

	if (kind === "object") {
		return shared
			? restate.handlers.object.shared(options, fn)
			: restate.handlers.object.exclusive(options, fn);
	}

	if (name !== "run") return restate.handlers.workflow.shared(options, fn);
	if (shared) {
		throw new Error(
			`${target.name}.run: the workflow handler must use @Handler(), not @Shared().`,
		);
	}
	return restate.handlers.workflow.workflow(options, fn);
}

function collectHandlers(
	instance: object,
	target: Type,
	metadata: ServiceMetadata,
	metadataScanner: MetadataScanner,
): Record<string, BoundHandler> {
	const prototype = Object.getPrototypeOf(instance);
	const handlers: Record<string, BoundHandler> = {};

	for (const name of metadataScanner.getAllMethodNames(prototype)) {
		const method = prototype[name];
		const handlerMetadata: HandlerMetadata | undefined = Reflect.getMetadata(
			RESTATE_HANDLER_KEY,
			method,
		);
		if (!handlerMetadata) continue;
		handlers[name] = wrapHandler(
			target,
			metadata,
			name,
			handlerMetadata,
			method.bind(instance),
		);
	}

	return handlers;
}

/**
 * Builds the Restate SDK definition for an instance of a class decorated with
 * `@Service()`, `@VirtualObject()` or `@Workflow()`.
 */
export function createDefinition(
	instance: object,
	metadataScanner: MetadataScanner,
): RestateDefinition {
	const target = instance.constructor as Type;
	const metadata = getServiceMetadata(target);
	if (!metadata) {
		throw new Error(
			`${target.name} is not a Restate class. Decorate it with @Service(), @VirtualObject() or @Workflow().`,
		);
	}

	const handlers = collectHandlers(instance, target, metadata, metadataScanner);
	if (Object.keys(handlers).length === 0) {
		throw new Error(`${target.name} has no @Handler() methods.`);
	}

	const definition = {
		name: metadata.name ?? target.name,
		handlers,
		description: metadata.description,
		metadata: metadata.metadata,
		options: metadata.options,
	};

	if (metadata.kind === "service") return restate.service(definition);
	if (metadata.kind === "object") return restate.object(definition);

	const { run, ...shared } = handlers;
	if (!run) {
		throw new Error(
			`${target.name} is a @Workflow() and must have a @Handler() method named "run".`,
		);
	}
	return restate.workflow({ ...definition, handlers: { run, ...shared } });
}
