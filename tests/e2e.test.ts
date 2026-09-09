import type { INestApplicationContext } from "@nestjs/common";
import { RestateIngress, ref } from "../src/index.ts";
import {
	type RestateContainer,
	startRestate,
} from "./shared/restate-container.ts";
import {
	Caller,
	Counter,
	Greeter,
	Renamed,
	Signup,
	createTestApp,
} from "./shared/test-app.ts";

describe("e2e", () => {
	let restate: RestateContainer;
	let app: INestApplicationContext;
	let ingress: RestateIngress;

	beforeAll(async () => {
		restate = await startRestate();
		const created = await createTestApp({
			ingress: { url: restate.ingressUrl },
		});
		app = created.app;
		await restate.register(created.endpoint.port as number);
		ingress = app.get(RestateIngress);
	});

	afterAll(async () => {
		await app?.close();
		await restate?.stop();
	});

	it("invokes a service handler with injected dependencies", async () => {
		await expect(
			ingress.serviceClient(ref(Greeter)).greet("world"),
		).resolves.toBe("Hello world");
	});

	it("invokes a handler without input", async () => {
		await expect(ingress.serviceClient(ref(Greeter)).ping()).resolves.toBe(
			"pong",
		);
	});

	it("uses the custom service name", async () => {
		await expect(ingress.serviceClient(ref(Renamed)).hi()).resolves.toBe("hi");
		expect(ref(Renamed).name).toBe("custom-name");
	});

	it("does not expose undecorated methods", async () => {
		const response = await fetch(`${restate.ingressUrl}/Greeter/notAHandler`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		expect(response.status).toBe(404);
	});

	it("calls other services through ref()", async () => {
		await expect(
			ingress.serviceClient(ref(Caller)).greetVia("nest"),
		).resolves.toBe("Hello nest");
	});

	it("keeps virtual object state per key", async () => {
		await expect(ingress.objectClient(ref(Counter), "a").add(2)).resolves.toBe(
			2,
		);
		await expect(ingress.objectClient(ref(Counter), "a").add(3)).resolves.toBe(
			5,
		);
		await expect(ingress.objectClient(ref(Counter), "a").get()).resolves.toBe(
			5,
		);
		await expect(ingress.objectClient(ref(Counter), "b").get()).resolves.toBe(
			0,
		);
	});

	it("calls virtual objects from a service through ref()", async () => {
		await expect(
			ingress.serviceClient(ref(Caller)).countVia("c"),
		).resolves.toBe(5);
	});

	it("runs a workflow with shared handlers", async () => {
		const workflow = ingress.workflowClient(ref(Signup), "signup-1");
		await workflow.workflowSubmit({ email: "a@b.c" });
		await workflow.verify("1234");
		await expect(workflow.workflowAttach()).resolves.toBe(
			"a@b.c verified with 1234",
		);
	});
});
