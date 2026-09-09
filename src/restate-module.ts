import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { connect } from "@restatedev/restate-sdk-clients";
import { RestateIngress } from "./ingress.ts";
import { RestateEndpoint } from "./restate-endpoint.ts";
import {
	ConfigurableModuleClass,
	MODULE_OPTIONS_TOKEN,
	type RestateModuleOptions,
} from "./restate-module-definition.ts";

/**
 * Serves the Restate classes registered as providers anywhere in the application.
 *
 * @example
 * ```ts
 * @Module({
 *   imports: [RestateModule.forRoot({ port: 9080 })],
 *   providers: [Greeter],
 * })
 * export class AppModule {}
 * ```
 */
@Module({
	imports: [DiscoveryModule],
	providers: [
		RestateEndpoint,
		{
			provide: RestateIngress,
			inject: [MODULE_OPTIONS_TOKEN],
			useFactory: (options: RestateModuleOptions) =>
				connect(options.ingress ?? { url: "http://localhost:8080" }),
		},
	],
	exports: [RestateEndpoint, RestateIngress],
})
export class RestateModule extends ConfigurableModuleClass {}
