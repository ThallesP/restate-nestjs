import type { Type } from "@nestjs/common";
import type {
	Context,
	ObjectSharedContext,
	ServiceDefinition,
	VirtualObjectDefinition,
	WorkflowDefinition,
	WorkflowSharedContext,
} from "@restatedev/restate-sdk";
import type { ServiceMetadata } from "./decorators.ts";
import { RESTATE_SERVICE_KEY } from "./symbols.ts";

/**
 * Only the methods of `T` that look like Restate handlers: `(ctx, input?) => Promise`.
 */
export type Handlers<T> = {
	[K in keyof T as T[K] extends (
		ctx: infer C,
		...args: never[]
	) => Promise<unknown>
		? C extends Context
			? K
			: never
		: never]: T[K];
};

// biome-ignore lint/suspicious/noExplicitAny: matches contexts with any typed state
type AnyState = any;

type ContextKind<C> =
	C extends WorkflowSharedContext<AnyState>
		? "workflow"
		: C extends ObjectSharedContext<AnyState>
			? "object"
			: "service";

type HandlerKinds<T> = {
	[K in keyof Handlers<T>]: Handlers<T>[K] extends (
		ctx: infer C,
		...args: never[]
	) => unknown
		? ContextKind<C>
		: never;
}[keyof Handlers<T>];

type Kind<T> =
	"workflow" extends HandlerKinds<T>
		? "workflow"
		: "object" extends HandlerKinds<T>
			? "object"
			: "service";

/**
 * Typed Restate definition for a decorated class, inferred from its handlers' context type:
 * `WorkflowContext` handlers make a `WorkflowDefinition`, `ObjectContext` handlers a
 * `VirtualObjectDefinition`, plain `Context` handlers a `ServiceDefinition`.
 */
export type Ref<T> =
	Kind<T> extends "workflow"
		? WorkflowDefinition<string, Handlers<T>>
		: Kind<T> extends "object"
			? VirtualObjectDefinition<string, Handlers<T>>
			: ServiceDefinition<string, Handlers<T>>;

export function getServiceMetadata(target: Type): ServiceMetadata | undefined {
	return Reflect.getMetadata(RESTATE_SERVICE_KEY, target);
}

export function getServiceName(target: Type): string | undefined {
	const metadata = getServiceMetadata(target);
	if (!metadata) return undefined;
	return metadata.name ?? target.name;
}

/**
 * Typed reference to a decorated class, for use with the SDK clients.
 *
 * @example
 * ```ts
 * const greeting = await ctx.serviceClient(ref(Greeter)).greet("world");
 * const count = await ctx.objectClient(ref(Counter), "my-key").get();
 * ctx.workflowSendClient(ref(Signup), userId).run({ email });
 * ```
 */
export function ref<T>(target: Type<T>): Ref<T> {
	const name = getServiceName(target);
	if (!name) {
		throw new Error(
			`${target.name} is not a Restate class. Decorate it with @Service(), @VirtualObject() or @Workflow().`,
		);
	}
	return { name } as Ref<T>;
}
