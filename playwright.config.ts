import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./apps/e2e",
  timeout: 60_000,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
})
