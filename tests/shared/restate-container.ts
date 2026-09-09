import {
	GenericContainer,
	type StartedTestContainer,
	Wait,
} from "testcontainers";

export type RestateContainer = {
	ingressUrl: string;
	adminUrl: string;
	/**
	 * Registers the endpoint listening on `port` on this host as a deployment.
	 */
	register(port: number): Promise<void>;
	stop(): Promise<void>;
};

export async function startRestate(): Promise<RestateContainer> {
	const container: StartedTestContainer = await new GenericContainer(
		"docker.restate.dev/restatedev/restate:latest",
	)
		.withExposedPorts(8080, 9070)
		.withExtraHosts([
			{ host: "host.docker.internal", ipAddress: "host-gateway" },
		])
		.withTmpFs({ "/restate-data": "rw" })
		.withWaitStrategy(
			Wait.forAll([
				Wait.forHttp("/restate/health", 8080),
				Wait.forHttp("/health", 9070),
			]),
		)
		.start();

	const host = container.getHost();
	const adminUrl = `http://${host}:${container.getMappedPort(9070)}`;

	return {
		ingressUrl: `http://${host}:${container.getMappedPort(8080)}`,
		adminUrl,
		async register(port) {
			const response = await fetch(`${adminUrl}/deployments`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ uri: `http://host.docker.internal:${port}` }),
			});
			if (!response.ok) {
				throw new Error(
					`Deployment registration failed: ${response.status} ${await response.text()}`,
				);
			}
		},
		stop: () => container.stop().then(() => undefined),
	};
}
