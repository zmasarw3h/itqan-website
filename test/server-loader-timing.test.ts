import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createServerLoaderTiming,
  measureServerLoaderPhase,
  recordServerLoaderTiming
} from "@/lib/server-loader-timing";

describe("server loader timing", () => {
  it("records only static phase names and rounded durations", async () => {
    const timing = createServerLoaderTiming();
    const log = vi.fn();

    await measureServerLoaderPhase(timing, "auth", async () => "authorized");
    await measureServerLoaderPhase(timing, "aggregation", async () => 42);
    recordServerLoaderTiming("admin_dashboard", timing, log);

    const payload = JSON.parse(log.mock.calls[0][0] as string) as {
      event: string;
      loader: string;
      phases: Record<string, unknown>;
    };

    expect(payload).toEqual({
      event: "server_loader_timing",
      loader: "admin_dashboard",
      phases: {
        auth_ms: expect.any(Number),
        week_discovery_ms: null,
        aggregation_ms: expect.any(Number),
        scope_ms: null,
        shell_ms: null,
        view_data_ms: null
      }
    });
    expect(JSON.stringify(payload)).not.toMatch(/student|phone|email|token|user.?id/i);
  });
});
