import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		testTimeout: 120_000,
		hookTimeout: 180_000,
		fileParallelism: false,
		typecheck: {
			enabled: true,
		},
	},
	plugins: [
		swc.vite({
			module: { type: "es6" },
		}),
	],
});
