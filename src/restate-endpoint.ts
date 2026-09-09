import http2, { type Http2Server, type ServerHttp2Session } from "node:http2";
import {
	Inject,
	Injectable,
	Logger,
	type OnApplicationBootstrap,
	type OnModuleDestroy,
	type Type,
} from "@nestjs/common";
import { DiscoveryService, MetadataScanner } from "@nestjs/core";
import { createEndpointHandler } from "@restatedev/restate-sdk";
import { type RestateDefinition, createDefinition } from "./definition.ts";
import { nestLoggerTransport } from "./logger.ts";
import { getServiceMetadata } from "./ref.ts";
import {
	MODULE_OPTIONS_TOKEN,
	type RestateModuleOptions,
} from "./restate-module-definition.ts";

/**
 * Serves every `@Service()`, `@VirtualObject()` and `@Workflow()` provider over HTTP/2
 * once the application has bootstrapped, and stops serving when it shuts down.
 */
@Injectable()
export class RestateEndpoint
	implements OnApplicationBootstrap, OnModuleDestroy
{
	private readonly logger = new Logger(RestateEndpoint.name);
	private readonly sessions = new Set<ServerHttp2Session>();
	private server?: Http2Server;

	constructor(
		@Inject(MODULE_OPTIONS_TOKEN)
		private readonly options: RestateModuleOptions,
		@Inject(DiscoveryService)
		private readonly discoveryService: DiscoveryService,
		@Inject(MetadataScanner)
		private readonly metadataScanner: MetadataScanner,
	) {}

	/**
	 * The port the endpoint is listening on, or `undefined` before bootstrap.
	 */
	get port(): number | undefined {
		const address = this.server?.address();
		if (!address || typeof address === "string") return undefined;
		return address.port;
	}

	/**
	 * The Restate SDK definitions built from the discovered providers.
	 */
	getDefinitions(): RestateDefinition[] {
		const definitions = new Map<string, RestateDefinition>();

		for (const wrapper of this.discoveryService.getProviders()) {
			const target = wrapper.instance?.constructor as Type | undefined;
			if (!target || !getServiceMetadata(target)) continue;

			if (!wrapper.isDependencyTreeStatic()) {
				throw new Error(
					`${target.name} must be a singleton: Restate classes can't be request or transient scoped, nor depend on providers that are.`,
				);
			}

			const definition = createDefinition(
				wrapper.instance,
				this.metadataScanner,
			);
			if (definitions.has(definition.name)) {
				throw new Error(
					`Restate service "${definition.name}" is registered more than once. Provide ${target.name} in a single module or give each class a unique name.`,
				);
			}
			definitions.set(definition.name, definition);
		}

		return [...definitions.values()];
	}

	async onApplicationBootstrap(): Promise<void> {
		const { port = 9080, ingress: _ingress, ...endpointOptions } = this.options;
		const services = this.getDefinitions();
		const handler = createEndpointHandler({
			logger: nestLoggerTransport(),
			...endpointOptions,
			services,
		});

		const server = http2.createServer(handler);
		server.on("session", (session) => {
			this.sessions.add(session);
			session.once("close", () => this.sessions.delete(session));
		});

		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(port, () => {
				server.off("error", reject);
				resolve();
			});
		});
		this.server = server;

		if (services.length === 0) {
			this.logger.warn(
				`No @Service(), @VirtualObject() or @Workflow() providers found, serving an empty endpoint on port ${this.port}`,
			);
			return;
		}
		this.logger.log(
			`Serving ${services.map((service) => service.name).join(", ")} on port ${this.port}`,
		);
	}

	async onModuleDestroy(): Promise<void> {
		const server = this.server;
		if (!server) return;
		this.server = undefined;

		const closed = new Promise<void>((resolve) =>
			server.close(() => resolve()),
		);
		for (const session of this.sessions) session.close();
		await closed;
	}
}
