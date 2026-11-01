import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { appWindow, invoke, listen } from "./tauri-mocks";

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => appWindow }));

afterEach(() => {
  cleanup();
  invoke.mockReset();
});
