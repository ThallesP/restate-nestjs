import "reflect-metadata";
import { Injectable, Module, type Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type {
	Context,
	ObjectContext,
	ObjectSharedContext,
	WorkflowContext,
	WorkflowSharedContext,
} from "@restatedev/restate-sdk";
import {
	Handler,
	RestateEndpoint,
	RestateModule,
	type RestateModuleOptions,
	Service,
	Shared,
	VirtualObject,
	Workflow,
	ref,
} from "../../src/index.ts";

@Injectable()
export class Greetings {
	greet(name: string) {
		return `Hello ${name}`;
	}
}

@Service()
export class Greeter {
	constructor(private readonly greetings: Greetings) {}

	@Handler()
	async greet(_ctx: Context, name: string) {
		return this.greetings.greet(name);
	}

	@Handler()
	async ping(_ctx: Context) {
		return "pong";
	}

	notAHandler() {
		return "hidden";
	}
}

@Service({ name: "custom-name", description: "A service with a custom name" })
export class Renamed {
	@Handler({ description: "Says hi" })
	async hi(_ctx: Context) {
		return "hi";
	}
}

@Service()
export class Caller {
	@Handler()
	async greetVia(ctx: Context, name: string) {
		return ctx.serviceClient(ref(Greeter)).greet(name);
	}

	@Handler()
	async countVia(ctx: Context, key: string) {
		await ctx.objectClient(ref(Counter), key).add(5);
		return ctx.objectClient(ref(Counter), key).get();
	}
}

@VirtualObject()
export class Counter {
	@Handler()
	async add(ctx: ObjectContext, amount: number) {
		const count = ((await ctx.get<number>("count")) ?? 0) + amount;
		ctx.set("count", count);
		return count;
	}

	@Shared()
	async get(ctx: ObjectSharedContext) {
		return (await ctx.get<number>("count")) ?? 0;
	}
}

@Workflow()
export class Signup {
	@Handler()
	async run(ctx: WorkflowContext, user: { email: string }) {
		const code = await ctx.promise<string>("verified");
		return `${user.email} verified with ${code}`;
	}

	@Handler()
	async verify(ctx: WorkflowSharedContext, code: string) {
		await ctx.promise<string>("verified").resolve(code);
	}
}

export const testProviders = [
	Greetings,
	Greeter,
	Renamed,
	Caller,
	Counter,
	Signup,
];

export async function createTestApp(
	options: RestateModuleOptions,
	providers: Type[] = testProviders,
) {
	@Module({
		imports: [RestateModule.forRoot({ port: 0, ...options })],
		providers,
	})
	class AppModule {}

	const app = await NestFactory.createApplicationContext(AppModule, {
		logger: false,
		abortOnError: false,
	});
	await app.init();
	return { app, endpoint: app.get(RestateEndpoint) };
}
