import { describe, expect, it } from "vitest";
import { deviceRequestHeaders } from "../src/device-network";

describe("device request headers", () => {
  it("includes the installation identity on read requests", () => {
    expect(deviceRequestHeaders({ tenantId: "tenant", deviceId: "device", installationId: "installation" }, { noCache: true })).toEqual({
      "x-stacktrack-tenant-id": "tenant",
      "x-stacktrack-device-id": "device",
      "x-stacktrack-device-installation-id": "installation",
      "cache-control": "no-cache"
    });
  });

  it("includes JSON content type and installation identity on event writes", () => {
    expect(deviceRequestHeaders({ tenantId: "tenant", deviceId: "device", installationId: "installation" }, { contentType: true })).toEqual({
      "content-type": "application/json",
      "x-stacktrack-tenant-id": "tenant",
      "x-stacktrack-device-id": "device",
      "x-stacktrack-device-installation-id": "installation"
    });
  });
});
