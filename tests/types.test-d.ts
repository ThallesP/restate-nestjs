import type {
	Context,
	ObjectContext,
	ObjectSharedContext,
	Serde,
	ServiceDefinition,
	VirtualObjectDefinition,
	WorkflowContext,
	WorkflowDefinition,
	WorkflowSharedContext,
} from "@restatedev/restate-sdk";
import { serde } from "@restatedev/restate-sdk";
import type { Ingress } from "@restatedev/restate-sdk-clients";
import {
	Handler,
	type Ref,
	Service,
	Shared,
	VirtualObject,
	Workflow,
	ref,
} from "../src/index.ts";

declare const ctx: Context;
declare const ingress: Ingress;
declare const greetingSerde: Serde<{ name: string }>;

@Service()
class Greeter {
	constructor(private readonly dep: number) {}

	@Handler()
	async greet(_ctx: Context, name: string): Promise<string> {
		return `${name}${this.dep}`;
	}

	@Handler()
	async ping(_ctx: Context): Promise<number> {
		return 1;
	}

	@Handler({ input: greetingSerde, output: serde.json })
	async typed(_ctx: Context, greeting: { name: string }): Promise<string> {
		return greeting.name;
	}

	@Handler({ input: serde.empty })
	async typedNoInput(_ctx: Context): Promise<string> {
		return "";
	}

	// @ts-expect-error input serde does not match the parameter
	@Handler({ input: greetingSerde })
	async badInput(_ctx: Context, _n: number): Promise<string> {
		return "";
	}

	// @ts-expect-error output serde does not match the return type
	@Handler({ output: greetingSerde })
	async badOutput(_ctx: Context): Promise<string> {
		return "";
	}

	// @ts-expect-error handlers must be async
	@Handler()
	sync(_ctx: Context): number {
		return 1;
	}

	// @ts-expect-error the first parameter must be a Restate context
	@Handler()
	async noContext(): Promise<void> {}

	// @ts-expect-error the first parameter must be a Restate context
	@Handler()
	async wrongContext(_ctx: string): Promise<void> {}

	@Handler()
	async partialContext(_ctx: Pick<Context, "run">): Promise<void> {}

	onModuleInit() {}

	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: asserts private methods are hidden from clients
	private helper(_ctx: Context) {}
}

@VirtualObject()
class Counter {
	@Handler()
	async add(
		_ctx: ObjectContext<{ count: number }>,
		amount: number,
	): Promise<number> {
		return amount;
	}

	@Shared()
	async get(_ctx: ObjectSharedContext): Promise<number> {
		return 0;
	}

	// @ts-expect-error shared handlers get a shared context
	@Shared()
	async exclusiveShared(_ctx: ObjectContext): Promise<number> {
		return 0;
	}

	// @ts-expect-error shared handlers get a shared context
	@Shared()
	async optionalExclusive(_ctx?: ObjectContext): Promise<number> {
		return 0;
	}

	// @ts-expect-error shared handlers get a shared context
	@Shared()
	async needsSet(
		_ctx: ObjectSharedContext & Pick<ObjectContext, "set">,
	): Promise<number> {
		return 0;
	}
}

@Workflow()
class Signup {
	@Handler()
	async run(
		_ctx: WorkflowContext<{ step: string }>,
		user: { email: string },
	): Promise<boolean> {
		return !!user;
	}

	@Handler()
	async status(_ctx: WorkflowSharedContext): Promise<string> {
		return "";
	}

	@Shared()
	async sharedStatus(_ctx: WorkflowSharedContext): Promise<string> {
		return "";
	}

	// @ts-expect-error shared handlers get a shared context
	@Shared()
	async exclusiveShared(_ctx: WorkflowContext): Promise<string> {
		return "";
	}
}

describe("types", () => {
	it("infers the definition kind from the handlers' context", () => {
		expectTypeOf(ref(Greeter)).toEqualTypeOf<
			ServiceDefinition<
				string,
				Ref<Greeter> extends ServiceDefinition<string, infer M> ? M : never
			>
		>();
		expectTypeOf(ref(Counter)).toMatchTypeOf<
			VirtualObjectDefinition<string, unknown>
		>();
		expectTypeOf(ref(Signup)).toMatchTypeOf<
			WorkflowDefinition<string, unknown>
		>();
	});

	it("types context clients", () => {
		expectTypeOf(
			ctx.serviceClient(ref(Greeter)).greet("x"),
		).resolves.toBeString();
		expectTypeOf(ctx.serviceClient(ref(Greeter)).ping()).resolves.toBeNumber();
		expectTypeOf(
			ctx.objectClient(ref(Counter), "k").add(1),
		).resolves.toBeNumber();
		expectTypeOf(
			ctx.objectClient(ref(Counter), "k").get(),
		).resolves.toBeNumber();
		expectTypeOf(
			ctx.workflowClient(ref(Signup), "k").run({ email: "" }),
		).resolves.toBeBoolean();
		expectTypeOf(
			ctx.workflowClient(ref(Signup), "k").status(),
		).resolves.toBeString();
		ctx.serviceSendClient(ref(Greeter)).greet("x");
		ctx.objectSendClient(ref(Counter), "k").add(1);
		ctx.workflowSendClient(ref(Signup), "k").run({ email: "" });

		// @ts-expect-error wrong input type
		ctx.serviceClient(ref(Greeter)).greet(1);
		// @ts-expect-error not a handler
		ctx.serviceClient(ref(Greeter)).onModuleInit;
		// @ts-expect-error private
		ctx.serviceClient(ref(Greeter)).helper;
		// @ts-expect-error a virtual object ref has no service handlers
		ctx.serviceClient(ref(Counter)).add(1);
		// @ts-expect-error a service ref has no virtual object handlers
		ctx.objectClient(ref(Greeter), "k").greet("x");
	});

	it("types ingress clients", () => {
		expectTypeOf(
			ingress.serviceClient(ref(Greeter)).greet("x"),
		).resolves.toBeString();
		expectTypeOf(
			ingress.objectClient(ref(Counter), "k").get(),
		).resolves.toBeNumber();
		expectTypeOf(
			ingress.workflowClient(ref(Signup), "k").status(),
		).resolves.toBeString();
		ingress.workflowClient(ref(Signup), "k").workflowSubmit({ email: "" });
	});
});
