import { beforeEach, describe, expect, it } from "vitest";
import { report, resetReportCount } from "./errors";
import { invoke } from "./test/tauri-mocks";

describe("report", () => {
  beforeEach(() => {
    resetReportCount();
    invoke.mockResolvedValue(undefined);
  });

  it("logs errors, strings and odd values without throwing", () => {
    report(new TypeError("bad"), "promise");
    report("plain text");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    report(circular, "uncaught");
    const messages = invoke.mock.calls.map((c) => (c[1] as { message: string }).message);
    expect(messages[0]).toMatch(/^promise: TypeError: bad/);
    expect(messages[1]).toBe("ui: plain text");
    expect(messages[2]).toBe("uncaught: (error that could not be described)");
  });

  it("stops after 50 reports in a session", () => {
    for (let i = 0; i < 60; i++) report(`e${String(i)}`);
    expect(invoke).toHaveBeenCalledTimes(50);
  });

  it("never throws when the log itself fails", () => {
    invoke.mockRejectedValue("disk full");
    expect(() => {
      report("x");
    }).not.toThrow();
  });
});
