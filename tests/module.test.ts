import http2 from "node:http2";
import { Injectable, Module, Scope } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Context, ObjectSharedContext } from "@restatedev/restate-sdk";
import {
	Handler,
	RestateEndpoint,
	RestateIngress,
	RestateModule,
	Service,
	Shared,
	Workflow,
	ref,
} from "../src/index.ts";
import {
	Counter,
	Greeter,
	Greetings,
	Renamed,
	Signup,
	createTestApp,
	testProviders,
} from "./shared/test-app.ts";

type Manifest = {
	protocolMode: string;
	services: Array<{
		name: string;
		ty: string;
		documentation?: string;
		handlers: Array<{ name: string; ty?: string; documentation?: string }>;
	}>;
};

function discover(port: number): Promise<Manifest> {
	return new Promise((resolve, reject) => {
		const client = http2.connect(`http://localhost:${port}`);
		client.once("error", reject);
		const request = client.request({
			":method": "GET",
			":path": "/discover",
			accept: "application/vnd.restate.endpointmanifest.v3+json",
		});
		request.once("error", reject);
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.once("end", () => {
			client.close();
			resolve(JSON.parse(Buffer.concat(chunks).toString()));
		});
		request.end();
	});
}

describe("RestateModule", () => {
	it("serves the discovered classes on the configured port", async () => {
		const { app, endpoint } = await createTestApp({});
		const manifest = await discover(endpoint.port as number);
		await app.close();

		expect(manifest.protocolMode).toBe("BIDI_STREAM");
		expect(
			manifest.services.map((service) => [service.name, service.ty]),
		).toEqual([
			["Greeter", "SERVICE"],
			["custom-name", "SERVICE"],
			["Caller", "SERVICE"],
			["Counter", "VIRTUAL_OBJECT"],
			["Signup", "WORKFLOW"],
		]);
	});

	it("passes class and handler options through to the SDK", async () => {
		const { app, endpoint } = await createTestApp({});
		const manifest = await discover(endpoint.port as number);
		await app.close();

		const renamed = manifest.services.find(
			(service) => service.name === "custom-name",
		);
		expect(renamed?.documentation).toBe("A service with a custom name");
		expect(renamed?.handlers).toMatchObject([
			{ name: "hi", documentation: "Says hi" },
		]);

		const greeter = manifest.services.find(
			(service) => service.name === "Greeter",
		);
		expect(greeter?.handlers.map((handler) => handler.name)).toEqual([
			"greet",
			"ping",
			"greetSelf",
		]);

		const counter = manifest.services.find(
			(service) => service.name === "Counter",
		);
		expect(
			counter?.handlers.map((handler) => [handler.name, handler.ty]),
		).toEqual([
			["add", "EXCLUSIVE"],
			["get", "SHARED"],
		]);

		const signup = manifest.services.find(
			(service) => service.name === "Signup",
		);
		expect(
			signup?.handlers.map((handler) => [handler.name, handler.ty]),
		).toEqual([
			["run", "WORKFLOW"],
			["verify", "SHARED"],
		]);
	});

	it("stops listening when the app closes", async () => {
		const { app, endpoint } = await createTestApp({});
		const port = endpoint.port as number;
		await app.close();

		expect(endpoint.port).toBeUndefined();
		await expect(discover(port)).rejects.toThrow();
	});

	it("exposes the SDK definitions", async () => {
		const { app, endpoint } = await createTestApp({});
		const definitions = endpoint.getDefinitions();
		await app.close();

		expect(definitions.map((definition) => definition.name)).toEqual([
			"Greeter",
			"custom-name",
			"Caller",
			"Counter",
			"Signup",
		]);
	});

	it("provides the ingress client", async () => {
		const { app } = await createTestApp({
			ingress: { url: "http://restate:8080" },
		});
		const ingress = app.get(RestateIngress);
		await app.close();

		expect(ingress.serviceClient(ref(Greeter)).greet).toBeTypeOf("function");
	});

	it("supports forRootAsync", async () => {
		@Module({
			imports: [
				RestateModule.forRootAsync({
					useFactory: async () => ({ port: 0 }),
				}),
			],
			providers: testProviders,
		})
		class AppModule {}

		const app = await NestFactory.createApplicationContext(AppModule, {
			logger: false,
			abortOnError: false,
		});
		await app.init();
		expect(app.get(RestateEndpoint).port).toBeGreaterThan(0);
		await app.close();
	});

	it("ignores useExisting aliases of Restate classes", async () => {
		@Module({
			imports: [RestateModule.forRoot({ port: 0 })],
			providers: [
				Greetings,
				Greeter,
				{ provide: "GREETER_ALIAS", useExisting: Greeter },
			],
		})
		class AppModule {}

		const app = await NestFactory.createApplicationContext(AppModule, {
			logger: false,
			abortOnError: false,
		});
		await app.init();
		const names = app
			.get(RestateEndpoint)
			.getDefinitions()
			.map((definition) => definition.name);
		await app.close();

		expect(names).toEqual(["Greeter"]);
	});

	it("invokes methods replaced on the instance", async () => {
		@Service()
		class Wrapped {
			constructor() {
				const original = this.greet.bind(this);
				this.greet = async (ctx, name) =>
					`wrapped ${await original(ctx, name)}`;
			}

			@Handler()
			async greet(_ctx: Context, name: string) {
				return name;
			}
		}

		@Module({
			imports: [RestateModule.forRoot({ port: 0 })],
			providers: [Wrapped],
		})
		class AppModule {}

		const app = await NestFactory.createApplicationContext(AppModule, {
			logger: false,
			abortOnError: false,
		});
		await app.init();
		const [definition] = app
			.get(RestateEndpoint)
			.getDefinitions() as unknown as Array<{
			service: Record<string, (ctx: unknown, input: string) => Promise<string>>;
		}>;
		const result = await definition.service.greet({}, "x");
		await app.close();

		expect(result).toBe("wrapped x");
	});

	it("discovers classes provided in nested modules", async () => {
		@Module({ providers: [Counter] })
		class CounterModule {}

		@Module({
			imports: [RestateModule.forRoot({ port: 0 }), CounterModule],
			providers: [
				Greeter,
				...testProviders.filter(
					(provider) => provider !== Greeter && provider !== Counter,
				),
			],
		})
		class AppModule {}

		const app = await NestFactory.createApplicationContext(AppModule, {
			logger: false,
			abortOnError: false,
		});
		await app.init();
		const names = app
			.get(RestateEndpoint)
			.getDefinitions()
			.map((definition) => definition.name);
		await app.close();

		expect(names).toContain("Counter");
		expect(names).toContain("Greeter");
	});

	describe("validation", () => {
		async function expectInitError(
			providers: Parameters<typeof createTestApp>[1],
			message: string,
		) {
			await expect(createTestApp({}, providers)).rejects.toThrow(message);
		}

		it("rejects classes without handlers", async () => {
			@Service()
			class Empty {}

			await expectInitError([Empty], "Empty has no @Handler() methods.");
		});

		it("rejects @Shared() on services", async () => {
			@Service()
			class SharedService {
				@Shared()
				async get(_ctx: Context) {
					return 1;
				}
			}

			await expectInitError(
				[SharedService],
				"SharedService.get: @Shared() is only valid on @VirtualObject() and @Workflow() classes.",
			);
		});

		it("rejects workflows without run", async () => {
			@Workflow()
			class NoRun {
				@Handler()
				async status(_ctx: ObjectSharedContext) {
					return "";
				}
			}

			await expectInitError(
				[NoRun],
				'NoRun is a @Workflow() and must have a @Handler() method named "run".',
			);
		});

		it("rejects @Shared() on the workflow run handler", async () => {
			@Workflow()
			class SharedRun {
				@Shared()
				async run(_ctx: Context) {
					return "";
				}
			}

			await expectInitError(
				[SharedRun],
				"SharedRun.run: the workflow handler must use @Handler(), not @Shared().",
			);
		});

		it("rejects duplicate service names", async () => {
			@Service({ name: "Greeter" })
			class OtherGreeter {
				@Handler()
				async greet(_ctx: Context) {
					return "";
				}
			}

			await expectInitError(
				[Greetings, Greeter, OtherGreeter],
				'Restate service "Greeter" is registered more than once.',
			);
		});

		it("rejects request-scoped classes", async () => {
			@Injectable({ scope: Scope.REQUEST })
			class RequestScoped {}

			@Service()
			class UsesRequestScoped {
				constructor(readonly dep: RequestScoped) {}

				@Handler()
				async greet(_ctx: Context) {
					return "";
				}
			}

			await expectInitError(
				[RequestScoped, UsesRequestScoped],
				"UsesRequestScoped must be a singleton",
			);
		});

		it("rejects transient-scoped classes", async () => {
			@Injectable({ scope: Scope.TRANSIENT })
			@Service()
			class TransientService {
				@Handler()
				async greet(_ctx: Context) {
					return "";
				}
			}

			await expectInitError(
				[TransientService],
				"TransientService must be a singleton",
			);
		});

		it("rejects reserved workflow handler names", async () => {
			@Workflow()
			class Reserved {
				@Handler()
				async run(_ctx: Context) {
					return "";
				}

				@Handler()
				async workflowSubmit(_ctx: ObjectSharedContext) {
					return 1;
				}
			}

			await expectInitError(
				[Reserved],
				'Reserved.workflowSubmit: "workflowSubmit" is reserved by Restate workflows.',
			);
		});

		it("keeps the scope of an @Injectable() applied below the class decorator", async () => {
			@Service()
			@Injectable({ scope: Scope.REQUEST })
			class RequestScopedService {
				@Handler()
				async greet(_ctx: Context) {
					return "";
				}
			}

			await expectInitError(
				[RequestScopedService],
				"RequestScopedService must be a singleton",
			);
		});

		it("rejects ref() of undecorated classes", () => {
			class Plain {}
			expect(() => ref(Plain)).toThrow("Plain is not a Restate class.");
		});

		it("resolves ref() names", () => {
			expect(ref(Greeter).name).toBe("Greeter");
			expect(ref(Renamed).name).toBe("custom-name");
			expect(ref(Signup).name).toBe("Signup");
		});
	});
});
