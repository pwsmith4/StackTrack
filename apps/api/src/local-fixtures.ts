export interface LocalLocation {
  readonly locationId: string;
  readonly name: string;
  readonly type:
    | "donation_express"
    | "store_backroom"
    | "warehouse"
    | "in_transit";
  readonly isActive?: boolean;
}

export interface LocalDevice {
  readonly deviceId: string;
  readonly installationId: string;
  readonly label: string;
  readonly assignedLocationId: string;
  readonly isActive: boolean;
  readonly deactivatedAt: string | null;
  readonly pendingOfflineScanCount: number;
  readonly reportedAppVersion: string | null;
  readonly requiredAppVersion: string;
  readonly lastReportedAt: string | null;
}

export interface LocalDeviceAssignment {
  readonly assignmentHistoryId: string;
  readonly deviceId: string;
  readonly previousLocationId: string;
  readonly assignedLocationId: string;
  readonly reason: string;
  readonly occurredAt: string;
}

export interface LocalContainer {
  readonly containerId: string;
  readonly label: string;
  readonly type: "bin" | "cart" | "gaylord";
}

export interface LocalFixtures {
  readonly tenant: { readonly tenantId: string; readonly name: string };
  readonly locations: readonly LocalLocation[];
  readonly devices: readonly LocalDevice[];
  readonly deviceAssignments: readonly LocalDeviceAssignment[];
  readonly containers: readonly LocalContainer[];
  readonly goodsTypes: readonly {
    readonly name: string;
    readonly secondaryLabel: string;
    readonly options: readonly string[];
  }[];
}

export const localFixtures = {
  tenant: {
    tenantId: "10000000-0000-4000-8000-000000000001",
    name: "Goodwill Local Test"
  },
  locations: [
    {
      locationId: "20000000-0000-4000-8000-000000000001",
      name: "Auburn Boulevard Donation Xpress",
      type: "donation_express",
      isActive: true
    },
    {
      locationId: "20000000-0000-4000-8000-000000000002",
      name: "Midtown Store",
      type: "store_backroom",
      isActive: true
    },
    {
      locationId: "20000000-0000-4000-8000-000000000003",
      name: "South Sacramento Warehouse",
      type: "warehouse",
      isActive: true
    },
    {
      locationId: "20000000-0000-4000-8000-000000000004",
      name: "In Transit",
      type: "in_transit",
      isActive: true
    },
    {
      locationId: "20000000-0000-4000-8000-000000000005",
      name: "North Sacramento Warehouse",
      type: "warehouse",
      isActive: true
    }
  ] satisfies readonly LocalLocation[],
  devices: [
    {
      deviceId: "30000000-0000-4000-8000-000000000001",
      installationId: "31000000-0000-4000-8000-000000000001",
      label: "Scanner A — Midtown",
      assignedLocationId: "20000000-0000-4000-8000-000000000002",
      isActive: true,
      deactivatedAt: null,
      pendingOfflineScanCount: 0,
      reportedAppVersion: "0.2.0",
      requiredAppVersion: "0.2.0",
      lastReportedAt: new Date().toISOString()
    },
    {
      deviceId: "30000000-0000-4000-8000-000000000002",
      installationId: "31000000-0000-4000-8000-000000000002",
      label: "Scanner B — Warehouse",
      assignedLocationId: "20000000-0000-4000-8000-000000000003",
      isActive: true,
      deactivatedAt: null,
      pendingOfflineScanCount: 2,
      reportedAppVersion: "0.2.0",
      requiredAppVersion: "0.3.0",
      lastReportedAt: new Date(Date.now() - 12 * 60 * 1000).toISOString()
    },
    {
      deviceId: "30000000-0000-4000-8000-000000000003",
      installationId: "31000000-0000-4000-8000-000000000003",
      label: "Scanner C — North Warehouse",
      assignedLocationId: "20000000-0000-4000-8000-000000000005",
      isActive: true,
      deactivatedAt: null,
      pendingOfflineScanCount: 0,
      reportedAppVersion: "0.3.0",
      requiredAppVersion: "0.3.0",
      lastReportedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString()
    },
    {
      deviceId: "30000000-0000-4000-8000-000000000004",
      installationId: "31000000-0000-4000-8000-000000000004",
      label: "Scanner D — Auburn Donation Xpress",
      assignedLocationId: "20000000-0000-4000-8000-000000000001",
      isActive: true,
      deactivatedAt: null,
      pendingOfflineScanCount: 0,
      reportedAppVersion: "0.3.0",
      requiredAppVersion: "0.3.0",
      lastReportedAt: new Date(Date.now() - 7 * 60 * 1000).toISOString()
    }
  ] satisfies readonly LocalDevice[],
  deviceAssignments: [
    {
      assignmentHistoryId: "32000000-0000-4000-8000-000000000001",
      deviceId: "30000000-0000-4000-8000-000000000001",
      previousLocationId: "20000000-0000-4000-8000-000000000001",
      assignedLocationId: "20000000-0000-4000-8000-000000000002",
      reason: "Pilot scanner moved to the Midtown Store work area.",
      occurredAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    }
  ] satisfies readonly LocalDeviceAssignment[],
  containers: [
    ["B1001", "bin"],
    ["B1002", "bin"],
    ["B1003", "bin"],
    ["C2001", "cart"],
    ["C2002", "cart"],
    ["G3001", "gaylord"],
    ["G3002", "gaylord"],
    ["B1004", "bin"],
    ["B1005", "bin"],
    ["C2003", "cart"],
    ["G3003", "gaylord"]
  ].map(([label, type], index) => ({
    containerId: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    label,
    type
  })) as readonly LocalContainer[],
  goodsTypes: [
    { name: "Soft", secondaryLabel: "Quality Type", options: ["Raw", "Pre-Sort", "Salvage"] },
    { name: "Hard", secondaryLabel: "Quality Type", options: ["Raw", "Pre-Sort", "Salvage"] },
    { name: "Books", secondaryLabel: "Quality Type", options: ["Raw", "Pre-Sort", "Salvage"] },
    { name: "Other", secondaryLabel: "Other Type", options: ["Trash", "Ecomm", "Ewaste", "Bric Brac"] }
  ]
} as const satisfies LocalFixtures;

export function seedLocalLedger(
  submit: (
    input: unknown,
    context: { tenantId: string; deviceId: string },
    receivedAt: Date
  ) => unknown,
  now = new Date()
): void {
  const tenantId = localFixtures.tenant.tenantId;
  const store = localFixtures.locations[1]!;
  const warehouse = localFixtures.locations[2]!;
  const transit = localFixtures.locations[3]!;
  const northWarehouse = localFixtures.locations[4]!;
  const storeDevice = localFixtures.devices[0]!;
  const warehouseDevice = localFixtures.devices[1]!;
  const northWarehouseDevice = localFixtures.devices[2]!;
  const donationDevice = localFixtures.devices[3]!;
  const at = (hoursAgo: number) =>
    new Date(now.getTime() - hoursAgo * 60 * 60 * 1_000).toISOString();

  const observations = [
    {
      eventId: "51000000-0000-4000-8000-000000000001",
      containerId: localFixtures.containers[0]!.containerId,
      loadCodeId: "61000000-0000-4000-8000-000000000001",
      locationId: store.locationId,
      eventType: "load_assigned",
      eventAt: at(4.5),
      payload: { displayLoadCode: "ST-0724-014", goodsType: "Soft", secondaryValue: "Raw" }
    },
    {
      eventId: "51000000-0000-4000-8000-000000000002",
      containerId: localFixtures.containers[0]!.containerId,
      loadCodeId: "61000000-0000-4000-8000-000000000001",
      locationId: transit.locationId,
      eventType: "batch_out",
      eventAt: at(2.2),
      payload: { sourceLocationId: store.locationId }
    },
    {
      eventId: "51000000-0000-4000-8000-000000000003",
      containerId: localFixtures.containers[1]!.containerId,
      loadCodeId: "61000000-0000-4000-8000-000000000002",
      locationId: store.locationId,
      eventType: "load_assigned",
      eventAt: at(1.3),
      payload: { displayLoadCode: "ST-0724-015", goodsType: "Hard", secondaryValue: "Pre-Sort" }
    },
    {
      eventId: "51000000-0000-4000-8000-000000000004",
      containerId: localFixtures.containers[2]!.containerId,
      loadCodeId: "61000000-0000-4000-8000-000000000003",
      locationId: warehouse.locationId,
      eventType: "load_assigned",
      eventAt: at(26),
      payload: { displayLoadCode: "ST-0723-041", goodsType: "Books", secondaryValue: "Raw" }
    },
    {
      eventId: "51000000-0000-4000-8000-000000000005",
      containerId: localFixtures.containers[2]!.containerId,
      locationId: warehouse.locationId,
      eventType: "emptied",
      eventAt: at(20),
      payload: {}
    },
    {
      eventId: "51000000-0000-4000-8000-000000000006",
      containerId: localFixtures.containers[3]!.containerId,
      loadCodeId: "61000000-0000-4000-8000-000000000004",
      locationId: store.locationId,
      eventType: "load_assigned",
      eventAt: at(9),
      payload: { displayLoadCode: "ST-0724-011", goodsType: "Other", secondaryValue: "Ecomm" }
    },
    {
      eventId: "51000000-0000-4000-8000-000000000007",
      containerId: localFixtures.containers[4]!.containerId,
      loadCodeId: "61000000-0000-4000-8000-000000000005",
      locationId: store.locationId,
      eventType: "load_assigned",
      eventAt: at(31),
      payload: { displayLoadCode: "ST-0723-038", goodsType: "Soft", secondaryValue: "Salvage" }
    },
    {
      eventId: "51000000-0000-4000-8000-000000000008",
      containerId: localFixtures.containers[4]!.containerId,
      loadCodeId: "61000000-0000-4000-8000-000000000006",
      locationId: store.locationId,
      eventType: "load_assigned",
      eventAt: at(30.8),
      payload: { displayLoadCode: "ST-0723-039", goodsType: "Soft", secondaryValue: "Raw" }
    },
    {
      eventId: "51000000-0000-4000-8000-000000000009",
      containerId: localFixtures.containers[5]!.containerId,
      loadCodeId: "61000000-0000-4000-8000-000000000007",
      locationId: warehouse.locationId,
      eventType: "load_assigned",
      eventAt: at(6),
      payload: { displayLoadCode: "ST-0724-012", goodsType: "Hard", secondaryValue: "Raw" }
    },
    {
      eventId: "51000000-0000-4000-8000-000000000010",
      containerId: localFixtures.containers[7]!.containerId,
      loadCodeId: "61000000-0000-4000-8000-000000000008",
      locationId: localFixtures.locations[0]!.locationId,
      eventType: "load_assigned",
      eventAt: at(60),
      payload: { displayLoadCode: "ST-MULTI-001", goodsType: "Soft", secondaryValue: "Raw" }
    },
    {
      eventId: "51000000-0000-4000-8000-000000000011",
      containerId: localFixtures.containers[7]!.containerId,
      loadCodeId: "61000000-0000-4000-8000-000000000008",
      locationId: transit.locationId,
      eventType: "batch_out",
      eventAt: at(59),
      payload: { sourceLocationId: localFixtures.locations[0]!.locationId }
    },
    {
      eventId: "51000000-0000-4000-8000-000000000012",
      containerId: localFixtures.containers[7]!.containerId,
      loadCodeId: "61000000-0000-4000-8000-000000000008",
      locationId: warehouse.locationId,
      eventType: "batch_in",
      eventAt: at(58),
      payload: {}
    },
    {
      eventId: "51000000-0000-4000-8000-000000000013",
      containerId: localFixtures.containers[7]!.containerId,
      loadCodeId: "61000000-0000-4000-8000-000000000008",
      locationId: transit.locationId,
      eventType: "batch_out",
      eventAt: at(57),
      payload: { sourceLocationId: warehouse.locationId }
    },
    {
      eventId: "51000000-0000-4000-8000-000000000014",
      containerId: localFixtures.containers[7]!.containerId,
      loadCodeId: "61000000-0000-4000-8000-000000000008",
      locationId: northWarehouse.locationId,
      eventType: "batch_in",
      eventAt: at(56),
      payload: {}
    },
    {
      eventId: "51000000-0000-4000-8000-000000000015",
      containerId: localFixtures.containers[7]!.containerId,
      loadCodeId: "61000000-0000-4000-8000-000000000008",
      locationId: transit.locationId,
      eventType: "batch_out",
      eventAt: at(55),
      payload: { sourceLocationId: northWarehouse.locationId }
    },
    {
      eventId: "51000000-0000-4000-8000-000000000016",
      containerId: localFixtures.containers[7]!.containerId,
      loadCodeId: "61000000-0000-4000-8000-000000000008",
      locationId: store.locationId,
      eventType: "batch_in",
      eventAt: at(54),
      payload: {}
    }
  ] as const;

  const sequences = new Map<string, number>();
  const observationDevices = [
    storeDevice, storeDevice, storeDevice, warehouseDevice, warehouseDevice,
    storeDevice, storeDevice, storeDevice, warehouseDevice,
    donationDevice, donationDevice, warehouseDevice, warehouseDevice,
    northWarehouseDevice, northWarehouseDevice, storeDevice
  ];
  observations.forEach((observation, index) => {
    const device = observationDevices[index] ?? storeDevice;
    const deviceSequence = sequences.get(device.deviceId) ?? 0;
    sequences.set(device.deviceId, deviceSequence + 1);
    submit(
      {
        ...observation,
        deviceInstallationId: device.installationId,
        deviceSequence,
        deviceClockOffsetSeconds: 0,
        clockVerifiedAt: at(0.1),
        referenceDataVersion: at(48)
      },
      { tenantId, deviceId: device.deviceId },
      new Date(new Date(observation.eventAt).getTime() + 30_000)
    );
  });
}
