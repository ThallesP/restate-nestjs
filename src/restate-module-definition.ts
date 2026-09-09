import { ConfigurableModuleBuilder } from "@nestjs/common";
import type { EndpointOptions } from "@restatedev/restate-sdk";
import type { ConnectionOpts } from "@restatedev/restate-sdk-clients";

export type RestateModuleOptions = Omit<EndpointOptions, "services"> & {
	/**
	 * Port the Restate endpoint listens on.
	 * @default 9080
	 */
	port?: number;
	/**
	 * Connection options for the `RestateIngress` client.
	 * @default { url: "http://localhost:8080" }
	 */
	ingress?: ConnectionOpts;
};

export const MODULE_OPTIONS_TOKEN = Symbol("RESTATE_MODULE_OPTIONS");

export const { ConfigurableModuleClass, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } =
	new ConfigurableModuleBuilder<RestateModuleOptions>({
		optionsInjectionToken: MODULE_OPTIONS_TOKEN,
	})
		.setClassMethodName("forRoot")
		.setExtras({ isGlobal: true }, (definition, extras) => ({
			...definition,
			global: extras.isGlobal,
		}))
		.build();
