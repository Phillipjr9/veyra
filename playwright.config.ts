import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.env.E2E_PORT || 8877);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  // Keep screenshots/traces and the disposable database out of the checkout.
  outputDir: process.env.E2E_ARTIFACT_DIR || join(tmpdir(), "veyra-e2e-results"),
  use: {
    baseURL,
    browserName: "chromium",
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    },
  },
  webServer: {
    command: "node --import tsx scripts/e2e-server.ts",
    url: `${baseURL}/__e2e/ready`,
    timeout: 90_000,
    reuseExistingServer: false,
    env: { PORT: String(port), NODE_ENV: "development" },
  },
});
