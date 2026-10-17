import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/test/**/*.test.ts", "apps/bot/test/**/*.test.ts", "apps/analyst/test/**/*.test.ts"],
  },
});
