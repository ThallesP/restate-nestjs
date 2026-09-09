import { Injectable, SetMetadata } from "@nestjs/common";
import { SCOPE_OPTIONS_METADATA } from "@nestjs/common/constants.js";
import type {
	Context,
	DefaultServiceOptions,
	ObjectContext,
	ObjectHandlerOpts,
	ObjectOptions,
	ServiceOptions as SdkServiceOptions,
	WorkflowOptions as SdkWorkflowOptions,
} from "@restatedev/restate-sdk";
import { RESTATE_HANDLER_KEY, RESTATE_SERVICE_KEY } from "./symbols.ts";

export type RestateKind = "service" | "object" | "workflow";

type ComponentOptions = {
	/**
	 * Name registered in Restate. Defaults to the class name.
	 */
	name?: string;
	description?: string;
	metadata?: Record<string, string>;
};

export type ServiceOptions = SdkServiceOptions & ComponentOptions;
export type VirtualObjectOptions = ObjectOptions & ComponentOptions;
export type WorkflowOptions = SdkWorkflowOptions & ComponentOptions;

export type ServiceMetadata = ComponentOptions & {
	kind: RestateKind;
	options: DefaultServiceOptions;
};

/**
 * Options accepted by `@Handler()` and `@Shared()`.
 * Same shape as the Restate SDK per-handler options.
 */
// biome-ignore lint/suspicious/noExplicitAny: untyped by default, narrowed by the serdes passed in
export type HandlerOptions<I = any, O = any> = ObjectHandlerOpts<I, O>;

export type HandlerMetadata = {
	shared: boolean;
	options: HandlerOptions;
};

// biome-ignore lint/suspicious/noExplicitAny: the context kind is checked by WithContext
type HandlerMethod<I, O> = (ctx: any, input: I) => Promise<O>;

/**
 * Resolves to `never` unless the method takes a Restate context as its first parameter.
 */
type WithContext<F> = F extends (ctx: infer C, ...args: never[]) => unknown
	? C extends Context
		? unknown
		: never
	: never;

/**
 * Resolves to `never` when the method takes an exclusive context, which shared handlers never get.
 */
type WithSharedContext<F> = F extends (
	ctx: infer C,
	...args: never[]
) => unknown
	? C extends ObjectContext<AnyState>
		? never
		: WithContext<F>
	: never;

// biome-ignore lint/suspicious/noExplicitAny: matches contexts with any typed state
type AnyState = any;

type HandlerDecorator<I, O> = <F extends HandlerMethod<I, O>>(
	target: object,
	propertyKey: string | symbol,
	descriptor: TypedPropertyDescriptor<F> & WithContext<F>,
) => void;

type SharedHandlerDecorator<I, O> = <F extends HandlerMethod<I, O>>(
	target: object,
	propertyKey: string | symbol,
	descriptor: TypedPropertyDescriptor<F> & WithSharedContext<F>,
) => void;

function componentDecorator(
	kind: RestateKind,
	{
		name,
		description,
		metadata,
		...options
	}: ComponentOptions & DefaultServiceOptions,
): ClassDecorator {
	const serviceMetadata: ServiceMetadata = {
		kind,
		name,
		description,
		metadata,
		options,
	};
	return (target) => {
		// keep the scope from an @Injectable() applied below this decorator
		Injectable(Reflect.getMetadata(SCOPE_OPTIONS_METADATA, target))(target);
		SetMetadata(RESTATE_SERVICE_KEY, serviceMetadata)(target);
	};
}

function handlerDecorator<I, O>(
	shared: boolean,
	options: HandlerOptions<I, O>,
): MethodDecorator {
	const handlerMetadata: HandlerMetadata = { shared, options };
	return SetMetadata(RESTATE_HANDLER_KEY, handlerMetadata);
}

/**
 * Registers the class as a Restate Service.
 * Handlers are the methods decorated with `@Handler()`.
 *
 * @example
 * ```ts
 * @Service()
 * export class Greeter {
 *   @Handler()
 *   async greet(ctx: Context, name: string) {
 *     return `Hello ${name}`;
 *   }
 * }
 * ```
 */
export const Service = (options: ServiceOptions = {}): ClassDecorator =>
	componentDecorator("service", options);

/**
 * Registers the class as a Restate Virtual Object.
 * `@Handler()` methods are exclusive, `@Shared()` methods are shared.
 *
 * @example
 * ```ts
 * @VirtualObject()
 * export class Counter {
 *   @Handler()
 *   async add(ctx: ObjectContext, amount: number) {
 *     const count = (await ctx.get<number>("count")) ?? 0;
 *     ctx.set("count", count + amount);
 *     return count + amount;
 *   }
 *
 *   @Shared()
 *   async get(ctx: ObjectSharedContext) {
 *     return (await ctx.get<number>("count")) ?? 0;
 *   }
 * }
 * ```
 */
export const VirtualObject = (
	options: VirtualObjectOptions = {},
): ClassDecorator => componentDecorator("object", options);

/**
 * Registers the class as a Restate Workflow.
 * The `run` method is the workflow handler, every other `@Handler()` is shared.
 *
 * @example
 * ```ts
 * @Workflow()
 * export class Signup {
 *   @Handler()
 *   async run(ctx: WorkflowContext, user: { email: string }) {
 *     await ctx.promise<void>("verified");
 *     return "done";
 *   }
 *
 *   @Handler()
 *   async verify(ctx: WorkflowSharedContext) {
 *     await ctx.promise<void>("verified").resolve();
 *   }
 * }
 * ```
 */
export const Workflow = (options: WorkflowOptions = {}): ClassDecorator =>
	componentDecorator("workflow", options);

/**
 * Exposes the method as a Restate handler.
 * The first parameter is the Restate context, the optional second parameter is the input.
 *
 * Pass `input`/`output` serdes to type-check the method signature against them.
 */
// biome-ignore lint/suspicious/noExplicitAny: untyped by default, narrowed by the serdes passed in
export const Handler = <I = any, O = any>(
	options: HandlerOptions<I, O> = {},
): HandlerDecorator<I, O> => handlerDecorator(false, options);

/**
 * Exposes the method as a shared Restate handler.
 * Only valid on `@VirtualObject()` and `@Workflow()` classes, with an
 * `ObjectSharedContext` or `WorkflowSharedContext` parameter.
 */
// biome-ignore lint/suspicious/noExplicitAny: untyped by default, narrowed by the serdes passed in
export const Shared = <I = any, O = any>(
	options: HandlerOptions<I, O> = {},
): SharedHandlerDecorator<I, O> => handlerDecorator(true, options);
