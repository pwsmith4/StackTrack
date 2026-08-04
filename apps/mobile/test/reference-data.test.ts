import { describe, expect, it } from "vitest";
import { isDevicePermissionConfigurationMissing, isLocalPreviewApi, shouldClearCachedReferenceData, shouldRetainCachedDevicePermissions, shouldUseSyntheticReferenceData } from "../src/reference-data.js";

describe("reference data safety", () => {
  it("recognizes only loopback endpoints as local previews", () => {
    expect(isLocalPreviewApi("http://127.0.0.1:3000")).toBe(true);
    expect(isLocalPreviewApi("http://localhost:3000/api")).toBe(true);
    expect(isLocalPreviewApi("https://stacktrack-api-test.example.com")).toBe(false);
  });

  it("does not substitute synthetic fixtures after a cloud response or when a cache exists", () => {
    expect(shouldUseSyntheticReferenceData({ apiUrl: "https://stacktrack-api-test.example.com", controlPlaneResponded: false, hasCachedReferenceData: false })).toBe(false);
    expect(shouldUseSyntheticReferenceData({ apiUrl: "http://127.0.0.1:3000", controlPlaneResponded: true, hasCachedReferenceData: false })).toBe(false);
    expect(shouldUseSyntheticReferenceData({ apiUrl: "http://127.0.0.1:3000", controlPlaneResponded: false, hasCachedReferenceData: true })).toBe(false);
    expect(shouldUseSyntheticReferenceData({ apiUrl: "http://127.0.0.1:3000", controlPlaneResponded: false, hasCachedReferenceData: false })).toBe(true);
  });

  it("clears cached reference data only for explicit authorization denial", () => {
    expect(shouldClearCachedReferenceData(401)).toBe(true);
    expect(shouldClearCachedReferenceData(403)).toBe(true);
    expect(shouldClearCachedReferenceData(500)).toBe(false);
    expect(shouldClearCachedReferenceData(503)).toBe(false);
  });

  it("retains explicit cached permissions only across transient outages", () => {
    expect(shouldRetainCachedDevicePermissions(408)).toBe(true);
    expect(shouldRetainCachedDevicePermissions(429)).toBe(true);
    expect(shouldRetainCachedDevicePermissions(503)).toBe(true);
    expect(shouldRetainCachedDevicePermissions(400)).toBe(false);
    expect(shouldRetainCachedDevicePermissions(404)).toBe(false);
  });

  it("distinguishes a missing permission migration from a transient outage", () => {
    expect(isDevicePermissionConfigurationMissing({
      error: "DevicePermissionConfigurationMissing",
      message: "Named scanner permissions are not configured."
    })).toBe(true);
    expect(isDevicePermissionConfigurationMissing({ error: "Unavailable" })).toBe(false);
    expect(isDevicePermissionConfigurationMissing(null)).toBe(false);
  });
});
