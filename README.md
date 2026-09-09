# NestJS Restate Integration

A NestJS integration for [Restate](https://restate.dev/): write Restate Services, Virtual Objects and Workflows as plain NestJS providers, with decorators, dependency injection and typed cross-service calls.

This library only wraps the official `@restatedev/restate-sdk`. The SDK is a peer dependency, so you pick the SDK version and keep using its APIs (`Context`, `ctx.run`, `serde`, `TerminalError`, ...) directly.

## Installation

```bash
# Using npm
npm install @thallesp/nestjs-restate @restatedev/restate-sdk @restatedev/restate-sdk-clients

# Using yarn
yarn add @thallesp/nestjs-restate @restatedev/restate-sdk @restatedev/restate-sdk-clients

# Using pnpm
pnpm add @thallesp/nestjs-restate @restatedev/restate-sdk @restatedev/restate-sdk-clients

# Using bun
bun add @thallesp/nestjs-restate @restatedev/restate-sdk @restatedev/restate-sdk-clients
```

## Prerequisites

- A NestJS 11 or 12 application
- `@restatedev/restate-sdk` and `@restatedev/restate-sdk-clients` >= 1.8.0
- A running [Restate server](https://docs.restate.dev/develop/local_dev)

## Basic Setup

**1. Import RestateModule**

```ts title="app.module.ts"
import { Module } from "@nestjs/common";
import { RestateModule } from "@thallesp/nestjs-restate";
import { Greeter } from "./greeter";

@Module({
  imports: [
    RestateModule.forRoot({
      port: 9080, // where Restate reaches this app
      ingress: { url: "http://localhost:8080" }, // where this app reaches Restate
    }),
  ],
  providers: [Greeter],
})
export class AppModule {}
```

**2. Write a service**

```ts title="greeter.ts"
import type { Context } from "@restatedev/restate-sdk";
import { Handler, Service } from "@thallesp/nestjs-restate";
import { GreetingsService } from "./greetings.service";

@Service()
export class Greeter {
  constructor(private readonly greetings: GreetingsService) {}

  @Handler()
  async greet(ctx: Context, name: string) {
    const greeting = await ctx.run("pick greeting", () => this.greetings.pick());
    return `${greeting} ${name}`;
  }
}
```

**3. Register the deployment**

Once the app is up, tell Restate where it lives:

```bash
restate deployments register http://localhost:9080
```

The endpoint is served on its own HTTP/2 port and does not touch your HTTP adapter, so it works the same with Express, Fastify or a bare `NestFactory.createApplicationContext`.

> [!NOTE]
> Restate classes are discovered from every module in the application, so provide them wherever they fit in your module tree. They must be singletons: request or transient scope (directly or through a dependency) is rejected at startup.

## Decorators

### `@Service()`

Registers the class as a Restate Service. Every `@Handler()` method becomes a handler.

```ts
@Service({ name: "greeter", description: "Says hello" })
export class Greeter {
  @Handler()
  async greet(ctx: Context, name: string) {
    return `Hello ${name}`;
  }
}
```

Options are the SDK's `ServiceOptions` plus:

| Option | Description |
| --- | --- |
| `name` | Name registered in Restate. Defaults to the class name. |
| `description` | Shown in the Restate UI and CLI. |
| `metadata` | Free-form metadata for discovery. |

### `@VirtualObject()`

Registers the class as a Virtual Object. `@Handler()` methods are exclusive, `@Shared()` methods run concurrently and can only read state.

```ts
import type { ObjectContext, ObjectSharedContext } from "@restatedev/restate-sdk";

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
```

Options are the SDK's `ObjectOptions` plus `name`, `description` and `metadata`.

### `@Workflow()`

Registers the class as a Workflow. The `run` handler is the workflow itself, every other `@Handler()` is a shared handler that can signal it.

```ts
import type { WorkflowContext, WorkflowSharedContext } from "@restatedev/restate-sdk";

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
```

Options are the SDK's `WorkflowOptions` plus `name`, `description` and `metadata`.

### `@Handler()` and `@Shared()`

Mark a method as a handler. The first parameter is the Restate context, the optional second parameter is the input. Methods without the decorator are not exposed.

Both accept the SDK's per-handler options. Passing `input` or `output` serdes also type-checks the method signature against them:

```ts
import { serde } from "@restatedev/restate-sdk";
import { z } from "zod";

const Greeting = z.object({ name: z.string() });

@Service()
export class Greeter {
  @Handler({ input: serde.schema(Greeting), description: "Says hello" })
  async greet(ctx: Context, greeting: z.infer<typeof Greeting>) {
    return `Hello ${greeting.name}`;
  }
}
```

## Calling other services

`ref()` turns a decorated class into the typed definition the SDK clients expect. The definition kind is inferred from the handlers' context type, so `ctx.serviceClient(ref(Counter))` is a type error.

```ts
import { ref } from "@thallesp/nestjs-restate";

@Service()
export class Checkout {
  @Handler()
  async place(ctx: Context, order: Order) {
    const total = await ctx.objectClient(ref(Cart), order.cartId).total();
    ctx.workflowSendClient(ref(Fulfillment), order.id).run(order);
    await ctx.serviceClient(ref(Greeter)).greet(order.customer);
    return total;
  }
}
```

Only handler-shaped methods (`(ctx, input?) => Promise`) show up on the client. Constructor dependencies, lifecycle hooks and helpers are hidden.

## Calling from outside Restate

`RestateIngress` is the SDK's ingress client, connected with the `ingress` module option. Inject it anywhere:

```ts
import { RestateIngress, ref } from "@thallesp/nestjs-restate";

@Controller("signup")
export class SignupController {
  constructor(private readonly restate: RestateIngress) {}

  @Post()
  async signup(@Body() body: { email: string }) {
    await this.restate.workflowClient(ref(Signup), body.email).workflowSubmit(body);
  }

  @Post(":email/verify")
  verify(@Param("email") email: string, @Body("code") code: string) {
    return this.restate.workflowClient(ref(Signup), email).verify(code);
  }
}
```

## Module Options

```ts
RestateModule.forRoot({
  port: 9080,
  ingress: { url: "http://localhost:8080", headers: { authorization: "Bearer ..." } },
  identityKeys: ["publickeyv1_..."],
  defaultServiceOptions: { journalRetention: { days: 1 } },
  logger: nestLoggerTransport(new Logger("Restate")),
});
```

| Option | Description |
| --- | --- |
| `port` | Port the Restate endpoint listens on. Defaults to `9080`. |
| `ingress` | `ConnectionOpts` for `RestateIngress`. Defaults to `{ url: "http://localhost:8080" }`. |
| `identityKeys` | Restate request identity public keys, same as the SDK's `identityKeys`. |
| `defaultServiceOptions` | Options applied to every service, overridable per class and handler. |
| `logger` | SDK `LoggerTransport`. Defaults to `nestLoggerTransport()`, which writes through the NestJS `Logger`. |
| `journalValueCodecProvider` | Same as the SDK option. |
| `isGlobal` | Register the module globally. Defaults to `true`. |

`forRootAsync` is supported with `useFactory`, `useClass` and `useExisting`:

```ts
RestateModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    port: config.get("RESTATE_PORT"),
    ingress: { url: config.get("RESTATE_INGRESS_URL") },
  }),
});
```

## RestateEndpoint

The provider that serves the endpoint is exported as `RestateEndpoint`:

| Member | Description |
| --- | --- |
| `port` | The bound port, or `undefined` before bootstrap. Useful with `port: 0` in tests. |
| `getDefinitions()` | The SDK definitions built from the discovered classes, for example to pass to `RestateTestEnvironment`. |

The server starts on `onApplicationBootstrap` and stops on `onModuleDestroy`, so `app.close()` and `enableShutdownHooks()` behave as expected.

## Testing

Restate classes are regular providers. For unit tests, instantiate them and pass a fake context. For integration tests, the SDK's `@restatedev/restate-sdk-testcontainers` can serve `endpoint.getDefinitions()`, or start the Restate container yourself and register `http://host.docker.internal:${endpoint.port}` like this repository's `tests/e2e.test.ts` does.
