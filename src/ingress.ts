import type { Ingress } from "@restatedev/restate-sdk-clients";

/**
 * The Restate ingress client, connected with the `ingress` module options.
 *
 * @example
 * ```ts
 * @Controller()
 * export class SignupController {
 *   constructor(private readonly restate: RestateIngress) {}
 *
 *   @Post("signup")
 *   signup(@Body() body: { email: string }) {
 *     return this.restate.workflowClient(ref(Signup), body.email).workflowSubmit(body);
 *   }
 * }
 * ```
 */
export type RestateIngress = Ingress;
export const RestateIngress =
	class RestateIngress {} as unknown as abstract new () => Ingress;
