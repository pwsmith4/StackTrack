const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const QUEUE_KEY = "stacktrack.local.queue.v1";
const CLOCK_KEY = "stacktrack.local.clock.v1";
const DEVICE_KEY = "stacktrack.local.selected-device";
const LOCATION_KEY = "stacktrack.local.selected-location";

const elements = Object.fromEntries(
  [
    "connection-dot", "connection-label", "device-select", "location-select",
    "offline-toggle", "sync-clock", "clock-card", "scan-form", "container-label",
    "container-options", "event-type", "event-location", "load-fields", "goods-type",
    "secondary-value", "external-reference", "scan-result", "sync-queue", "queue-count",
    "queue-list", "refresh-state", "state-panel", "refresh-admin", "metrics",
    "review-list", "event-list", "scenario-result", "reset-data"
  ].map((id) => [id, document.getElementById(id)])
);

let fixtures;
let lastContainerLabel = "";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readJsonStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") || fallback;
  } catch {
    return fallback;
  }
}

function setConnection(mode, label) {
  elements["connection-dot"].className = `status-dot status-${mode}`;
  elements["connection-label"].textContent = label;
}

function currentDevice() {
  return fixtures.devices.find(
    (device) => device.deviceId === elements["device-select"].value
  );
}

function currentLocationId() {
  return elements["location-select"].value;
}

function locationName(locationId) {
  return fixtures.locations.find((location) => location.locationId === locationId)?.name ?? locationId;
}

function containerByLabel(label) {
  const normalized = label.trim().toUpperCase();
  return fixtures.containers.find((container) => container.label.toUpperCase() === normalized);
}

function headers(deviceId) {
  const result = {
    "content-type": "application/json",
    "x-stacktrack-tenant-id": TENANT_ID
  };
  if (deviceId) result["x-stacktrack-device-id"] = deviceId;
  return result;
}

async function api(path, options = {}) {
  const requestHeaders = headers(options.deviceId);
  if (!options.body) delete requestHeaders["content-type"];
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: requestHeaders,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.message ?? data.error ?? `Request failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function queueItems() {
  return readJsonStorage(QUEUE_KEY, []);
}

function saveQueue(items) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  renderQueue();
}

function sequenceKey(deviceId) {
  return `stacktrack.local.sequence.${deviceId}`;
}

function nextSequence(deviceId) {
  const key = sequenceKey(deviceId);
  const sequence = Number.parseInt(localStorage.getItem(key) ?? "0", 10);
  localStorage.setItem(key, String(sequence + 1));
  return sequence;
}

function resetBrowserState() {
  localStorage.removeItem(QUEUE_KEY);
  localStorage.removeItem(CLOCK_KEY);
  for (const device of fixtures.devices) {
    localStorage.removeItem(sequenceKey(device.deviceId));
  }
  renderQueue();
  renderClock();
}

function clockEvidence(deviceId) {
  return readJsonStorage(CLOCK_KEY, {})[deviceId];
}

function saveClockEvidence(deviceId, evidence) {
  const clocks = readJsonStorage(CLOCK_KEY, {});
  clocks[deviceId] = evidence;
  localStorage.setItem(CLOCK_KEY, JSON.stringify(clocks));
  renderClock();
}

function renderClock() {
  if (!fixtures) return;
  const evidence = clockEvidence(currentDevice().deviceId);
  if (!evidence) {
    elements["clock-card"].textContent = "Clock not verified. Events can still be saved, but no offset correction will be attached.";
    return;
  }
  const offset = Number(evidence.offsetSeconds);
  const quality = evidence.roundTripMilliseconds <= 10_000 ? "usable" : "too slow to trust";
  elements["clock-card"].textContent =
    `Measured offset ${offset >= 0 ? "+" : ""}${offset.toFixed(3)}s · ` +
    `${evidence.roundTripMilliseconds}ms round trip · ${quality}`;
}

async function checkClock() {
  const device = currentDevice();
  elements["sync-clock"].disabled = true;
  const sent = new Date();
  try {
    const response = await api("/api/v1/time", { deviceId: device.deviceId });
    const received = new Date();
    const roundTripMilliseconds = received.getTime() - sent.getTime();
    const midpoint = sent.getTime() + roundTripMilliseconds / 2;
    const offsetSeconds = (Date.parse(response.serverAt) - midpoint) / 1_000;
    saveClockEvidence(device.deviceId, {
      offsetSeconds,
      verifiedAt: response.serverAt,
      roundTripMilliseconds
    });
    setConnection("online", "Local server connected");
  } catch (error) {
    setConnection("offline", "Local server unavailable");
    showResult(`Clock check failed: ${error.message}`, "error");
  } finally {
    elements["sync-clock"].disabled = false;
  }
}

function populateSelect(select, items, value, label) {
  select.innerHTML = items
    .map((item) => `<option value="${escapeHtml(value(item))}">${escapeHtml(label(item))}</option>`)
    .join("");
}

function populateReferenceData() {
  populateSelect(elements["device-select"], fixtures.devices, (item) => item.deviceId, (item) => item.label);
  populateSelect(elements["location-select"], fixtures.locations, (item) => item.locationId, (item) => item.name);
  populateSelect(elements["event-location"], fixtures.locations, (item) => item.locationId, (item) => item.name);
  populateSelect(elements["goods-type"], fixtures.goodsTypes, (item) => item.name, (item) => item.name);
  elements["container-options"].innerHTML = fixtures.containers
    .map((container) => `<option value="${escapeHtml(container.label)}">${escapeHtml(container.type)}</option>`)
    .join("");

  const savedDevice = localStorage.getItem(DEVICE_KEY);
  if (fixtures.devices.some((device) => device.deviceId === savedDevice)) {
    elements["device-select"].value = savedDevice;
  }
  const savedLocation = localStorage.getItem(LOCATION_KEY);
  if (fixtures.locations.some((location) => location.locationId === savedLocation)) {
    elements["location-select"].value = savedLocation;
  } else {
    elements["location-select"].value = currentDevice().assignedLocationId;
  }
  elements["event-location"].value = currentLocationId();
  updateClassificationOptions();
  updateEventFields();
  renderClock();
}

function updateClassificationOptions() {
  const goodsType = fixtures.goodsTypes.find(
    (item) => item.name === elements["goods-type"].value
  ) ?? fixtures.goodsTypes[0];
  populateSelect(elements["secondary-value"], goodsType.options, (item) => item, (item) => item);
}

function updateEventFields() {
  const eventType = elements["event-type"].value;
  elements["load-fields"].hidden = eventType !== "load_assigned";
  if (eventType === "batch_out") {
    elements["event-location"].value = fixtures.locations.find((item) => item.type === "in_transit").locationId;
  } else {
    elements["event-location"].value = currentLocationId();
  }
}

function buildEvent({ eventType, container, locationId, device, eventAt = new Date().toISOString(), loadCodeId } = {}) {
  const selectedType = eventType ?? elements["event-type"].value;
  const selectedContainer = container ?? containerByLabel(elements["container-label"].value);
  const selectedDevice = device ?? currentDevice();
  if (!selectedContainer) throw new Error("Unknown container label. Use one of the seeded test labels.");

  const clock = clockEvidence(selectedDevice.deviceId);
  const event = {
    eventId: crypto.randomUUID(),
    deviceInstallationId: selectedDevice.installationId,
    deviceSequence: nextSequence(selectedDevice.deviceId),
    containerId: selectedContainer.containerId,
    locationId: locationId ?? elements["event-location"].value,
    eventType: selectedType,
    eventAt,
    referenceDataVersion: new Date().toISOString(),
    payload: { containerLabel: selectedContainer.label }
  };

  if (clock?.roundTripMilliseconds <= 10_000) {
    event.deviceClockOffsetSeconds = clock.offsetSeconds;
    event.clockVerifiedAt = clock.verifiedAt;
  }

  if (selectedType === "load_assigned") {
    event.loadCodeId = loadCodeId ?? crypto.randomUUID();
    event.payload = {
      ...event.payload,
      goodsType: elements["goods-type"].value,
      secondaryValue: elements["secondary-value"].value,
      externalReference: elements["external-reference"].value.trim() || null
    };
  }
  return event;
}

function showResult(message, kind = "success") {
  const result = elements["scan-result"];
  result.textContent = message;
  result.className = `result show ${kind}`;
}

async function submitEvent(event, deviceId) {
  return api("/api/v1/events", { method: "POST", body: event, deviceId });
}

function addToQueue(event, deviceId, reason = "Saved while offline") {
  const items = queueItems();
  items.push({ event, deviceId, queuedAt: new Date().toISOString(), status: "pending", reason });
  saveQueue(items);
}

async function saveObservation(event) {
  const device = currentDevice();
  lastContainerLabel = elements["container-label"].value.trim().toUpperCase();

  if (elements["offline-toggle"].checked) {
    addToQueue(event, device.deviceId);
    showResult(`Saved offline as device sequence ${event.deviceSequence}.`, "warning");
    await refreshState();
    return;
  }

  try {
    const response = await submitEvent(event, device.deviceId);
    const kind = response.status.includes("review") || response.warnings.length ? "warning" : "success";
    showResult(`Server status: ${response.status.replaceAll("_", " ")}.`, kind);
    setConnection("online", "Local server connected");
    await Promise.all([refreshState(), refreshAdmin()]);
  } catch (error) {
    if (!error.status) {
      addToQueue(event, device.deviceId, error.message);
      setConnection("offline", "Local server unavailable — event queued");
      showResult("The server could not be reached. The observation is safely queued.", "warning");
    } else {
      showResult(error.message, "error");
    }
  }
}

function renderQueue() {
  const items = queueItems();
  elements["queue-count"].textContent = String(items.length);
  if (!items.length) {
    elements["queue-list"].className = "empty-state";
    elements["queue-list"].textContent = "No events waiting to sync.";
    return;
  }
  elements["queue-list"].className = "";
  elements["queue-list"].innerHTML = items.map((item) => {
    const container = fixtures?.containers.find((entry) => entry.containerId === item.event.containerId);
    return `<div class="queue-item ${item.status === "blocked" ? "blocked" : ""}">
      <div><strong>${escapeHtml(container?.label ?? item.event.containerId)}</strong><br><small>${escapeHtml(item.event.eventType.replaceAll("_", " "))} · sequence ${item.event.deviceSequence}</small></div>
      <small>${escapeHtml(item.status)}${item.error ? ` · ${escapeHtml(item.error)}` : ""}</small>
    </div>`;
  }).join("");
}

async function syncQueue() {
  const original = queueItems();
  if (!original.length) return;
  elements["sync-queue"].disabled = true;
  const remaining = [];
  let synced = 0;

  for (let index = 0; index < original.length; index += 1) {
    const item = original[index];
    if (item.status === "blocked") {
      remaining.push(item);
      continue;
    }
    try {
      await submitEvent(item.event, item.deviceId);
      synced += 1;
    } catch (error) {
      remaining.push({
        ...item,
        status: error.status ? "blocked" : "pending",
        error: error.message
      });
      if (!error.status) {
        remaining.push(...original.slice(index + 1));
        break;
      }
    }
  }

  saveQueue(remaining);
  elements["sync-queue"].disabled = false;
  if (synced) {
    showResult(`Synchronized ${synced} queued observation${synced === 1 ? "" : "s"}.`, "success");
  }
  await Promise.all([refreshState(), refreshAdmin()]);
}

async function refreshState() {
  if (!fixtures) return;
  const label = (lastContainerLabel || elements["container-label"].value).trim().toUpperCase();
  const container = containerByLabel(label);
  if (!container) {
    elements["state-panel"].className = "empty-state";
    elements["state-panel"].textContent = label ? "Unknown test container." : "Scan or enter a container label.";
    return;
  }
  lastContainerLabel = container.label;
  try {
    const state = await api(`/api/v1/containers/${container.containerId}/state`);
    const conflicts = state.conflicts.length
      ? `<div><span>Conflicts</span><strong>${state.conflicts.map((item) => escapeHtml(item.reason)).join(", ")}</strong></div>`
      : "";
    elements["state-panel"].className = "";
    elements["state-panel"].innerHTML = `
      <p><strong>${escapeHtml(container.label)}</strong> <span class="state-status ${escapeHtml(state.health)}">${escapeHtml(state.health.replaceAll("_", " "))}</span></p>
      <div class="state-grid">
        <div><span>Load state</span><strong>${escapeHtml(state.loadState)}</strong></div>
        <div><span>Location</span><strong>${escapeHtml(state.locationId ? locationName(state.locationId) : "Unknown")}</strong></div>
        <div><span>Active load</span><strong>${escapeHtml(state.activeLoadCodeId?.slice(0, 8) ?? "None")}</strong></div>
        <div><span>Applied evidence</span><strong>${state.appliedEventIds.length} event(s)</strong></div>
        ${conflicts}
      </div>`;
  } catch (error) {
    if (error.status === 404) {
      elements["state-panel"].className = "empty-state";
      elements["state-panel"].textContent = `${container.label} has no server-side observations yet.`;
    } else {
      elements["state-panel"].className = "empty-state";
      elements["state-panel"].textContent = `State unavailable: ${error.message}`;
    }
  }
}

function renderMetrics(events, reviews) {
  const uniqueContainers = new Set(events.map((event) => event.containerId)).size;
  const queued = queueItems().length;
  const warningEvents = events.filter((event) => event.accuracyFlags.length).length;
  const metrics = [
    [events.length, "Ledger observations"],
    [uniqueContainers, "Observed containers"],
    [reviews.length, "States needing review"],
    [queued + warningEvents, "Queued or warned"]
  ];
  elements.metrics.innerHTML = metrics
    .map(([value, label]) => `<div class="metric"><strong>${value}</strong><span>${escapeHtml(label)}</span></div>`)
    .join("");
}

function renderReviews(items) {
  if (!items.length) {
    elements["review-list"].className = "empty-state";
    elements["review-list"].textContent = "No ambiguous container states. Run the conflict scenario to exercise this queue.";
    return;
  }
  elements["review-list"].className = "";
  elements["review-list"].innerHTML = items.map((item) => {
    const container = fixtures.containers.find((entry) => entry.containerId === item.containerId);
    return `<div class="review-item">
      <strong>${escapeHtml(container?.label ?? item.containerId)}</strong>
      <span class="state-status needs_review">needs review</span>
      <p>${item.conflicts.map((conflict) => escapeHtml(conflict.reason)).join(" · ")}</p>
      <small>${item.conflicts.reduce((sum, conflict) => sum + conflict.eventIds.length, 0)} evidence references preserved · resolution workflow is the next local increment</small>
    </div>`;
  }).join("");
}

function renderEvents(events) {
  if (!events.length) {
    elements["event-list"].innerHTML = '<div class="empty-state">No observations have reached the local ledger.</div>';
    return;
  }
  elements["event-list"].innerHTML = `<table>
    <thead><tr><th>Received</th><th>Container</th><th>Action</th><th>Device seq.</th><th>Location</th><th>Flags</th></tr></thead>
    <tbody>${events.slice(0, 50).map((event) => {
      const container = fixtures.containers.find((entry) => entry.containerId === event.containerId);
      const flags = event.accuracyFlags.length
        ? event.accuracyFlags.map((flag) => `<span class="flag">${escapeHtml(flag)}</span>`).join("")
        : "—";
      return `<tr>
        <td>${escapeHtml(new Date(event.receivedAt).toLocaleTimeString())}</td>
        <td><strong>${escapeHtml(container?.label ?? event.containerId)}</strong></td>
        <td>${escapeHtml(event.eventType.replaceAll("_", " "))}</td>
        <td>${event.deviceSequence}</td>
        <td>${escapeHtml(locationName(event.locationId))}</td>
        <td>${flags}</td>
      </tr>`;
    }).join("")}</tbody>
  </table>`;
}

async function refreshAdmin() {
  if (!fixtures) return;
  try {
    const [events, reviews] = await Promise.all([
      api("/api/v1/local/events"),
      api("/api/v1/review-queue")
    ]);
    renderMetrics(events.items, reviews.items);
    renderReviews(reviews.items);
    renderEvents(events.items);
  } catch (error) {
    elements["review-list"].textContent = `Admin data unavailable: ${error.message}`;
  }
}

async function resetAll(requireConfirmation = true) {
  if (requireConfirmation && !window.confirm("Clear all local StackTrack test events and pending browser scans?")) {
    return false;
  }
  await api("/api/v1/local/reset", { method: "POST" });
  resetBrowserState();
  lastContainerLabel = "";
  await Promise.all([refreshState(), refreshAdmin()]);
  return true;
}

function scenarioMessage(message) {
  elements["scenario-result"].textContent = message;
  elements["scenario-result"].className = "scenario-result show";
}

function scenarioEvent(device, container, eventType, locationId, minutesAgo, loadCodeId) {
  const eventAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return buildEvent({ device, container, eventType, locationId, eventAt, loadCodeId });
}

async function runScenario(name, button) {
  button.disabled = true;
  try {
    await resetAll(false);
    const deviceA = fixtures.devices[0];
    const deviceB = fixtures.devices[1];
    const store = fixtures.locations.find((item) => item.type === "store_backroom");
    const warehouse = fixtures.locations.find((item) => item.type === "warehouse");
    const transit = fixtures.locations.find((item) => item.type === "in_transit");

    if (name === "happy") {
      const container = containerByLabel("B1001");
      const loadCode = crypto.randomUUID();
      const events = [
        scenarioEvent(deviceA, container, "load_assigned", store.locationId, 4, loadCode),
        scenarioEvent(deviceA, container, "batch_out", transit.locationId, 3),
        scenarioEvent(deviceA, container, "batch_in", warehouse.locationId, 2),
        scenarioEvent(deviceA, container, "emptied", warehouse.locationId, 1)
      ];
      for (const event of events) await submitEvent(event, deviceA.deviceId);
      lastContainerLabel = container.label;
      scenarioMessage("Happy path complete: four observations accepted; B1001 is empty at the warehouse.");
    } else if (name === "conflict") {
      const container = containerByLabel("B1002");
      const first = scenarioEvent(deviceA, container, "load_assigned", store.locationId, 2, crypto.randomUUID());
      const second = scenarioEvent(deviceB, container, "load_assigned", warehouse.locationId, 1, crypto.randomUUID());
      await submitEvent(first, deviceA.deviceId);
      await submitEvent(second, deviceB.deviceId);
      lastContainerLabel = container.label;
      scenarioMessage("Conflict created: both load observations were preserved and B1002 now appears in Admin review.");
    } else if (name === "offline") {
      const container = containerByLabel("C2001");
      const loadCode = crypto.randomUUID();
      const events = [
        scenarioEvent(deviceA, container, "load_assigned", store.locationId, 3, loadCode),
        scenarioEvent(deviceA, container, "batch_out", transit.locationId, 2),
        scenarioEvent(deviceA, container, "batch_in", warehouse.locationId, 1)
      ];
      for (const event of events) addToQueue(event, deviceA.deviceId, "Offline scenario");
      lastContainerLabel = container.label;
      scenarioMessage("Three C2001 observations are queued in the Field scanner tab. Press Sync pending to test recovery.");
    }
    await Promise.all([refreshState(), refreshAdmin()]);
  } catch (error) {
    scenarioMessage(`Scenario failed: ${error.message}`);
  } finally {
    button.disabled = false;
  }
}

function wireInteractions() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === tab));
      document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
      document.getElementById(`${tab.dataset.tab}-view`).classList.add("active");
      if (tab.dataset.tab === "admin") refreshAdmin();
    });
  });

  elements["device-select"].addEventListener("change", () => {
    localStorage.setItem(DEVICE_KEY, currentDevice().deviceId);
    elements["location-select"].value = currentDevice().assignedLocationId;
    elements["event-location"].value = currentLocationId();
    renderClock();
  });
  elements["location-select"].addEventListener("change", () => {
    localStorage.setItem(LOCATION_KEY, currentLocationId());
    updateEventFields();
  });
  elements["event-type"].addEventListener("change", updateEventFields);
  elements["goods-type"].addEventListener("change", updateClassificationOptions);
  elements["container-label"].addEventListener("change", () => {
    lastContainerLabel = elements["container-label"].value;
    refreshState();
  });
  elements["offline-toggle"].addEventListener("change", () => {
    setConnection(
      elements["offline-toggle"].checked ? "waiting" : "online",
      elements["offline-toggle"].checked ? "Simulated offline mode" : "Local server connected"
    );
  });
  elements["sync-clock"].addEventListener("click", checkClock);
  elements["sync-queue"].addEventListener("click", syncQueue);
  elements["refresh-state"].addEventListener("click", refreshState);
  elements["refresh-admin"].addEventListener("click", refreshAdmin);
  elements["reset-data"].addEventListener("click", () => resetAll(true));
  document.querySelectorAll(".scenario-button").forEach((button) => {
    button.addEventListener("click", () => runScenario(button.dataset.scenario, button));
  });
  elements["scan-form"].addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveObservation(buildEvent());
    } catch (error) {
      showResult(error.message, "error");
    }
  });
}

async function initialize() {
  try {
    fixtures = await api("/api/v1/local/reference-data");
    populateReferenceData();
    wireInteractions();
    renderQueue();
    setConnection("online", "Local server connected");
    await Promise.all([checkClock(), refreshAdmin()]);
  } catch (error) {
    setConnection("offline", "Local server failed to start");
    document.querySelector("main").innerHTML = `<article class="card"><h2>Local Lab unavailable</h2><p>${escapeHtml(error.message)}</p></article>`;
  }
}

initialize();
