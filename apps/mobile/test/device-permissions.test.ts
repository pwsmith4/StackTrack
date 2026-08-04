import { describe, expect, it } from "vitest";
import { canUseDevicePermission, resolveDevicePermissions } from "../src/device-permissions.js";

describe("device permission bootstrap", () => {
  it("preserves only named keys returned by an enforced role", () => {
    const state = resolveDevicePermissions({
      enforced: true,
      permissionKeys: ["observation.create", "unknown.permission"],
      resolvedAt: "2026-08-03T12:00:00.000Z"
    });

    expect(state).toMatchObject({ mode: "enforced", permissionKeys: ["observation.create"] });
    expect(canUseDevicePermission(state, "observation.create")).toBe(true);
    expect(canUseDevicePermission(state, "load_code.lookup")).toBe(false);
  });

  it("keeps local compatibility fixtures usable without inventing grants", () => {
    const state = resolveDevicePermissions({ enforced: false, permissionKeys: [] });
    expect(state.mode).toBe("compatibility");
    expect(canUseDevicePermission(state, "observation.create")).toBe(true);
  });

  it("fails closed for an unreadable response", () => {
    const state = resolveDevicePermissions(null);
    expect(state.mode).toBe("unavailable");
    expect(canUseDevicePermission(state, "observation.create")).toBe(false);
  });

  it("keeps assignment metadata with the resolved role", () => {
    const state = resolveDevicePermissions({
      enforced: true,
      permissionKeys: ["observation.create"],
      assignedLocationId: "66666666-6666-4666-8666-666666666666",
      isActive: true,
      deviceLabel: "Scanner 1"
    });
    expect(state).toMatchObject({
      assignedLocationId: "66666666-6666-4666-8666-666666666666",
      isActive: true,
      deviceLabel: "Scanner 1"
    });
  });
});
