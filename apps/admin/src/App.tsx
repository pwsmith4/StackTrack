import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Boxes,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Cloud,
  Container as ContainerIcon,
  Download,
  ExternalLink,
  FileClock,
  FilePenLine,
  GitBranch,
  HandHeart,
  Layers3,
  LayoutDashboard,
  Link2,
  MapPin,
  Menu,
  MessageSquare,
  MonitorSmartphone,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  ScrollText,
  Settings,
  ShieldCheck,
  Smartphone,
  Truck,
  UserRound,
  Waypoints,
  Store,
  Target,
  Trash2,
  TrendingUp,
  Warehouse,
  Wifi,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  API_URL,
  ApiRequestError,
  changeOwnPassword,
  correctionRequestAction,
  createLocation,
  createCorrectionRequest,
  createAdminUser,
  getLocationDependencies,
  listAdminUsers,
  loadOperationsData,
  resetAdminPassword,
  reviewCaseAction,
  revokeAdminSession,
  searchAuditEntries,
  signIn,
  updateAdminUser,
  updateDevice,
  retireLocation,
  type AdminPrincipal,
  type AdminSession,
  type ManagedAdminRole,
  type AuditEntry,
  type AuditPage,
  type Container,
  type CorrectionAction,
  type CorrectionRequest,
  type Device,
  type DeviceAssignment,
  type Fixtures,
  type Location,
  type LocationDependencySummary,
  type ManagedLocationType,
  type OperationsWarning,
  type Projection,
  type ReviewCase,
  type ReviewAction,
  type StoredEvent
} from "./api";
import stacktrackLogo from "./assets/stacktrack-logo-tight.png";

type Page =
  | "dashboard"
  | "inventory"
  | "service"
  | "forecast"
  | "containers"
  | "loads"
  | "locations"
  | "exceptions"
  | "corrections"
  | "activity"
  | "audit"
  | "devices"
  | "reports"
  | "settings";

interface OperationsData {
  fixtures: Fixtures;
  events: StoredEvent[];
  reviewCases: ReviewCase[];
  correctionRequests: CorrectionRequest[];
  auditEntries: AuditEntry[];
  warnings: OperationsWarning[];
  projections: Record<string, Projection | null>;
}

interface DetailView {
  readonly eyebrow: string;
  readonly title: string;
  readonly body: ReactNode;
  readonly icon?: ReactNode;
  readonly status?: { label: string; tone: PillTone };
  readonly summary?: string;
  readonly recordId?: string;
  readonly recordIdLabel?: string;
  readonly actions?: ReactNode;
}

type OpenDetail = (detail: DetailView) => void;

const projectionHealthLabels: Record<Projection["health"], string> = {
  clean: "Clean",
  warning: "Warning",
  needs_review: "Needs review"
};

const loadStateLabels: Record<Projection["loadState"], string> = {
  loaded: "Loaded",
  empty: "Empty",
  unknown: "Unknown"
};

const accuracyFlagLabels: Record<string, string> = {
  ClockSkewWarning: "Scanner clock differs from server time",
  ClockSkewReview: "Scanner clock needs review",
  ClockVerificationStale: "Scanner clock check is stale",
  LateArrival: "Scan uploaded late",
  DeviceSequenceGap: "Scanner sequence gap",
  DeviceSequenceOutOfOrder: "Scan arrived out of order",
  DeviceSequenceCollision: "Duplicate scanner sequence",
  StaleReferenceData: "Location or scanner reference is stale"
};

const accuracyFlagDescriptions: Record<string, string> = {
  ClockSkewWarning: "The scanner clock is slightly different from server time.",
  ClockSkewReview: "The scanner clock difference is large enough to review before relying on timing.",
  ClockVerificationStale: "The scanner clock has not been checked recently.",
  LateArrival: "The scan reached StackTrack after it was recorded on the scanner.",
  DeviceSequenceGap: "A scanner sequence number is missing from the received history.",
  DeviceSequenceOutOfOrder: "This scan arrived in a different order than the scanner recorded it.",
  DeviceSequenceCollision: "Another scan from this scanner used the same sequence number.",
  StaleReferenceData: "The location or scanner reference was out of date when this scan arrived."
};

function projectionHealthLabel(value: Projection["health"] | null | undefined): string {
  return value ? projectionHealthLabels[value] ?? humanizeCode(value) : "No history";
}

function loadStateLabel(value: Projection["loadState"] | null | undefined): string {
  return value ? loadStateLabels[value] ?? humanizeCode(value) : "Not observed";
}

function humanizeCode(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase()
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function accuracyFlagLabel(value: string): string {
  return accuracyFlagLabels[value] ?? humanizeCode(value);
}

function accuracyFlagDetail(value: string): string {
  return `${accuracyFlagLabel(value)} — ${accuracyFlagDescriptions[value] ?? "This observation should be reviewed before it is used for a correction."}`;
}

const pageTitles: Record<Page, { eyebrow: string; title: string; description: string }> = {
  dashboard: {
    eyebrow: "Operations overview",
    title: "Know where every container is.",
    description: "A live operational picture built from the immutable scan history."
  },
  inventory: {
    eyebrow: "Inventory control",
    title: "Company-wide inventory",
    description: "Review the current container footprint by location, container type, and goods category."
  },
  service: {
    eyebrow: "Dispatch planning",
    title: "Daily service plan",
    description: "Prioritize full-crate pickups and empty-crate deliveries from each location’s operating targets."
  },
  forecast: {
    eyebrow: "Warehouse planning",
    title: "Warehouse outlook",
    description: "Model warehouse capacity and store coverage using history, operating targets, and holiday adjustments."
  },
  containers: {
    eyebrow: "Reusable assets",
    title: "Containers",
    description: "Search every tracked bin, cart, and gaylord by its unique container label. Select a row for history and technical details."
  },
  loads: {
    eyebrow: "Production handoff",
    title: "Load codes",
    description: "Validated daily codes available for production entry."
  },
  locations: {
    eyebrow: "Network",
    title: "Locations",
    description: "Stores, Donation Xpress sites, warehouses, and in-transit inventory."
  },
  exceptions: {
    eyebrow: "Review queue",
    title: "Needs review",
    description: "Contradictory or unusual observations remain visible until resolved."
  },
  corrections: {
    eyebrow: "Controlled changes",
    title: "Corrections",
    description: "Request and approve official-state changes without erasing original scans."
  },
  activity: {
    eyebrow: "Operational feed",
    title: "Activity",
    description: "Follow physical scanner observations and container movement; use Audit trail for administrative actions."
  },
  audit: {
    eyebrow: "Governance evidence",
    title: "Audit trail",
    description: "Investigate who changed what, when, and why across administrator and control actions."
  },
  devices: {
    eyebrow: "Field hardware",
    title: "Devices",
    description: "Shared scanners are locked to a location and individually traceable."
  },
  reports: {
    eyebrow: "Operations intelligence",
    title: "Reports & data",
    description: "Filter operational evidence, interpret data health, and export decision-ready reports."
  },
  settings: {
    eyebrow: "Configuration",
    title: "Settings",
    description: "Access policies, scanner behavior, and integration boundaries."
  }
};

const nav: { page: Page; label: string; icon: typeof Boxes }[] = [
  { page: "dashboard", label: "Overview", icon: LayoutDashboard },
  { page: "inventory", label: "Inventory", icon: Layers3 },
  { page: "service", label: "Service plan", icon: Truck },
  { page: "forecast", label: "Warehouse outlook", icon: TrendingUp },
  { page: "containers", label: "Containers", icon: ContainerIcon },
  { page: "loads", label: "Load codes", icon: PackageCheck },
  { page: "locations", label: "Locations", icon: MapPin },
  { page: "exceptions", label: "Needs review", icon: AlertTriangle },
  { page: "corrections", label: "Corrections", icon: FilePenLine },
  { page: "activity", label: "Activity", icon: FileClock },
  { page: "audit", label: "Audit trail", icon: ScrollText },
  { page: "devices", label: "Devices", icon: Smartphone },
  { page: "reports", label: "Reports & data", icon: BarChart3 }
];

type LocationInventoryBucket = "current" | "arriving" | "leaving";

interface LocationInventoryFilter {
  containerType?: Container["type"] | undefined;
  goodsType?: string | undefined;
  loadState?: Projection["loadState"] | undefined;
  bucket?: LocationInventoryBucket | undefined;
}

type AppRoute = { page: Page; locationId?: string; locationFilter?: LocationInventoryFilter };

function routeFromHash(): AppRoute {
  // GitHub Pages can append a verification query to the hash during deploys.
  // Keep routing deliberately small and deterministic so a copied location
  // link never falls back to an unrelated page.
  const rawHash = window.location.hash.replace(/^#\/?/, "");
  const [rawPath, rawQuery = ""] = rawHash.split("?");
  const raw = rawPath ?? "";
  const parts = raw.split("/").filter(Boolean).map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  if (parts[0] === "locations" && parts[1]) {
    const params = new URLSearchParams(rawQuery);
    const containerType = params.get("containerType");
    const goodsType = params.get("goodsType");
    const loadState = params.get("loadState");
    const bucket = params.get("bucket");
    const locationFilter: LocationInventoryFilter = {
      ...(containerType === "bin" || containerType === "cart" || containerType === "gaylord" ? { containerType } : {}),
      ...(goodsType ? { goodsType } : {}),
      ...(loadState === "loaded" || loadState === "empty" || loadState === "unknown" ? { loadState } : {}),
      ...(bucket === "current" || bucket === "arriving" || bucket === "leaving" ? { bucket } : {})
    };
    return { page: "locations", locationId: parts[1], ...(Object.keys(locationFilter).length ? { locationFilter } : {}) };
  }
  const value = parts[0] as Page;
  return [...nav.map((item) => item.page), "settings"].includes(value)
    ? { page: value }
    : { page: "dashboard" };
}

function Mark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`mark ${compact ? "mark--compact" : ""}`}>
      <img className="mark__logo" src={stacktrackLogo} alt="StackTrack" />
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="empty-state">
      <ClipboardCheck size={30} />
      <strong>Nothing to review</strong>
      <span>{children}</span>
    </div>
  );
}

type PillTone = "good" | "warn" | "blue" | "muted";

function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <span className={`pill pill--${tone}`}>{children}</span>;
}

const pageSizeOptions = [12, 25, 50, 100];

function PaginationControls({
  pageIndex,
  pageCount,
  pageSize,
  total,
  loading = false,
  onPageChange,
  onPageSizeChange,
  ariaLabel = "Pagination",
  className = ""
}: {
  pageIndex: number;
  pageCount: number;
  pageSize: number;
  total: number;
  loading?: boolean;
  onPageChange: (pageIndex: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const currentPage = Math.min(Math.max(1, pageCount), pageIndex + 1);
  const firstItem = total ? pageIndex * pageSize + 1 : 0;
  const lastItem = total ? Math.min(total, (pageIndex + 1) * pageSize) : 0;
  const canGoPrevious = pageIndex > 0 && !loading;
  const canGoNext = pageIndex + 1 < pageCount && !loading;
  return <div className={`pagination ${className}`.trim()} aria-label={ariaLabel}>
    <div className="pagination__summary">
      <span>Showing <b>{firstItem}–{lastItem}</b> of <b>{total}</b></span>
      <label className="pagination__page-size"><span>Items per page</span><select aria-label="Items per page" value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>{pageSizeOptions.map((size) => <option value={size} key={size}>{size}</option>)}</select></label>
    </div>
    <div className="pagination__controls">
      <button type="button" disabled={!canGoPrevious} title={canGoPrevious ? "Go to the previous page" : loading ? "Previous page is unavailable while loading" : "You are already on the first page"} aria-label={canGoPrevious ? "Previous page" : loading ? "Previous page unavailable while loading" : "Previous page unavailable: first page"} onClick={() => onPageChange(pageIndex - 1)}>Previous</button>
      <b aria-live="polite">Page {currentPage} of {pageCount}</b>
      <button type="button" disabled={!canGoNext} title={canGoNext ? "Go to the next page" : loading ? "Next page is unavailable while loading" : "You are already on the last page"} aria-label={canGoNext ? "Next page" : loading ? "Next page unavailable while loading" : "Next page unavailable: last page"} onClick={() => onPageChange(pageIndex + 1)}>Next</button>
    </div>
  </div>;
}

function relativeTime(value?: string | null) {
  if (!value) return "No observations";
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function eventLabel(type: StoredEvent["eventType"]) {
  return {
    load_assigned: "Marked full",
    batch_out: "Departed",
    batch_in: "Arrived",
    emptied: "Marked empty"
  }[type];
}

function containerTypeLabel(value?: string | null) {
  return value ? humanizeCode(value) : "Container";
}

function priorPhysicalLocationId(event: StoredEvent, data: OperationsData) {
  const transitLocationIds = new Set(data.fixtures.locations.filter((location) => location.type === "in_transit").map((location) => location.locationId));
  return data.events
    .filter((candidate) => candidate.containerId === event.containerId && candidate.eventId !== event.eventId && Date.parse(candidate.effectiveAt) < Date.parse(event.effectiveAt) && !transitLocationIds.has(candidate.locationId))
    .sort((left, right) => Date.parse(right.effectiveAt) - Date.parse(left.effectiveAt) || Date.parse(right.receivedAt) - Date.parse(left.receivedAt))[0]?.locationId ?? null;
}

function eventNarrative(event: StoredEvent, data: OperationsData) {
  const container = data.fixtures.containers.find((item) => item.containerId === event.containerId);
  const subject = containerTypeLabel(container?.type);
  const locationFor = (locationId: string | null | undefined) => data.fixtures.locations.find((item) => item.locationId === locationId)?.name;
  const location = locationFor(event.locationId) ?? "an unconfirmed location";
  if (event.eventType === "load_assigned") return `${subject} marked full at ${location}.`;
  if (event.eventType === "batch_in") {
    const source = locationFor(payloadLocationId(event, "sourceLocationId"));
    return `${subject} arrived at ${location}${source ? ` from ${source}` : ""}.`;
  }
  if (event.eventType === "emptied") return `${subject} marked empty at ${location}.`;
  if (event.eventType === "batch_out") {
    const origin = locationFor(payloadLocationId(event, "sourceLocationId") ?? priorPhysicalLocationId(event, data));
    const destination = locationFor(payloadLocationId(event, "destinationLocationId"));
    if (origin && destination) return `${subject} left ${origin} and is in transit to ${destination}.`;
    if (destination) return `${subject} is in transit to ${destination}.`;
    return `${subject} left ${origin ?? "its last confirmed location"}; destination not recorded.`;
  }
  return `${subject} observed at ${location}.`;
}

function LocationTypeIcon({ location, size = 18 }: { location: Location; size?: number }) {
  const Icon = location.type === "warehouse" ? Warehouse : location.type === "donation_express" ? HandHeart : Store;
  return <Icon size={size} aria-hidden="true" />;
}

// The UUID remains the database key.  This short number is the operator-facing
// scanner label for the pilot, where fewer than 100,000 devices are expected.
function scannerNumber(deviceId: string) {
  const numericTail = Number.parseInt(deviceId.split("-").at(-1) ?? "", 10);
  return Number.isFinite(numericTail) ? String(numericTail).padStart(5, "0") : "00000";
}

function versionIsOlder(version: string | null, required?: string | null) {
  if (!required) return false;
  if (!version) return true;
  const parse = (value: string) => value.replace(/^v/i, "").split(".").map((item) => Number.parseInt(item, 10) || 0);
  const actual = parse(version);
  const target = parse(required);
  for (let index = 0; index < Math.max(actual.length, target.length); index += 1) {
    if ((actual[index] ?? 0) !== (target[index] ?? 0)) return (actual[index] ?? 0) < (target[index] ?? 0);
  }
  return false;
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const content = rows
    .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
    const input = document.createElement("textarea");
    input.value = value;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.focus();
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    return copied;
  } catch {
    return false;
  }
}

function CopyValueButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="detail-copy-button" type="button" onClick={() => void copyText(value).then((success) => { if (success) { setCopied(true); window.setTimeout(() => setCopied(false), 1600); } })}>
    <ClipboardCheck size={14} /> {copied ? "Copied" : label}
  </button>;
}

function DetailDrawer({ detail, onClose }: { detail: DetailView; onClose: () => void }) {
  return (
    <>
      <button className="detail-scrim" onClick={onClose} aria-label="Close details" />
      <aside className="detail-drawer" role="dialog" aria-modal="true" aria-label={detail.title}>
        <div className="detail-drawer__header">
          <div className="detail-drawer__heading">
            <div className="detail-drawer__heading-top"><span className="detail-drawer__icon">{detail.icon ?? <ShieldCheck size={18} />}</span><span className="eyebrow">{detail.eyebrow}</span>{detail.status && <Pill tone={detail.status.tone}>{detail.status.label}</Pill>}</div>
            <h2>{detail.title}</h2>
            {detail.summary && <p>{detail.summary}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close details"><X size={18} /></button>
        </div>
        {detail.recordId && <div className="detail-drawer__record"><div><span>{detail.recordIdLabel ?? "Record ID"}</span><code>{detail.recordId}</code></div><CopyValueButton value={detail.recordId} label="Copy ID" /></div>}
        {detail.actions && <div className="detail-drawer__actions">{detail.actions}</div>}
        <div className="detail-drawer__body">{detail.body}</div>
      </aside>
    </>
  );
}

function DetailFacts({ items }: { items: readonly [string, ReactNode][] }) {
  return <dl className="detail-facts">{items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function humanizeDetailKey(key: string) {
  const aliases: Record<string, string> = {
    device_label: "Scanner name",
    label: "Scanner name",
    assigned_location_id: "Assigned location",
    assignedLocationId: "Assigned location",
    is_active: "Availability",
    isActive: "Availability",
    required_app_version: "Required app version",
    requiredAppVersion: "Required app version",
    assignmentReason: "Move reason",
    impactLevel: "Correction impact",
    proposedCorrection: "Proposed correction",
    revokedOtherSessions: "Other sessions",
    displayLoadCode: "Load code",
    goodsType: "Goods category",
    secondaryValue: "Classification",
    destinationLocationId: "Destination",
    notes: "Message for operations",
    message: "Message for operations",
    operatorMessage: "Message for operations"
  };
  if (aliases[key]) return aliases[key];
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function humanizeDetailValue(key: string, value: unknown, data?: OperationsData): string {
  if (value === null || value === undefined || value === "") return "Not recorded";
  if (typeof value === "boolean") {
    if (key === "is_active" || key === "isActive") return value ? "Enabled" : "Disabled";
    if (key === "revokedOtherSessions") return value ? "Revoked" : "Kept active";
    return value ? "Yes" : "No";
  }
  if (typeof value === "number" || typeof value === "string") {
    const text = String(value);
    if (data && (key === "assigned_location_id" || key === "assignedLocationId" || key === "locationId" || key === "destinationLocationId")) {
      const location = data.fixtures.locations.find((item) => item.locationId === text);
      if (location) return location.name;
    }
    if (data && (key === "deviceId" || key === "device_id")) {
      const device = data.fixtures.devices.find((item) => item.deviceId === text);
      if (device) return `${scannerNumber(text)} · ${device.label}`;
    }
    if (data && (key === "containerId" || key === "container_id")) {
      const container = data.fixtures.containers.find((item) => item.containerId === text);
      if (container) return container.label;
    }
    if (key === "health") return projectionHealthLabel(text as Projection["health"]);
    if (key === "loadState" || key === "load_state") return loadStateLabel(text as Projection["loadState"]);
    if (key === "accuracyFlag" || key === "accuracyFlags" || key === "warning" || key === "warnings") return accuracyFlagDetail(text);
    if (key === "source") return text.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    if (key === "impactLevel") return text === "material" ? "Material change" : "Routine change";
    return text;
  }
  if (Array.isArray(value)) return value.map((item) => humanizeDetailValue(key, item, data)).join(", ");
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([nestedKey, nestedValue]) => `${humanizeDetailKey(nestedKey)}: ${humanizeDetailValue(nestedKey, nestedValue, data)}`)
      .join(" · ");
  }
  return String(value);
}

function detailChangeRows(details: Record<string, unknown>, data?: OperationsData): [string, ReactNode][] {
  const before = isRecord(details.before) ? details.before : {};
  const after = isRecord(details.after) ? details.after : {};
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  return keys
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => [humanizeDetailKey(key), `${humanizeDetailValue(key, before[key], data)} → ${humanizeDetailValue(key, after[key], data)}`]);
}

function ReadableDetails({ details, data, emptyLabel = "No additional details were recorded." }: { details: Record<string, unknown>; data?: OperationsData; emptyLabel?: string }) {
  const changes = detailChangeRows(details, data);
  const fields = Object.entries(details)
    .filter(([key]) => key !== "before" && key !== "after")
    .map(([key, value]) => [humanizeDetailKey(key), humanizeDetailValue(key, value, data)] as [string, ReactNode]);
  if (changes.length === 0 && fields.length === 0) return <p className="detail-empty-note">{emptyLabel}</p>;
  return <div className="readable-details">
    {changes.length > 0 && <><span className="readable-details__label">Recorded changes</span><DetailFacts items={changes} /></>}
    {fields.length > 0 && <><span className="readable-details__label">Additional context</span><DetailFacts items={fields} /></>}
  </div>;
}

function humanizeDetailsText(details: Record<string, unknown>, data?: OperationsData) {
  const changes = detailChangeRows(details, data).map(([label, value]) => `${label}: ${String(value)}`);
  const fields = Object.entries(details)
    .filter(([key]) => key !== "before" && key !== "after")
    .map(([key, value]) => `${humanizeDetailKey(key)}: ${humanizeDetailValue(key, value, data)}`);
  return [...changes, ...fields].join(" · ");
}

function eventPayloadFacts(event: StoredEvent, data: OperationsData): [string, ReactNode][] {
  return Object.entries(event.payload)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => [humanizeDetailKey(key), humanizeDetailValue(key, value, data)] as [string, ReactNode]);
}

function eventMessage(event: StoredEvent): string | null {
  const candidates = [event.payload.notes, event.payload.message, event.payload.operatorMessage];
  const message = candidates.find((value): value is string => typeof value === "string" && value.trim().length > 0);
  return message?.trim() ?? null;
}

function EventEvidence({ events, data }: { events: StoredEvent[]; data: OperationsData }) {
  return <div className="detail-events">{events.length ? events.map((event) => <article key={event.eventId}>
    <div><span className="detail-event__label"><Pill tone={event.accuracyFlags.length ? "warn" : "blue"}>{eventLabel(event.eventType)}</Pill>{event.accuracyFlags.length ? <span className="detail-event__warning-count">{event.accuracyFlags.length} warning{event.accuracyFlags.length === 1 ? "" : "s"}</span> : <span className="detail-event__verified"><CheckCircle2 size={12} /> no warnings</span>}</span><time>{new Date(event.eventAt).toLocaleString()}</time></div>
    <strong>{eventNarrative(event, data)}</strong>
    <span className="detail-event__id">{event.eventId} <CopyValueButton value={event.eventId} label="Copy" /></span>
    {eventMessage(event) && <div className="detail-event__message"><MessageSquare size={14} /><span><b>Message for operations</b><em>{eventMessage(event)}</em></span></div>}
    <small>{event.accuracyFlags.length ? event.accuracyFlags.map(accuracyFlagDetail).join(" · ") : "No data-quality warnings were recorded."}</small>
    <details className="detail-event__more"><summary>View scan details</summary><DetailFacts items={[["Device", `${scannerNumber(event.deviceId)} · ${data.fixtures.devices.find((device) => device.deviceId === event.deviceId)?.label ?? "Unknown scanner"}`], ["Scanner record number", String(event.deviceSequence)], ["Observed", new Date(event.eventAt).toLocaleString()], ["Received", new Date(event.receivedAt).toLocaleString()], ["Effective", new Date(event.effectiveAt).toLocaleString()]]}/>{eventPayloadFacts(event, data).length > 0 ? <><span className="readable-details__label">Scan information</span><DetailFacts items={eventPayloadFacts(event, data)} /></> : <p className="detail-empty-note">No additional scan information was recorded.</p>}</details>
  </article>) : <EmptyState>No observations have been recorded for this item.</EmptyState>}</div>;
}

export function App() {
  const [route, setRoute] = useState<AppRoute>(routeFromHash);
  const page = route.page;
  const locationId = route.locationId;
  const locationFilter = route.locationFilter;
  const [data, setData] = useState<OperationsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [detail, setDetail] = useState<DetailView | null>(null);
  const [session, setSession] = useState<AdminSession | null>(() => {
    try {
      const stored = sessionStorage.getItem("stacktrack.admin.session");
      return stored ? JSON.parse(stored) as AdminSession : null;
    } catch { return null; }
  });
  // The pilot console opens on the sign-in surface. A user may close it only
  // to inspect read-only operational data; all administrative writes stay
  // locked until the API verifies a session.
  const [signInOpen, setSignInOpen] = useState(() => !session);
  const searchRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!session) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setData(await loadOperationsData(session));
      setError(null);
      setLastRefresh(new Date());
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.status === 401) {
        sessionStorage.removeItem("stacktrack.admin.session");
        setSession(null); setData(null); setError(null);
        return;
      }
      setError(caught instanceof Error ? caught.message : "Could not connect to the local API.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void refresh();
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [refresh]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") setDetail(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const setPage = (next: Page) => {
    window.location.hash = `/${next}`;
    setRoute({ page: next });
    setDetail(null);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openLocation = (nextLocationId: string, nextFilter?: LocationInventoryFilter) => {
    if (!nextLocationId) return;
    const params = new URLSearchParams();
    if (nextFilter?.containerType) params.set("containerType", nextFilter.containerType);
    if (nextFilter?.goodsType) params.set("goodsType", nextFilter.goodsType);
    if (nextFilter?.loadState) params.set("loadState", nextFilter.loadState);
    if (nextFilter?.bucket) params.set("bucket", nextFilter.bucket);
    const queryString = params.toString();
    window.location.hash = `/locations/${encodeURIComponent(nextLocationId)}${queryString ? `?${queryString}` : ""}`;
    setRoute({ page: "locations", locationId: nextLocationId, ...(nextFilter && Object.keys(nextFilter).length ? { locationFilter: nextFilter } : {}) });
    setDetail(null);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const establishSession = (next: AdminSession) => {
    sessionStorage.setItem("stacktrack.admin.session", JSON.stringify(next));
    setSession(next);
    setSignInOpen(false);
  };
  const signOut = async () => {
    try { if (session) await revokeAdminSession(session); }
    catch { /* Clearing this browser session is still the safe client outcome. */ }
    finally { sessionStorage.removeItem("stacktrack.admin.session"); setSession(null); setData(null); }
  };
  const markPasswordChanged = () => {
    if (!session) return;
    const next = { ...session, principal: { ...session.principal, mustChangePassword: false } };
    sessionStorage.setItem("stacktrack.admin.session", JSON.stringify(next));
    setSession(next);
  };

  const selectedLocationName = data && locationId
    ? data.fixtures.locations.find((item) => item.locationId === locationId)?.name
    : undefined;
  const selected = page === "locations" && locationId && selectedLocationName
    ? { eyebrow: "Location workspace", title: selectedLocationName, description: "A focused operating picture for this site: containers, handoffs, scanners, reviews, and local activity." }
    : pageTitles[page];
  const reviewCount = data
    ? Object.values(data.projections).filter((projection) => projection?.health === "needs_review").length
    : 0;
  const correctionCount = data
    ? data.correctionRequests.filter((item) => item.status === "pending").length
    : 0;
  const isCloudEnvironment = !(
    API_URL.includes("127.0.0.1") || API_URL.includes("localhost")
  );
  const connectionState = loading
    ? "checking"
    : error
      ? "disconnected"
      : data?.warnings.length
        ? "degraded"
        : "connected";
  const connectionLabel = connectionState === "checking"
    ? "Checking Azure API"
    : connectionState === "disconnected"
      ? "API disconnected"
      : connectionState === "degraded"
        ? "API connected with warnings"
        : API_URL.includes("127.0.0.1") || API_URL.includes("localhost")
          ? "API connected"
          : "Cloud API connected";

  if (!session) {
    return <div className="authentication-shell"><SignInDialog onClose={() => undefined} onSuccess={establishSession} /></div>;
  }

  // Temporary passwords are one-time credentials. Keep operational data out
  // of the browser until its holder replaces the administrator-issued value.
  if (session.principal.mustChangePassword) {
    return <div className="authentication-shell"><AccountSecurity session={session} required onPasswordChanged={markPasswordChanged} onSignOut={signOut} /></div>;
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "sidebar--open" : ""}`}>
        <button className="sidebar-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">
          <X />
        </button>
        <Mark />
        <div className="sidebar__site">
          <span>Current organization</span>
          <button onClick={() => setDetail({
            eyebrow: "Environment",
            title: "Goodwill operations",
            body: <><p className="detail-lead">The organization workspace for container movement, scanner administration, and governed operational decisions.</p><DetailFacts items={[["Organization", data?.fixtures.tenant.name ?? "Goodwill Operations"], ["Data service", isCloudEnvironment ? "Cloud PostgreSQL service" : "PostgreSQL service"], ["Authentication", "Server-verified administrator session"]]}/></>
          })}>
            <span className="site-dot">M</span>
            <span><strong>Goodwill Operations</strong><small>Container tracking workspace</small></span>
            <ChevronRight size={16} />
          </button>
        </div>
        <nav>
          <span className="nav-label">OPERATIONS</span>
          {nav.map((item) => (
            <button
              key={item.page}
              className={page === item.page ? "active" : ""}
              onClick={() => setPage(item.page)}
            >
              <item.icon size={19} strokeWidth={1.9} />
              <span>{item.label}</span>
              {item.page === "exceptions" && reviewCount > 0 && <b>{reviewCount}</b>}
              {item.page === "corrections" && correctionCount > 0 && <b>{correctionCount}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar__bottom">
          <button onClick={() => setPage("settings")} className={page === "settings" ? "active" : ""}>
            <Settings size={19} /><span>Settings</span>
          </button>
          {isCloudEnvironment ? (
            <button onClick={() => setDetail({
              eyebrow: "Field operations",
              title: "Open the Android scanner",
              body: <><p className="detail-lead">The React Native scanner runs on a provisioned handheld or emulator and reports directly to the StackTrack service. The admin website does not embed the scanner UI.</p><DetailFacts items={[["Launcher", "Mobile scanner application"], ["Service", "StackTrack operations API"], ["Device identity", "Scanner ID 00001"], ["Admin verification", "Devices page"]]}/></>
            })}>
              <MonitorSmartphone size={19} /><span>Mobile scanner guide</span><ChevronRight size={14} />
            </button>
          ) : (
            <a href="http://127.0.0.1:8082" target="_blank" rel="noreferrer">
              <MonitorSmartphone size={19} /><span>Open mobile preview</span><ExternalLink size={14} />
            </a>
          )}
          <button className="user-card" onClick={() => session ? setDetail({
            eyebrow: "Signed-in profile", title: session.principal.displayName, icon: <UserRound size={18} />, status: { label: roleLabel(session.principal.role), tone: session.principal.role === "organization_owner" ? "blue" : "good" }, summary: "Your verified administrator identity and current browser session.", recordId: session.principal.userId, recordIdLabel: "Administrator ID",
            body: <><p className="detail-lead">This session is verified by the StackTrack API and expires automatically. Every administrative change is attributed to this account.</p><h3 className="detail-section-title">Account access</h3><DetailFacts items={[["Username", session.principal.username], ["Role", roleLabel(session.principal.role)], ["Scope", session.principal.role === "organization_owner" ? "Goodwill-wide full control" : session.principal.role === "location_manager" ? `${session.principal.locationIds?.length ?? 0} assigned operating locations` : "All operating locations"]]}/><h3 className="detail-section-title">Session security</h3><div className="profile-security-card"><CheckCircle2 size={18}/><div><strong>Server-verified session</strong><span>Expires {new Date(session.expiresAt).toLocaleString()}</span><small>Signing out revokes this browser session on the server.</small></div></div><div className="detail-danger-zone"><div><strong>End this session</strong><p>Sign out when you leave this workstation. You can sign back in with your administrator account.</p></div><button className="danger-button" onClick={() => void signOut()}>Sign out</button></div></>
          }) : setSignInOpen(true)}>
            <span className="avatar">{session ? initials(session.principal.displayName) : "?"}</span>
            <span><strong>{session ? session.principal.displayName : "Admin sign in"}</strong><small>{session ? roleLabel(session.principal.role) : "Operational changes locked"}</small></span>
            <ChevronRight size={16} />
          </button>
        </div>
      </aside>
      {menuOpen && <button className="scrim" onClick={() => setMenuOpen(false)} aria-label="Close menu" />}

      <main>
        <header className="topbar">
          <button className="menu-button" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu /></button>
          <Mark compact />
          <div className="topbar__right">
            <span className={`connection connection--${connectionState}`}>
              <i /> {connectionLabel}
            </span>
            <button className="icon-button" onClick={() => void refresh()} aria-label="Refresh data">
              <RefreshCw size={18} className={loading ? "spin" : ""} />
            </button>
          </div>
        </header>

        <div className="content">
          <section className="page-heading">
            <div>
              <span className="eyebrow">{selected.eyebrow}</span>
              <h1>{selected.title}</h1>
              <p>{selected.description}</p>
            </div>
            <div className="page-actions">
              <div className="search">
                <Search size={18} />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={page === "audit" ? "Use the audit filters below" : page === "activity" ? "Search container, event, scanner, or location" : page === "loads" ? "Search load code, container, goods, or location" : page === "devices" ? "Search scanner ID or location" : page === "corrections" ? "Search container or requester" : page === "containers" ? "Search container label or ID" : "Search label or code"}
                  aria-label="Search"
                />
                <kbd>⌘ K</kbd>
              </div>
              <button className="secondary" onClick={() => void refresh()}><RefreshCw size={17} /> Refresh</button>
            </div>
          </section>

          {error && (
            <div className="api-error">
              <Cloud size={22} />
              <span><strong>The operations service request failed.</strong> {error}</span>
              <button onClick={() => void refresh()}>Try again</button>
            </div>
          )}
          {!error && data && data.warnings.length > 0 && (
            <div className="api-error api-error--warning">
              <AlertTriangle size={22} />
              <span>
                <strong>Core operations are connected, but {data.warnings.length === 1 ? "one supporting feed is" : `${data.warnings.length} supporting feeds are`} unavailable.</strong>
                {" "}{data.warnings.map((warning) => warning.message).join(" ")}
              </span>
              <button onClick={() => void refresh()}>Retry</button>
            </div>
          )}

          {loading && !data ? (
            <div className="loading-grid">{[1, 2, 3, 4].map((item) => <div key={item} className="skeleton" />)}</div>
          ) : data ? (
             <PageContent page={page} {...(locationId ? { locationId } : {})} {...(locationFilter ? { locationFilter } : {})} data={data} query={query} setQuery={setQuery} setPage={setPage} openLocation={openLocation} openDetail={setDetail} refresh={refresh} session={session} onRequestSignIn={() => setSignInOpen(true)} onPasswordChanged={markPasswordChanged} onSignOut={signOut} />
          ) : <div className="loading-grid">{[1, 2, 3, 4].map((item) => <div key={item} className="skeleton" />)}</div>}
        </div>
        <footer>
          <span><ShieldCheck size={15} /> Governed operations console · append-only audit foundation</span>
          <span>Goodwill operations · immutable event history</span>
          <span>Last refreshed {lastRefresh.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
        </footer>
      </main>
      {detail && <DetailDrawer detail={detail} onClose={() => setDetail(null)} />}
      {signInOpen && <SignInDialog onClose={() => setSignInOpen(false)} onSuccess={establishSession} />}
    </div>
  );
}

function initials(value: string) { return value.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function roleLabel(role: AdminPrincipal["role"]) { return { organization_owner: "Organization Owner", operations_administrator: "Operations Administrator", location_manager: "Location Manager", read_only_reviewer: "Read-only Reviewer", support: "Time-limited Support" }[role]; }

function SignInDialog({ onClose: _onClose, onSuccess }: { onClose: () => void; onSuccess: (session: AdminSession) => void }) {
  const [username, setUsername] = useState("root"); const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(null); try { onSuccess(await signIn(username, password)); } catch (caught) { setError(caught instanceof Error ? caught.message : "Sign-in failed."); } finally { setBusy(false); } };
  return <section className="sign-in-dialog" role="dialog" aria-modal="true" aria-label="Administrator sign in"><div className="sign-in-dialog__brand"><Mark /></div><div className="sign-in-dialog__icon"><ShieldCheck size={25}/></div><span className="eyebrow">SECURE ADMIN ACCESS</span><h2>Sign in to view operations.</h2><p>Container, route, device, and report data stays unavailable until the StackTrack API verifies an approved account.</p><div className="sign-in-dialog__trust"><span><CheckCircle2 size={14}/> Server-verified access</span><span><ShieldCheck size={14}/> Audit-ready changes</span></div><form onSubmit={(event) => void submit(event)}><label>Username<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <div className="sign-in-error">{error}</div>}<button className="primary" disabled={busy || !username.trim() || !password} type="submit">{busy ? "Signing in…" : "Sign in"}</button></form><small>Use your approved Goodwill administrator account. Access is recorded and expires automatically.</small></section>;
}

function PageContent({
  page,
  locationId,
  locationFilter,
  data,
  query,
  setQuery,
  setPage,
  openLocation,
  openDetail,
  refresh,
  session,
  onRequestSignIn,
  onPasswordChanged,
  onSignOut
}: {
  page: Page;
  locationId?: string | undefined;
  locationFilter?: LocationInventoryFilter;
  data: OperationsData;
  query: string;
  setQuery: (query: string) => void;
  setPage: (page: Page) => void;
  openLocation: (locationId: string, filter?: LocationInventoryFilter) => void;
  openDetail: OpenDetail;
  refresh: () => Promise<void>;
  session: AdminSession | null;
  onRequestSignIn: () => void;
  onPasswordChanged: () => void;
  onSignOut: () => Promise<void>;
}) {
  if (page === "dashboard") return <Dashboard data={data} setPage={setPage} openLocation={openLocation} />;
  if (page === "inventory") return <InventoryPage data={data} setPage={setPage} openLocation={openLocation} />;
  if (page === "service") return <ServicePlanPage data={data} openLocation={openLocation} />;
  if (page === "forecast") return <WarehouseForecastPage data={data} openLocation={openLocation} />;
  if (page === "containers") return <ContainersPage data={data} query={query} openDetail={openDetail} openLocation={openLocation} setPage={setPage} />;
  if (page === "loads") return <LoadsPage data={data} query={query} openDetail={openDetail} />;
  if (page === "locations") return <LocationsPage data={data} {...(locationId ? { focusedLocationId: locationId } : {})} {...(locationFilter ? { focusedLocationFilter: locationFilter } : {})} openLocation={openLocation} openDetail={openDetail} setPage={setPage} session={session} />;
  if (page === "exceptions") return <ExceptionsPage data={data} openDetail={openDetail} session={session!} refresh={refresh} />;
  if (page === "corrections") return <CorrectionsPage data={data} query={query} session={session!} refresh={refresh} />;
  if (page === "activity") return <ActivityPage data={data} query={query} openDetail={openDetail} setPage={setPage} />;
  if (page === "audit") return <AuditTrailPage data={data} session={session!} openDetail={openDetail} />;
  if (page === "devices") return <DevicesPage data={data} query={query} setQuery={setQuery} openDetail={openDetail} refresh={refresh} session={session} onRequestSignIn={onRequestSignIn} />;
  if (page === "reports") return <ReportsPage data={data} openDetail={openDetail} />;
  return <SettingsPage data={data} setPage={setPage} session={session} refresh={refresh} onRequestSignIn={onRequestSignIn} onPasswordChanged={onPasswordChanged} onSignOut={onSignOut} />;
}

function InventoryPage({ data, setPage, openLocation }: { data: OperationsData; setPage: (page: Page) => void; openLocation: (locationId: string) => void }) {
  return <div className="inventory-page"><DashboardInventoryMatrix data={data} setPage={setPage} openLocation={openLocation} /></div>;
}

function buildInventorySnapshotRecords(data: OperationsData): InventorySnapshotRecord[] {
  const unknownLocation = data.fixtures.locations.find((location) => isUnknownLocation(location)) ?? null;
  const unknownKey = "__unknown_inventory_location__";
  const locationById = new Map(data.fixtures.locations.map((location) => [location.locationId, location]));
  const latestLoadByContainer = new Map<string, StoredEvent>();
  const loadByCode = new Map<string, StoredEvent>();
  data.events
    .filter((event) => event.eventType === "load_assigned")
    .sort((left, right) => Date.parse(left.eventAt) - Date.parse(right.eventAt))
    .forEach((event) => {
      latestLoadByContainer.set(event.containerId, event);
      if (event.loadCodeId) loadByCode.set(event.loadCodeId, event);
    });
  return data.fixtures.containers.map<InventorySnapshotRecord>((container) => {
    const projection = data.projections[container.containerId];
    const loadEvent = projection?.activeLoadCodeId
      ? loadByCode.get(projection.activeLoadCodeId) ?? latestLoadByContainer.get(container.containerId)
      : latestLoadByContainer.get(container.containerId);
    const location = projection?.locationId ? locationById.get(projection.locationId) ?? null : null;
    const locationKey = location && !isUnknownLocation(location) ? location.locationId : unknownKey;
    return {
      container,
      projection,
      locationKey,
      location: locationKey === unknownKey ? unknownLocation : location,
      locationName: locationKey === unknownKey ? "Unknown / unassigned" : location?.name ?? "Unknown / unassigned",
      locationType: locationKey === unknownKey ? "Needs assignment" : location ? locationTypeLabel(location.type) : "Needs assignment",
      goodsType: String(loadEvent?.payload.goodsType ?? "Unclassified"),
      classification: String(loadEvent?.payload.secondaryValue ?? "Not specified")
    };
  });
}

interface WarehouseTrendRow {
  key: string;
  label: string;
  start: Date;
  end: Date;
  donationLoads: number;
  received: number;
  departed: number;
}

function WarehouseInventoryOverview({ data, setPage, openLocation }: { data: OperationsData; setPage: (page: Page) => void; openLocation: (locationId: string, filter?: LocationInventoryFilter) => void }) {
  const records = buildInventorySnapshotRecords(data);
  const warehouses = data.fixtures.locations.filter((location) => location.type === "warehouse" && !isUnknownLocation(location));
  const warehouseRecords = records.filter((record) => record.location?.type === "warehouse");
  const goodsColumns = Array.from(new Set([
    ...data.fixtures.goodsTypes.map((goodsType) => goodsType.name),
    ...warehouseRecords.map((record) => record.goodsType).filter((goodsType) => goodsType !== "Unclassified")
  ]));
  if (warehouseRecords.some((record) => record.goodsType === "Unclassified")) goodsColumns.push("Unclassified");
  const locationRecords = (locationId: string) => warehouseRecords.filter((record) => record.locationKey === locationId);
  const countFor = (items: InventorySnapshotRecord[], goodsType: string) => items.filter((item) => item.goodsType === goodsType).length;
  const typeBreakdown = (items: InventorySnapshotRecord[]) => Array.from(new Set(items.map((item) => containerTypeLabel(item.container.type)))).map((type) => `${type} ${items.filter((item) => containerTypeLabel(item.container.type) === type).length}`).join(" · ");
  const currentTotal = warehouseRecords.length;
  const warehouseIds = new Set(warehouses.map((location) => location.locationId));
  const donationIds = new Set(data.fixtures.locations.filter((location) => location.type === "donation_express").map((location) => location.locationId));
  const eventTimes = data.events.map((event) => Date.parse(event.eventAt)).filter((value) => Number.isFinite(value));
  const referenceNow = new Date(Math.max(Date.now(), ...eventTimes));
  const periodLength = 7 * 24 * 60 * 60 * 1_000;
  const formatPeriodDate = (date: Date) => date.toLocaleDateString([], { month: "numeric", day: "numeric" });
  const trendRows: WarehouseTrendRow[] = [3, 2, 1, 0].map((offset) => {
    const end = new Date(referenceNow.getTime() - offset * periodLength);
    const start = new Date(end.getTime() - periodLength);
    const events = data.events.filter((event) => {
      const timestamp = Date.parse(event.eventAt);
      return timestamp > start.getTime() && timestamp <= end.getTime();
    });
    const donationLoads = events.filter((event) => event.eventType === "load_assigned" && donationIds.has(event.locationId)).length;
    const received = events.filter((event) => event.eventType === "batch_in" && warehouseIds.has(event.locationId)).length;
    const departed = events.filter((event) => {
      if (event.eventType !== "batch_out") return false;
      const sourceId = payloadLocationId(event, "sourceLocationId") ?? priorPhysicalLocationId(event, data);
      return Boolean(sourceId && warehouseIds.has(sourceId));
    }).length;
    return { key: `${start.toISOString()}-${end.toISOString()}`, label: `${formatPeriodDate(start)} – ${formatPeriodDate(end)}`, start, end, donationLoads, received, departed };
  });
  const latestTrend = trendRows.at(-1)!;
  const completedTrend = trendRows.slice(0, -1).filter((row) => row.donationLoads > 0 || row.received > 0 || row.departed > 0);
  const observedTrend = completedTrend.length ? completedTrend : (latestTrend.donationLoads > 0 || latestTrend.received > 0 || latestTrend.departed > 0) ? [latestTrend] : [];
  const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  const expectedDonationLoads = average(observedTrend.map((row) => row.donationLoads));
  const expectedReceipts = average(observedTrend.map((row) => row.received));
  const forecastBasis = completedTrend.length >= 2 ? `Average of ${completedTrend.length} complete seven-day periods` : completedTrend.length === 1 ? "Early signal from one complete seven-day period" : observedTrend.length ? "Provisional signal from the current seven-day period" : "Not enough history yet";
  const exportWarehouseReport = () => downloadCsv("stacktrack-warehouse-inventory-report.csv", [
    ["WAREHOUSE INVENTORY SNAPSHOT"],
    ["Warehouse", ...goodsColumns, "Total containers"],
    ...warehouses.map((warehouse) => {
      const items = locationRecords(warehouse.locationId);
      return [warehouse.name, ...goodsColumns.map((goodsType) => countFor(items, goodsType)), items.length];
    }),
    ["Warehouse total", ...goodsColumns.map((goodsType) => countFor(warehouseRecords, goodsType)), warehouseRecords.length],
    [],
    ["SEVEN-DAY ACTIVITY TREND"],
    ["Period", "Donation loads marked full", "Warehouse receipts", "Warehouse departures", "Net receipts"],
    ...trendRows.map((row) => [row.label, row.donationLoads, row.received, row.departed, row.received - row.departed]),
    [],
    ["Forecast basis", forecastBasis]
  ]);
  const handleWarehouseCellCapture = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    const button = target.closest("button.warehouse-inventory__cell");
    const rowElement = button?.closest("tbody tr");
    if (!button || !rowElement) return;
    const rowIndex = Array.from(rowElement.parentElement?.children ?? []).indexOf(rowElement);
    const warehouse = warehouses[rowIndex];
    const cellIndex = (button.closest("td") as HTMLTableCellElement | null)?.cellIndex ?? -1;
    if (!warehouse || cellIndex < 1 || cellIndex > goodsColumns.length) return;
    event.preventDefault();
    event.stopPropagation();
    openLocation(warehouse.locationId, { goodsType: goodsColumns[cellIndex - 1], bucket: "current" });
  };
  return <section className="panel warehouse-inventory-panel warehouse-inventory-panel--compact" onClickCapture={handleWarehouseCellCapture}>
    <div className="warehouse-inventory__header"><div><span className="eyebrow">Warehouse operations</span><h2>Warehouse inventory &amp; donation flow</h2><p>Current containers at warehouses, recent movement, and a transparent seven-day expectation based on completed scan periods.</p></div><div className="warehouse-inventory__actions"><button type="button" className="secondary" onClick={() => setPage("inventory")}><Layers3 size={15} /> Open company-wide inventory</button><button type="button" className="secondary" onClick={exportWarehouseReport} disabled={!warehouses.length}><Download size={15} /> Export warehouse report</button></div></div>
    <div className="warehouse-inventory__summary"><div><span><Warehouse size={15} />Current warehouse inventory</span><strong>{currentTotal}</strong><small>Containers physically confirmed at warehouses</small></div><div><span><PackageCheck size={15} />Received last 7 days</span><strong>{latestTrend.received}</strong><small>Destination receipts scanned at warehouses</small></div><div><span><HandHeart size={15} />Donation loads last 7 days</span><strong>{latestTrend.donationLoads}</strong><small>Containers marked full at Donation Xpress sites</small></div><div><span><Clock3 size={15} />Expected next 7 days</span><strong>{expectedDonationLoads ?? "—"}</strong><small>{forecastBasis}</small></div></div>
    <div className="warehouse-inventory__table-heading"><div><span className="eyebrow">Current warehouse inventory</span><strong>Containers by goods category</strong><p>Each container is counted once at its latest confirmed warehouse location. The small line in each cell shows the physical container mix.</p></div><span className="warehouse-inventory__scope">{warehouses.length} warehouse{warehouses.length === 1 ? "" : "s"} · {currentTotal} containers</span></div>
    <div className="table-wrap warehouse-inventory__table-wrap"><table className="warehouse-inventory"><thead><tr><th>Warehouse</th>{goodsColumns.map((goodsType) => <th key={goodsType}>{goodsType}</th>)}<th>Total</th></tr></thead><tbody>{warehouses.map((warehouse) => { const items = locationRecords(warehouse.locationId); return <tr key={warehouse.locationId}><th scope="row"><button type="button" className="warehouse-inventory__location" onClick={() => openLocation(warehouse.locationId)}><span className="warehouse-inventory__location-icon"><Warehouse size={15} /></span><span><strong>{warehouse.name}</strong><small>Warehouse</small></span><ChevronRight size={13} /></button></th>{goodsColumns.map((goodsType) => { const goodsItems = items.filter((item) => item.goodsType === goodsType); return <td key={goodsType}>{goodsItems.length ? <button type="button" className="warehouse-inventory__cell" onClick={() => openLocation(warehouse.locationId)} title={`${goodsItems.length} ${goodsType} containers at ${warehouse.name}`}><strong>{goodsItems.length}</strong><small>{typeBreakdown(goodsItems)}</small></button> : <span className="warehouse-inventory__empty">—</span>}</td>; })}<td><button type="button" className="warehouse-inventory__cell warehouse-inventory__cell--total" onClick={() => openLocation(warehouse.locationId)}><strong>{items.length}</strong><small>All categories</small></button></td></tr>; })}</tbody><tfoot><tr><th>Warehouse total</th>{goodsColumns.map((goodsType) => <td key={goodsType}><strong>{countFor(warehouseRecords, goodsType)}</strong></td>)}<td><strong>{warehouseRecords.length}</strong></td></tr></tfoot></table></div>
    <div className="warehouse-trend"><div className="warehouse-trend__header"><div><span className="eyebrow">Donation and warehouse trend</span><strong>What changed over the last four seven-day periods</strong><p>“Donation loads” is a container marked full at a Donation Xpress site. It is a planning proxy, not a count of donated items or dollars.</p></div><div className="warehouse-trend__forecast"><span>Expected warehouse receipts</span><strong>{expectedReceipts ?? "—"}</strong><small>next 7 days · {forecastBasis}</small></div></div><div className="table-wrap"><table className="warehouse-trend__table"><thead><tr><th>Period</th><th>Donation loads</th><th>Warehouse receipts</th><th>Warehouse departures</th><th>Net receipts</th></tr></thead><tbody>{trendRows.map((row) => <tr key={row.key}><th>{row.label}{row.key === latestTrend.key && <small>Current period</small>}</th><td>{row.donationLoads}</td><td>{row.received}</td><td>{row.departed}</td><td className={row.received - row.departed >= 0 ? "positive" : "negative"}>{row.received - row.departed >= 0 ? "+" : ""}{row.received - row.departed}</td></tr>)}</tbody></table></div></div>
    <div className="warehouse-inventory__outlook"><div className="warehouse-inventory__outlook-copy"><span className="eyebrow">Capacity outlook</span><strong>Plan warehouse space and store coverage in one workspace</strong><p>Open the outlook to adjust store minimums and maximums, model major holidays, and see the calculation behind every expected count. The overview keeps only the current inventory picture.</p></div><div className="warehouse-inventory__outlook-stat"><span>Expected warehouse receipts</span><strong>{expectedReceipts ?? "â€”"}</strong><small>next 7 days · {forecastBasis}</small></div><button type="button" className="primary" onClick={() => setPage("forecast")}><TrendingUp size={15} /> Open warehouse outlook</button></div>
    <p className="warehouse-inventory__note">Current counts come from the latest accepted scanner projection. Forecast assumptions live in the Warehouse outlook workspace and never change official scan history.</p>
  </section>;
}

interface WarehouseForecastSettings {
  horizonDays: number;
  targetDays: number;
  safetyStockPercent: number;
  growthPercent: number;
}

interface WarehousePlanningEvent {
  id: string;
  name: string;
  date: string;
  durationDays: number;
  upliftPercent: number;
  warehouseId: string;
  goodsType: string;
}

interface WarehouseForecastSeries {
  label: string;
  receipts: number;
  departures: number;
  donationLoads: number;
  forecast?: boolean;
}

interface WarehouseForecastRow {
  warehouse: Location;
  current: number;
  baselineReceipts: number;
  baselineDepartures: number;
  expectedReceipts: number;
  expectedDepartures: number;
  projectedInventory: number;
  recommendedInventory: number;
  gap: number;
  upliftPercent: number;
  historyWeeks: number;
}

const warehouseForecastSettingsKey = "stacktrack.warehouse.forecast.settings";
const warehouseForecastEventsKey = "stacktrack.warehouse.forecast.events";

function dateAtStart(value: string): Date {
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
  return Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)
    ? new Date(year, month - 1, day)
    : new Date();
}

function dateInputValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1_000);
}

function readWarehouseForecastStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function warehouseForecastId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `planning-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function normalizeWarehouseForecastSettings(value: Partial<WarehouseForecastSettings> | null | undefined, fallback: WarehouseForecastSettings): WarehouseForecastSettings {
  const horizon = Number(value?.horizonDays);
  const target = Number(value?.targetDays);
  const safety = Number(value?.safetyStockPercent);
  const growth = Number(value?.growthPercent);
  return {
    horizonDays: [7, 14, 30].includes(horizon) ? horizon : fallback.horizonDays,
    targetDays: Number.isFinite(target) ? Math.min(90, Math.max(1, target)) : fallback.targetDays,
    safetyStockPercent: Number.isFinite(safety) ? Math.min(100, Math.max(0, safety)) : fallback.safetyStockPercent,
    growthPercent: Number.isFinite(growth) ? Math.min(200, Math.max(-50, growth)) : fallback.growthPercent
  };
}

function normalizeWarehousePlanningEvents(value: unknown): WarehousePlanningEvent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    if (typeof item.name !== "string" || typeof item.date !== "string") return [];
    const duration = Number(item.durationDays);
    const uplift = Number(item.upliftPercent);
    return [{
      id: typeof item.id === "string" && item.id ? item.id : warehouseForecastId(),
      name: item.name.trim().slice(0, 120),
      date: item.date,
      durationDays: Number.isFinite(duration) ? Math.min(90, Math.max(1, duration)) : 7,
      upliftPercent: Number.isFinite(uplift) ? Math.min(300, Math.max(-90, uplift)) : 0,
      warehouseId: typeof item.warehouseId === "string" ? item.warehouseId : "all",
      goodsType: typeof item.goodsType === "string" ? item.goodsType : "all"
    }];
  });
}

function WarehouseForecastPanel({ data, warehouses, warehouseRecords, goodsColumns, openLocation }: { data: OperationsData; warehouses: Location[]; warehouseRecords: InventorySnapshotRecord[]; goodsColumns: string[]; openLocation: (locationId: string, filter?: LocationInventoryFilter) => void }) {
  const today = new Date();
  const defaultSettings: WarehouseForecastSettings = { horizonDays: 7, targetDays: 14, safetyStockPercent: 15, growthPercent: 0 };
  const [settings, setSettings] = useState<WarehouseForecastSettings>(() => normalizeWarehouseForecastSettings(readWarehouseForecastStorage<Partial<WarehouseForecastSettings> | null>(warehouseForecastSettingsKey, null), defaultSettings));
  const [planningEvents, setPlanningEvents] = useState<WarehousePlanningEvent[]>(() => normalizeWarehousePlanningEvents(readWarehouseForecastStorage<unknown>(warehouseForecastEventsKey, [])));
  const [warehouseScope, setWarehouseScope] = useState("all");
  const [goodsScope, setGoodsScope] = useState("all");
  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState(dateInputValue(addDays(today, 30)));
  const [eventDuration, setEventDuration] = useState("7");
  const [eventUplift, setEventUplift] = useState("15");
  const [eventWarehouse, setEventWarehouse] = useState("all");
  const [eventGoods, setEventGoods] = useState("all");
  const [plannerOpen, setPlannerOpen] = useState(false);

  useEffect(() => {
    try { window.localStorage.setItem(warehouseForecastSettingsKey, JSON.stringify(settings)); } catch { /* local planning remains usable if storage is unavailable */ }
    window.dispatchEvent(new CustomEvent("stacktrack:warehouse-forecast-settings", { detail: settings }));
  }, [settings]);
  useEffect(() => {
    try { window.localStorage.setItem(warehouseForecastEventsKey, JSON.stringify(planningEvents)); } catch { /* local planning remains usable if storage is unavailable */ }
  }, [planningEvents]);

  const eventGoodsOptions = Array.from(new Set(["all", ...goodsColumns]));
  const referenceNow = new Date();
  const horizonEnd = addDays(referenceNow, settings.horizonDays);
  const historicalWeeks = 8;
  const warehouseIds = new Set(warehouses.map((warehouse) => warehouse.locationId));
  const eventGoodsType = (event: StoredEvent) => String(event.payload.goodsType ?? "Unclassified");
  const matchesGoodsScope = (event: StoredEvent) => goodsScope === "all" || eventGoodsType(event) === goodsScope;
  const matchesWarehouseScope = (locationId: string) => warehouseScope === "all" || locationId === warehouseScope;
  const history = Array.from({ length: historicalWeeks }, (_, index) => {
    const end = addDays(referenceNow, -index * 7);
    const start = addDays(end, -7);
    const events = data.events.filter((event) => {
      const at = Date.parse(event.eventAt);
      return at > start.getTime() && at <= end.getTime();
    });
    const receipts = events.filter((event) => event.eventType === "batch_in" && warehouseIds.has(event.locationId) && matchesWarehouseScope(event.locationId) && matchesGoodsScope(event)).length;
    const departures = events.filter((event) => {
      if (event.eventType !== "batch_out") return false;
      const sourceId = payloadLocationId(event, "sourceLocationId") ?? priorPhysicalLocationId(event, data);
      return Boolean(sourceId && warehouseIds.has(sourceId) && matchesWarehouseScope(sourceId) && matchesGoodsScope(event));
    }).length;
    const donationLoads = events.filter((event) => event.eventType === "load_assigned" && matchesGoodsScope(event) && data.fixtures.locations.some((location) => location.locationId === event.locationId && location.type === "donation_express")).length;
    return { label: `${dateInputValue(start)} – ${dateInputValue(end)}`, receipts, departures, donationLoads };
  }).reverse();
  const meaningfulHistory = history.filter((row) => row.receipts > 0 || row.departures > 0 || row.donationLoads > 0);
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const activePlanningEvents = planningEvents.filter((event) => {
    const start = dateAtStart(event.date);
    const end = addDays(start, Math.max(1, event.durationDays));
    return end >= referenceNow && start <= horizonEnd;
  });
  const eventAdjustmentFor = (warehouseId: string) => activePlanningEvents
    .filter((event) => event.warehouseId === "all" || event.warehouseId === warehouseId)
    .filter((event) => event.goodsType === "all" || goodsScope === "all" || event.goodsType === goodsScope)
    .reduce((sum, event) => sum + event.upliftPercent, 0);
  const currentFor = (warehouseId: string) => warehouseRecords.filter((record) => record.locationKey === warehouseId && (goodsScope === "all" || record.goodsType === goodsScope)).length;
  const rows: WarehouseForecastRow[] = warehouses
    .filter((warehouse) => warehouseScope === "all" || warehouse.locationId === warehouseScope)
    .map((warehouse) => {
      const warehouseEvents = data.events.filter((event) => {
        const at = Date.parse(event.eventAt);
        return at > addDays(referenceNow, -historicalWeeks * 7).getTime() && at <= referenceNow.getTime() && matchesGoodsScope(event);
      });
      const receiptsByWeek = history.map((row) => row.receipts);
      const departuresByWeek = history.map((row) => row.departures);
      const baselineReceiptsNetwork = average(receiptsByWeek);
      const baselineDeparturesNetwork = average(departuresByWeek);
      const warehouseReceiptEvents = warehouseEvents.filter((event) => event.eventType === "batch_in" && event.locationId === warehouse.locationId);
      const warehouseDepartureEvents = warehouseEvents.filter((event) => {
        if (event.eventType !== "batch_out") return false;
        const sourceId = payloadLocationId(event, "sourceLocationId") ?? priorPhysicalLocationId(event, data);
        return sourceId === warehouse.locationId;
      });
      const scopedReceiptCount = warehouseEvents.filter((event) => event.eventType === "batch_in" && warehouseIds.has(event.locationId) && matchesWarehouseScope(event.locationId)).length;
      const warehouseRatio = warehouseScope === "all" && warehouseIds.size ? Math.max(0.15, warehouseReceiptEvents.length / Math.max(1, scopedReceiptCount)) : 1;
      const baselineReceipts = warehouseReceiptEvents.length ? warehouseReceiptEvents.length / historicalWeeks : baselineReceiptsNetwork * warehouseRatio;
      const baselineDepartures = warehouseDepartureEvents.length ? warehouseDepartureEvents.length / historicalWeeks : baselineDeparturesNetwork * warehouseRatio;
      const upliftPercent = eventAdjustmentFor(warehouse.locationId);
      const multiplier = Math.max(0, 1 + settings.growthPercent / 100 + upliftPercent / 100);
      const expectedReceipts = Math.round(baselineReceipts * multiplier * (settings.horizonDays / 7));
      const expectedDepartures = Math.round(baselineDepartures * multiplier * (settings.horizonDays / 7));
      const current = currentFor(warehouse.locationId);
      const projectedInventory = current + expectedReceipts - expectedDepartures;
      const recommendedInventory = Math.ceil(baselineReceipts * (settings.targetDays / 7) * multiplier * (1 + settings.safetyStockPercent / 100));
      return { warehouse, current, baselineReceipts, baselineDepartures, expectedReceipts, expectedDepartures, projectedInventory, recommendedInventory, gap: recommendedInventory - projectedInventory, upliftPercent, historyWeeks: meaningfulHistory.length };
    });
  const network = rows.reduce((summary, row) => ({ current: summary.current + row.current, expectedReceipts: summary.expectedReceipts + row.expectedReceipts, expectedDepartures: summary.expectedDepartures + row.expectedDepartures, projectedInventory: summary.projectedInventory + row.projectedInventory, recommendedInventory: summary.recommendedInventory + row.recommendedInventory, gap: summary.gap + row.gap }), { current: 0, expectedReceipts: 0, expectedDepartures: 0, projectedInventory: 0, recommendedInventory: 0, gap: 0 });
  const expectedDonationLoads = Math.round(average(history.map((row) => row.donationLoads)) * (settings.horizonDays / 7) * Math.max(0, 1 + settings.growthPercent / 100));
  const series: WarehouseForecastSeries[] = history.map((row): WarehouseForecastSeries => ({ ...row })).concat([{ label: `Next ${settings.horizonDays} days`, receipts: rows.reduce((sum, row) => sum + row.expectedReceipts, 0), departures: rows.reduce((sum, row) => sum + row.expectedDepartures, 0), donationLoads: expectedDonationLoads, forecast: true }]);
  const chartMax = Math.max(1, ...series.map((row) => Math.max(row.receipts, row.departures, row.donationLoads)));
  const forecastConfidence = meaningfulHistory.length >= 8 ? "High" : meaningfulHistory.length >= 4 ? "Medium" : meaningfulHistory.length ? "Early estimate" : "Not enough history";
  const forecastBasis = meaningfulHistory.length ? `${meaningfulHistory.length} active historical week${meaningfulHistory.length === 1 ? "" : "s"}, adjusted for growth, safety stock, and planned events` : "No historical warehouse flow is available yet; enter planning assumptions and collect scans before relying on this forecast";
  const addPlanningEvent = (event: React.FormEvent) => {
    event.preventDefault();
    if (!eventName.trim() || !eventDate) return;
    setPlanningEvents((current) => [...current, { id: warehouseForecastId(), name: eventName.trim().slice(0, 120), date: eventDate, durationDays: Math.min(90, Math.max(1, Number(eventDuration) || 1)), upliftPercent: Math.min(300, Math.max(-90, Number(eventUplift) || 0)), warehouseId: eventWarehouse, goodsType: eventGoods }].sort((left, right) => left.date.localeCompare(right.date)));
    setEventName("");
    setPlannerOpen(false);
  };
  const addPreset = (name: string, month: number, day: number, uplift: number) => {
    const year = today.getMonth() + 1 > month || (today.getMonth() + 1 === month && today.getDate() >= day) ? today.getFullYear() + 1 : today.getFullYear();
    setEventName(name); setEventDate(dateInputValue(new Date(year, month - 1, day))); setEventUplift(String(uplift)); setEventDuration("7"); setEventWarehouse("all"); setEventGoods("all"); setPlannerOpen(true);
  };
  const exportForecast = () => downloadCsv("stacktrack-warehouse-forecast.csv", [
    ["WAREHOUSE INVENTORY FORECAST"],
    ["Forecast horizon (days)", settings.horizonDays],
    ["Target days of cover", settings.targetDays],
    ["Safety stock (%)", settings.safetyStockPercent],
    ["Growth adjustment (%)", settings.growthPercent],
    ["Forecast basis", forecastBasis],
    [],
    ["Warehouse", "Current containers", "Expected receipts", "Expected departures", "Projected inventory", "Recommended inventory", "Capacity gap", "Event uplift (%)"],
    ...rows.map((row) => [row.warehouse.name, row.current, row.expectedReceipts, row.expectedDepartures, row.projectedInventory, row.recommendedInventory, row.gap, row.upliftPercent]),
    [],
    ["Planning events", "Date", "Duration days", "Uplift (%)", "Warehouse", "Goods category"],
    ...planningEvents.map((event) => [event.name, event.date, event.durationDays, event.upliftPercent, event.warehouseId === "all" ? "All warehouses" : warehouses.find((warehouse) => warehouse.locationId === event.warehouseId)?.name ?? event.warehouseId, event.goodsType === "all" ? "All categories" : event.goodsType])
  ]);
  return <section className="panel warehouse-forecast-panel">
    <div className="warehouse-forecast__header"><div><span className="eyebrow">Planning forecast</span><h2>Warehouse capacity outlook</h2><p>Estimate upcoming receipts and recommended on-hand containers using scan history, safety stock, growth, and planned holiday or promotion adjustments.</p></div><div className="warehouse-forecast__actions"><button type="button" className="secondary" onClick={() => setPlannerOpen((value) => !value)}><CalendarDays size={15} /> {plannerOpen ? "Close event planner" : "Plan a holiday or event"}</button><button type="button" className="secondary" onClick={exportForecast} disabled={!rows.length}><Download size={15} /> Export forecast</button></div></div>
    <div className="warehouse-forecast__assumption-note"><Target size={16} /><span><strong>This is a planning estimate, not an official inventory correction.</strong><small>Forecast inputs are saved in this browser only. Scanner observations remain the source of truth and are never changed by a forecast.</small></span><Pill tone={forecastConfidence === "High" ? "good" : forecastConfidence === "Medium" ? "blue" : "warn"}>{forecastConfidence} confidence</Pill></div>
    <div className="warehouse-forecast__controls"><label><span>Warehouse</span><select value={warehouseScope} onChange={(event) => setWarehouseScope(event.target.value)}><option value="all">All warehouses</option>{warehouses.map((warehouse) => <option key={warehouse.locationId} value={warehouse.locationId}>{warehouse.name}</option>)}</select></label><label><span>Goods category</span><select value={goodsScope} onChange={(event) => setGoodsScope(event.target.value)}><option value="all">All categories</option>{goodsColumns.map((goodsType) => <option key={goodsType} value={goodsType}>{goodsType}</option>)}</select></label><label><span>Forecast horizon</span><select value={settings.horizonDays} onChange={(event) => setSettings((current) => ({ ...current, horizonDays: Number(event.target.value) }))}><option value={7}>Next 7 days</option><option value={14}>Next 14 days</option><option value={30}>Next 30 days</option></select></label><label><span>Target days of cover</span><input type="number" min="1" max="90" value={settings.targetDays} onChange={(event) => setSettings((current) => ({ ...current, targetDays: Math.min(90, Math.max(1, Number(event.target.value) || 1)) }))} /></label><label><span>Safety stock %</span><input type="number" min="0" max="100" value={settings.safetyStockPercent} onChange={(event) => setSettings((current) => ({ ...current, safetyStockPercent: Math.min(100, Math.max(0, Number(event.target.value) || 0)) }))} /></label><label><span>Growth adjustment %</span><input type="number" min="-50" max="200" value={settings.growthPercent} onChange={(event) => setSettings((current) => ({ ...current, growthPercent: Math.min(200, Math.max(-50, Number(event.target.value) || 0)) }))} /></label></div>
    <div className="warehouse-forecast__summary"><div><span><Warehouse size={15} />Current on hand</span><strong>{network.current}</strong><small>Containers matching the selected scope</small></div><div><span><TrendingUp size={15} />Expected receipts</span><strong>{network.expectedReceipts}</strong><small>Next {settings.horizonDays} days</small></div><div><span><Boxes size={15} />Recommended on hand</span><strong>{network.recommendedInventory}</strong><small>{settings.targetDays} days of cover plus safety stock</small></div><div className={network.gap > 0 ? "warehouse-forecast__summary-card--attention" : ""}><span><Target size={15} />Planning gap</span><strong>{network.gap > 0 ? `+${network.gap}` : network.gap}</strong><small>{network.gap > 0 ? "Additional containers to plan for" : "Projected inventory meets the target"}</small></div></div>
    <div className="warehouse-forecast__body">
      <div className="warehouse-forecast__table-wrap table-wrap"><table className="warehouse-forecast__table"><thead><tr><th>Warehouse</th><th>Current</th><th>Expected receipts</th><th>Expected departures</th><th>Projected on hand</th><th>Recommended</th><th>Gap</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.warehouse.locationId}><th><button type="button" className="warehouse-forecast__warehouse-link" onClick={() => openLocation(row.warehouse.locationId)}><strong>{row.warehouse.name}</strong><small>Open location workspace</small></button><small className="warehouse-forecast__warehouse-basis">{row.upliftPercent ? `${row.upliftPercent}% event uplift` : "No event adjustment"}</small></th><td>{row.current}</td><td>{row.expectedReceipts}<small>{Math.round(row.baselineReceipts * 10) / 10}/week baseline</small></td><td>{row.expectedDepartures}</td><td>{row.projectedInventory}</td><td>{row.recommendedInventory}</td><td className={row.gap > 0 ? "warehouse-forecast__gap--attention" : "warehouse-forecast__gap--ready"}>{row.gap > 0 ? `+${row.gap}` : row.gap}<small>{row.gap > 0 ? "Plan capacity" : "Within target"}</small></td></tr>) : <tr><td colSpan={7}><div className="warehouse-forecast__empty">Add warehouses and accepted scans to produce a forecast.</div></td></tr>}</tbody></table></div>
      <div className="warehouse-forecast__chart"><div className="warehouse-forecast__chart-heading"><div><span className="eyebrow">Flow history</span><strong>Receipts, departures, and donation loads</strong></div><small>{forecastBasis}{warehouseScope !== "all" ? " · donation loads remain network-wide source activity" : ""}</small></div><div className="warehouse-forecast__chart-list">{series.map((item) => <div className={item.forecast ? "warehouse-forecast__bar-row warehouse-forecast__bar-row--forecast" : "warehouse-forecast__bar-row"} key={item.label}><span>{item.label}</span><div><i title={`Receipts: ${item.receipts}`} style={{ width: `${Math.round((item.receipts / chartMax) * 100)}%` }} /><b title={`Departures: ${item.departures}`} style={{ width: `${Math.round((item.departures / chartMax) * 100)}%` }} /><em title={`Donation loads: ${item.donationLoads}`} style={{ width: `${Math.round((item.donationLoads / chartMax) * 100)}%` }} /></div><strong>{item.receipts} / {item.departures} / {item.donationLoads}</strong></div>)}</div><div className="warehouse-forecast__legend"><span><i className="warehouse-forecast__legend-receipts" />Receipts</span><span><i className="warehouse-forecast__legend-departures" />Departures</span><span><i className="warehouse-forecast__legend-donations" />Donation loads</span></div></div>
    </div>
    {plannerOpen && <form className="warehouse-forecast__planner" onSubmit={addPlanningEvent}><div><span className="eyebrow">Holiday and event planner</span><h3>Add a demand adjustment</h3><p>Use an uplift only when Goodwill expects more or fewer container movements than the scan history suggests.</p><div className="warehouse-forecast__presets"><button type="button" onClick={() => addPreset("Holiday giving season", 12, 1, 20)}>Holiday giving season</button><button type="button" onClick={() => addPreset("Christmas peak", 12, 25, 25)}>Christmas peak</button><button type="button" onClick={() => addPreset("Back-to-school drive", 8, 15, 15)}>Back-to-school</button></div></div><div className="warehouse-forecast__planner-grid"><label>Event name<input required value={eventName} onChange={(event) => setEventName(event.target.value)} placeholder="Thanksgiving donation drive" /></label><label>Start date<input required type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} /></label><label>Duration (days)<input type="number" min="1" max="90" value={eventDuration} onChange={(event) => setEventDuration(event.target.value)} /></label><label>Expected change %<input type="number" min="-90" max="300" value={eventUplift} onChange={(event) => setEventUplift(event.target.value)} /></label><label>Warehouse<select value={eventWarehouse} onChange={(event) => setEventWarehouse(event.target.value)}><option value="all">All warehouses</option>{warehouses.map((warehouse) => <option key={warehouse.locationId} value={warehouse.locationId}>{warehouse.name}</option>)}</select></label><label>Goods category<select value={eventGoods} onChange={(event) => setEventGoods(event.target.value)}>{eventGoodsOptions.map((goodsType) => <option key={goodsType} value={goodsType}>{goodsType === "all" ? "All categories" : goodsType}</option>)}</select></label><div className="warehouse-forecast__planner-actions"><button type="button" className="secondary" onClick={() => setPlannerOpen(false)}>Cancel</button><button type="submit" className="primary"><Plus size={15} /> Add event adjustment</button></div></div></form>}
    <div className="warehouse-forecast__events"><div><span className="eyebrow">Active planning inputs</span><strong>{planningEvents.length ? `${planningEvents.length} event${planningEvents.length === 1 ? "" : "s"} saved` : "No holiday adjustments saved"}</strong><p>These are scenario inputs for planning. They do not alter scan history, projections, or official counts.</p></div>{planningEvents.length ? <div className="warehouse-forecast__event-list">{planningEvents.map((event) => <article key={event.id}><span className="warehouse-forecast__event-icon"><CalendarDays size={15} /></span><span><strong>{event.name}</strong><small>{event.date} · {event.durationDays} days · {event.upliftPercent >= 0 ? "+" : ""}{event.upliftPercent}% · {event.warehouseId === "all" ? "All warehouses" : warehouses.find((warehouse) => warehouse.locationId === event.warehouseId)?.name ?? "Selected warehouse"}{event.goodsType === "all" ? "" : ` · ${event.goodsType}`}</small></span><button type="button" onClick={() => setPlanningEvents((current) => current.filter((item) => item.id !== event.id))} aria-label={`Remove ${event.name}`}><Trash2 size={14} /></button></article>)}</div> : <div className="warehouse-forecast__events-empty">Add a holiday or promotion to make the forecast scenario-specific.</div>}</div>
    <p className="warehouse-forecast__note">Forecast math: historical weekly receipts are adjusted for the selected growth and event uplift, then multiplied by the planning horizon. Recommended on-hand inventory uses the target days of cover plus safety stock. Actual scan data remains authoritative.</p>
  </section>;
}

interface StoreOutlookTarget {
  locationId: string;
  goodsType: string;
  containerType: ServiceContainerType;
  minimumOnHand: number;
  maximumOnHand: number;
}

interface StoreHolidayAdjustment {
  id: string;
  name: string;
  date: string;
  durationDays: number;
  upliftPercent: number;
  locationId: string;
  goodsType: string;
  enabled: boolean;
}

interface StoreOutlookRow {
  store: Location;
  goodsType: string;
  containerType: ServiceContainerType;
  current: number;
  weeklyBaseline: number;
  expected: number;
  recommended: number;
  gap: number;
  target: StoreOutlookTarget;
  holidayUplift: number;
  holidayNames: string[];
}

const storeOutlookTargetsKey = "stacktrack.warehouse.store-outlook.targets";
const storeOutlookHolidaysKey = "stacktrack.warehouse.store-outlook.holidays";

function storeOutlookTargetKey(locationId: string, goodsType: string, containerType: ServiceContainerType): string {
  return `${locationId}::${goodsType}::${containerType}`;
}

function defaultStoreOutlookTarget(location: Location, containerType: ServiceContainerType): StoreOutlookTarget {
  const defaults = serviceDefaultTarget(location, containerType);
  return { locationId: location.locationId, goodsType: "", containerType, minimumOnHand: defaults.minimumOnHand, maximumOnHand: defaults.maximumOnHand };
}

function normalizeStoreOutlookTargets(value: unknown): Record<string, StoreOutlookTarget> {
  if (!value || typeof value !== "object") return {};
  const output: Record<string, StoreOutlookTarget> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, candidate]) => {
    if (!candidate || typeof candidate !== "object") return;
    const item = candidate as Record<string, unknown>;
    if (typeof item.locationId !== "string" || typeof item.goodsType !== "string" || !serviceContainerTypes.includes(item.containerType as ServiceContainerType)) return;
    const minimum = Number(item.minimumOnHand);
    const maximum = Number(item.maximumOnHand);
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return;
    output[key] = { locationId: item.locationId, goodsType: item.goodsType, containerType: item.containerType as ServiceContainerType, minimumOnHand: Math.max(0, Math.min(999, Math.round(minimum))), maximumOnHand: Math.max(0, Math.min(999, Math.round(Math.max(minimum, maximum)))) };
  });
  return output;
}

function defaultStoreHolidayAdjustments(year: number): StoreHolidayAdjustment[] {
  const presets: Array<[string, number, number, number, string]> = [
    ["New Year's Day", 1, 1, -10, "A quieter post-holiday operating day"],
    ["Martin Luther King Jr. Day", 1, 19, -4, "Holiday hours may reduce throughput"],
    ["Valentine's Day", 2, 14, 8, "Seasonal donation and sorting lift"],
    ["Presidents Day", 2, 16, 4, "Long-weekend donation pattern"],
    ["Easter weekend", 4, 5, 10, "Spring donation activity"],
    ["Mother's Day weekend", 5, 10, 8, "Seasonal household donation lift"],
    ["Memorial Day weekend", 5, 25, 8, "Long-weekend donation pattern"],
    ["Juneteenth", 6, 19, -3, "Holiday hours may change throughput"],
    ["Father's Day weekend", 6, 21, 6, "Seasonal household donation lift"],
    ["Independence Day", 7, 4, -5, "Holiday hours may reduce throughput"],
    ["Back-to-school drive", 8, 15, 18, "School and household donation lift"],
    ["Labor Day weekend", 9, 1, 6, "Long-weekend donation pattern"],
    ["Halloween", 10, 31, 4, "Seasonal demand change"],
    ["Veterans Day", 11, 11, -3, "Holiday hours may change throughput"],
    ["Thanksgiving week", 11, 27, -8, "Holiday closures and reduced routes"],
    ["Black Friday weekend", 11, 28, 20, "Post-Thanksgiving donation and retail activity"],
    ["Holiday giving season", 12, 1, 24, "Peak charitable giving period"],
    ["Christmas week", 12, 25, -15, "Holiday closures and reduced routes"],
    ["New Year's Eve", 12, 31, -8, "Shorter holiday operating day"]
  ];
  return presets.map(([name, month, day, uplift]) => ({ id: warehouseForecastId(), name, date: dateInputValue(new Date(year, month - 1, day)), durationDays: name.includes("week") || name.includes("season") ? 7 : 3, upliftPercent: uplift, locationId: "all", goodsType: "all", enabled: true }));
}

function normalizeStoreHolidayAdjustments(value: unknown, fallback: StoreHolidayAdjustment[]): StoreHolidayAdjustment[] {
  if (!Array.isArray(value)) return fallback;
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    if (typeof item.name !== "string" || typeof item.date !== "string") return [];
    const duration = Number(item.durationDays);
    const uplift = Number(item.upliftPercent);
    return [{
      id: typeof item.id === "string" && item.id ? item.id : warehouseForecastId(),
      name: item.name.trim().slice(0, 100),
      date: item.date,
      durationDays: Number.isFinite(duration) ? Math.max(1, Math.min(90, Math.round(duration))) : 3,
      upliftPercent: Number.isFinite(uplift) ? Math.max(-90, Math.min(300, Math.round(uplift))) : 0,
      locationId: typeof item.locationId === "string" ? item.locationId : "all",
      goodsType: typeof item.goodsType === "string" ? item.goodsType : "all",
      enabled: item.enabled !== false
    }];
  });
}

function WarehouseForecastPage({ data, openLocation }: { data: OperationsData; openLocation: (locationId: string, filter?: LocationInventoryFilter) => void }) {
  const records = buildInventorySnapshotRecords(data);
  const warehouses = data.fixtures.locations.filter((location) => location.type === "warehouse" && !isUnknownLocation(location));
  const warehouseRecords = records.filter((record) => record.location?.type === "warehouse");
  const goodsColumns = Array.from(new Set([
    ...data.fixtures.goodsTypes.map((goodsType) => goodsType.name),
    ...records.map((record) => record.goodsType).filter((goodsType) => goodsType !== "Unclassified")
  ]));
  if (records.some((record) => record.goodsType === "Unclassified")) goodsColumns.push("Unclassified");
  return <div className="warehouse-outlook-page">
    <section className="panel warehouse-outlook-page__intro"><div><span className="eyebrow">Planning workspace</span><h2>Capacity decisions with a visible calculation</h2><p>Warehouse outlook is the planning layer for transportation. It estimates demand from accepted scanner history, then lets administrators tune store targets and holiday assumptions without changing official container history.</p></div><div className="warehouse-outlook-page__intro-badges"><Pill tone="blue">Warehouse capacity</Pill><Pill tone="good">Store coverage</Pill><Pill tone="muted">Scenario only</Pill></div></section>
    <WarehouseForecastPanel data={data} warehouses={warehouses} warehouseRecords={warehouseRecords} goodsColumns={goodsColumns} openLocation={openLocation} />
    <StoreCapacityOutlook data={data} records={records} goodsColumns={goodsColumns} />
  </div>;
}

function StoreCapacityOutlook({ data, records, goodsColumns }: { data: OperationsData; records: InventorySnapshotRecord[]; goodsColumns: string[] }) {
  const stores = data.fixtures.locations.filter((location) => location.type === "store_backroom" && !isUnknownLocation(location));
  const containerOptions = serviceContainerTypes;
  const today = new Date();
  const [settings, setSettings] = useState<WarehouseForecastSettings>(() => normalizeWarehouseForecastSettings(readWarehouseForecastStorage<Partial<WarehouseForecastSettings> | null>(warehouseForecastSettingsKey, null), { horizonDays: 7, targetDays: 14, safetyStockPercent: 15, growthPercent: 0 }));
  const [targets, setTargets] = useState<Record<string, StoreOutlookTarget>>(() => normalizeStoreOutlookTargets(readWarehouseForecastStorage<unknown>(storeOutlookTargetsKey, {})));
  const [holidays, setHolidays] = useState<StoreHolidayAdjustment[]>(() => normalizeStoreHolidayAdjustments(readWarehouseForecastStorage<unknown>(storeOutlookHolidaysKey, null), defaultStoreHolidayAdjustments(today.getFullYear())));
  const [storeScope, setStoreScope] = useState("all");
  const [goodsScope, setGoodsScope] = useState("all");
  const [containerScope, setContainerScope] = useState<"all" | ServiceContainerType>("all");
  const [editorStore, setEditorStore] = useState(stores[0]?.locationId ?? "");
  const [editorGoods, setEditorGoods] = useState(goodsColumns[0] ?? "Unclassified");
  const [editorContainer, setEditorContainer] = useState<ServiceContainerType>("bin");
  const [editorMinimum, setEditorMinimum] = useState("6");
  const [editorMaximum, setEditorMaximum] = useState("18");
  const [holidayName, setHolidayName] = useState("");
  const [holidayDate, setHolidayDate] = useState(dateInputValue(addDays(today, 60)));
  const [holidayDuration, setHolidayDuration] = useState("3");
  const [holidayUplift, setHolidayUplift] = useState("10");
  const [holidayLocation, setHolidayLocation] = useState("all");
  const [holidayGoods, setHolidayGoods] = useState("all");

  useEffect(() => { try { window.localStorage.setItem(storeOutlookTargetsKey, JSON.stringify(targets)); } catch { /* local planning remains usable */ } }, [targets]);
  useEffect(() => { try { window.localStorage.setItem(storeOutlookHolidaysKey, JSON.stringify(holidays)); } catch { /* local planning remains usable */ } }, [holidays]);
  useEffect(() => { try { window.localStorage.setItem(warehouseForecastSettingsKey, JSON.stringify(settings)); } catch { /* local planning remains usable */ } window.dispatchEvent(new CustomEvent("stacktrack:warehouse-forecast-settings", { detail: settings })); }, [settings]);
  useEffect(() => {
    const onSettings = (event: Event) => {
      const detail = (event as CustomEvent<Partial<WarehouseForecastSettings>>).detail;
      setSettings((current) => {
        const next = normalizeWarehouseForecastSettings(detail, current);
        return next.horizonDays === current.horizonDays && next.targetDays === current.targetDays && next.safetyStockPercent === current.safetyStockPercent && next.growthPercent === current.growthPercent ? current : next;
      });
    };
    window.addEventListener("stacktrack:warehouse-forecast-settings", onSettings);
    return () => window.removeEventListener("stacktrack:warehouse-forecast-settings", onSettings);
  }, []);
  useEffect(() => {
    const location = stores.find((item) => item.locationId === editorStore);
    const fallback = location ? defaultStoreOutlookTarget(location, editorContainer) : { minimumOnHand: 6, maximumOnHand: 18 };
    const existing = targets[storeOutlookTargetKey(editorStore, editorGoods, editorContainer)];
    setEditorMinimum(String(existing?.minimumOnHand ?? fallback.minimumOnHand));
    setEditorMaximum(String(existing?.maximumOnHand ?? fallback.maximumOnHand));
  }, [editorStore, editorGoods, editorContainer, targets, stores]);

  const referenceNow = new Date(Math.max(Date.now(), ...data.events.map((event) => Date.parse(event.eventAt)).filter(Number.isFinite)));
  const historyWeeks = 8;
  const eventContainerType = (event: StoredEvent) => String(event.payload.containerType ?? data.fixtures.containers.find((container) => container.containerId === event.containerId)?.type ?? "bin");
  const eventGoodsType = (event: StoredEvent) => String(event.payload.goodsType ?? "Unclassified");
  const activeHolidayFor = (storeId: string, goodsType: string) => holidays.filter((holiday) => {
    if (!holiday.enabled || (holiday.locationId !== "all" && holiday.locationId !== storeId) || (holiday.goodsType !== "all" && holiday.goodsType !== goodsType)) return false;
    const start = dateAtStart(holiday.date);
    const end = addDays(start, holiday.durationDays);
    return end >= referenceNow && start <= addDays(referenceNow, settings.horizonDays);
  });
  const rows: StoreOutlookRow[] = stores.flatMap((store) => goodsColumns.flatMap((goodsType) => containerOptions.map((containerType) => {
    const key = storeOutlookTargetKey(store.locationId, goodsType, containerType);
    const fallback = { ...defaultStoreOutlookTarget(store, containerType), goodsType };
    const target = targets[key] ?? fallback;
    const current = records.filter((record) => record.locationKey === store.locationId && record.goodsType === goodsType && record.container.type === containerType).length;
    const historyEvents = data.events.filter((event) => event.locationId === store.locationId && event.eventType === "load_assigned" && eventGoodsType(event) === goodsType && eventContainerType(event) === containerType && Date.parse(event.eventAt) > addDays(referenceNow, -historyWeeks * 7).getTime());
    const weeklyBaseline = historyEvents.length / historyWeeks;
    const holidayEvents = activeHolidayFor(store.locationId, goodsType);
    const holidayUplift = holidayEvents.reduce((sum, event) => sum + event.upliftPercent, 0);
    const multiplier = Math.max(0, 1 + settings.growthPercent / 100 + holidayUplift / 100);
    const expected = Math.round(weeklyBaseline * (settings.horizonDays / 7) * multiplier);
    const recommended = Math.max(target.minimumOnHand, Math.ceil(weeklyBaseline * (settings.targetDays / 7) * multiplier * (1 + settings.safetyStockPercent / 100)));
    return { store, goodsType, containerType, current, weeklyBaseline, expected, recommended, gap: recommended - current, target, holidayUplift, holidayNames: holidayEvents.map((event) => event.name) };
  })));
  const visibleRows = rows.filter((row) => (storeScope === "all" || row.store.locationId === storeScope) && (goodsScope === "all" || row.goodsType === goodsScope) && (containerScope === "all" || row.containerType === containerScope));
  const shortageRows = visibleRows.filter((row) => row.gap > 0);
  const network = visibleRows.reduce((summary, row) => ({ current: summary.current + row.current, expected: summary.expected + row.expected, recommended: summary.recommended + row.recommended, gap: summary.gap + Math.max(0, row.gap) }), { current: 0, expected: 0, recommended: 0, gap: 0 });
  const saveTarget = (event: React.FormEvent) => {
    event.preventDefault();
    const location = stores.find((item) => item.locationId === editorStore);
    if (!location || !editorGoods) return;
    const minimum = Math.max(0, Math.min(999, Math.round(Number(editorMinimum) || 0)));
    const maximum = Math.max(minimum, Math.min(999, Math.round(Number(editorMaximum) || minimum)));
    setTargets((current) => ({ ...current, [storeOutlookTargetKey(editorStore, editorGoods, editorContainer)]: { locationId: editorStore, goodsType: editorGoods, containerType: editorContainer, minimumOnHand: minimum, maximumOnHand: maximum } }));
  };
  const resetTarget = () => setTargets((current) => { const next = { ...current }; delete next[storeOutlookTargetKey(editorStore, editorGoods, editorContainer)]; return next; });
  const addHoliday = (event: React.FormEvent) => {
    event.preventDefault();
    if (!holidayName.trim() || !holidayDate) return;
    setHolidays((current) => [...current, { id: warehouseForecastId(), name: holidayName.trim().slice(0, 100), date: holidayDate, durationDays: Math.max(1, Math.min(90, Number(holidayDuration) || 1)), upliftPercent: Math.max(-90, Math.min(300, Number(holidayUplift) || 0)), locationId: holidayLocation, goodsType: holidayGoods, enabled: true }].sort((left, right) => left.date.localeCompare(right.date)));
    setHolidayName("");
  };
  const updateHoliday = (id: string, patch: Partial<StoreHolidayAdjustment>) => setHolidays((current) => current.map((holiday) => holiday.id === id ? { ...holiday, ...patch } : holiday));
  const exportStoreOutlook = () => downloadCsv(`stacktrack-store-capacity-outlook-${dateInputValue(today)}.csv`, [
    ["STORE CAPACITY OUTLOOK"],
    ["Forecast horizon (days)", settings.horizonDays], ["Target days of cover", settings.targetDays], ["Safety stock (%)", settings.safetyStockPercent], ["Growth adjustment (%)", settings.growthPercent],
    ["Calculation basis", "Accepted load-assignment scans over the last eight seven-day periods; holiday and store target settings are planning inputs."], [],
    ["Store", "Goods category", "Container type", "Current on hand", "Weekly baseline", "Expected movement", "Recommended on hand", "Planning gap", "Minimum", "Maximum", "Holiday adjustment (%)", "Holiday inputs"],
    ...visibleRows.map((row) => [row.store.name, row.goodsType, containerTypeLabel(row.containerType), row.current, Math.round(row.weeklyBaseline * 10) / 10, row.expected, row.recommended, row.gap, row.target.minimumOnHand, row.target.maximumOnHand, row.holidayUplift, row.holidayNames.join("; ")]), [],
    ["HOLIDAY ADJUSTMENTS"], ["Name", "Date", "Duration (days)", "Adjustment (%)", "Location", "Goods category", "Enabled"], ...holidays.map((holiday) => [holiday.name, holiday.date, holiday.durationDays, holiday.upliftPercent, holiday.locationId === "all" ? "All stores" : stores.find((store) => store.locationId === holiday.locationId)?.name ?? holiday.locationId, holiday.goodsType === "all" ? "All categories" : holiday.goodsType, holiday.enabled ? "Yes" : "No"])
  ]);

  return <section className="panel store-outlook-panel">
    <div className="store-outlook__header"><div><span className="eyebrow">Store coverage targets</span><h2>Which stores need crates next?</h2><p>Use store-level minimums and maximums to turn current on-hand counts into a delivery planning queue. This is separate from the warehouse capacity calculation, so transportation can see both sides of the handoff.</p></div><button type="button" className="secondary" onClick={exportStoreOutlook} disabled={!visibleRows.length}><Download size={15} /> Export store outlook</button></div>
    <div className="warehouse-forecast__assumption-note"><Target size={16} /><span><strong>Store targets are editable planning assumptions.</strong><small>Current counts come from accepted scanner projections. Saving a target changes recommendations only; it never rewrites an observation or moves a container.</small></span><Pill tone={shortageRows.length ? "warn" : "good"}>{shortageRows.length ? `${shortageRows.length} rows need planning` : "No current shortages"}</Pill></div>
    <div className="store-outlook__controls"><label><span>Store</span><select value={storeScope} onChange={(event) => setStoreScope(event.target.value)}><option value="all">All stores</option>{stores.map((store) => <option key={store.locationId} value={store.locationId}>{store.name}</option>)}</select></label><label><span>Goods category</span><select value={goodsScope} onChange={(event) => setGoodsScope(event.target.value)}><option value="all">All categories</option>{goodsColumns.map((goodsType) => <option key={goodsType} value={goodsType}>{goodsType}</option>)}</select></label><label><span>Container type</span><select value={containerScope} onChange={(event) => setContainerScope(event.target.value as "all" | ServiceContainerType)}><option value="all">All container types</option>{containerOptions.map((containerType) => <option key={containerType} value={containerType}>{containerTypeLabel(containerType)}</option>)}</select></label><label><span>Forecast horizon</span><select value={settings.horizonDays} onChange={(event) => setSettings((current) => ({ ...current, horizonDays: Number(event.target.value) }))}><option value={7}>Next 7 days</option><option value={14}>Next 14 days</option><option value={30}>Next 30 days</option></select></label><label><span>Target days of cover</span><input type="number" min="1" max="90" value={settings.targetDays} onChange={(event) => setSettings((current) => ({ ...current, targetDays: Math.min(90, Math.max(1, Number(event.target.value) || 1)) }))} /></label><label><span>Safety stock %</span><input type="number" min="0" max="100" value={settings.safetyStockPercent} onChange={(event) => setSettings((current) => ({ ...current, safetyStockPercent: Math.min(100, Math.max(0, Number(event.target.value) || 0)) }))} /></label><label><span>Growth adjustment %</span><input type="number" min="-50" max="200" value={settings.growthPercent} onChange={(event) => setSettings((current) => ({ ...current, growthPercent: Math.min(200, Math.max(-50, Number(event.target.value) || 0)) }))} /></label></div>
    <div className="store-outlook__summary"><div><span><Store size={15} />Stores in scope</span><strong>{new Set(visibleRows.map((row) => row.store.locationId)).size}</strong><small>Locations included by the current filters</small></div><div><span><ContainerIcon size={15} />Current on hand</span><strong>{network.current}</strong><small>Latest accepted projection</small></div><div><span><TrendingUp size={15} />Expected movement</span><strong>{network.expected}</strong><small>Next {settings.horizonDays} days</small></div><div className={network.gap > 0 ? "store-outlook__summary-card--attention" : ""}><span><Target size={15} />Planning gap</span><strong>{network.gap > 0 ? `+${network.gap}` : "0"}</strong><small>{network.gap > 0 ? "Crates to plan for delivery" : "Current on hand meets minimum targets"}</small></div></div>
    <div className="store-outlook__table-wrap table-wrap"><table className="store-outlook__table"><thead><tr><th>Store</th><th>Goods / crate</th><th>Current</th><th>Expected movement</th><th>Recommended on hand</th><th>Target range</th><th>Planning gap</th><th>Holiday input</th><th></th></tr></thead><tbody>{visibleRows.length ? visibleRows.map((row) => <tr key={storeOutlookTargetKey(row.store.locationId, row.goodsType, row.containerType)}><th><strong>{row.store.name}</strong><small>Store</small></th><td><strong>{row.goodsType}</strong><small>{containerTypeLabel(row.containerType)}</small></td><td>{row.current}<small>{Math.round(row.weeklyBaseline * 10) / 10}/week baseline</small></td><td>{row.expected}<small>Next {settings.horizonDays} days</small></td><td><strong>{row.recommended}</strong><small>History + targets + safety stock</small></td><td>{row.target.minimumOnHand}–{row.target.maximumOnHand}</td><td className={row.gap > 0 ? "store-outlook__gap--attention" : "store-outlook__gap--ready"}>{row.gap > 0 ? `+${row.gap}` : "On target"}<small>{row.gap > 0 ? "Plan delivery" : row.current > row.target.maximumOnHand ? "Review excess" : "No action"}</small></td><td>{row.holidayUplift ? <span className="store-outlook__holiday-chip">{row.holidayUplift > 0 ? "+" : ""}{row.holidayUplift}%<small>{row.holidayNames[0]}</small></span> : <span className="store-outlook__no-holiday">No adjustment</span>}</td><td><button type="button" className="secondary" onClick={() => { setEditorStore(row.store.locationId); setEditorGoods(row.goodsType); setEditorContainer(row.containerType); document.querySelector(".store-outlook__target-editor")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>Configure</button></td></tr>) : <tr><td colSpan={9}><EmptyState>No store rows match these filters.</EmptyState></td></tr>}</tbody></table></div>
    <div className="store-outlook__target-editor"><div><span className="eyebrow">Store target setup</span><h3>Set the operating range for a store</h3><p>Use the minimum as the point where a delivery becomes necessary and the maximum as the desired upper buffer. Start with the values Goodwill uses on paper, then tune them with real route history.</p></div><form onSubmit={saveTarget}><label><span>Store</span><select value={editorStore} onChange={(event) => setEditorStore(event.target.value)}>{stores.map((store) => <option value={store.locationId} key={store.locationId}>{store.name}</option>)}</select></label><label><span>Goods category</span><select value={editorGoods} onChange={(event) => setEditorGoods(event.target.value)}>{goodsColumns.map((goodsType) => <option value={goodsType} key={goodsType}>{goodsType}</option>)}</select></label><label><span>Container type</span><select value={editorContainer} onChange={(event) => setEditorContainer(event.target.value as ServiceContainerType)}>{containerOptions.map((containerType) => <option value={containerType} key={containerType}>{containerTypeLabel(containerType)}</option>)}</select></label><label><span>Minimum on hand</span><input type="number" min="0" max="999" value={editorMinimum} onChange={(event) => setEditorMinimum(event.target.value)} /></label><label><span>Maximum on hand</span><input type="number" min="0" max="999" value={editorMaximum} onChange={(event) => setEditorMaximum(event.target.value)} /></label><div className="store-outlook__target-actions"><button type="button" className="secondary" onClick={resetTarget}>Use default</button><button type="submit" className="primary"><Target size={15} /> Save store target</button></div></form></div>
    <div className="store-outlook__holiday-section"><div className="store-outlook__section-heading"><div><span className="eyebrow">Holiday adjustments</span><h3>Make seasonal planning explicit</h3><p>Major holidays are seeded with conservative starting values. Adjust, disable, remove, or add a holiday for every store or a single store. Positive values increase expected movement; negative values reduce it.</p></div><span className="store-outlook__holiday-count">{holidays.filter((holiday) => holiday.enabled).length} active inputs</span></div><form className="store-outlook__holiday-form" onSubmit={addHoliday}><label><span>Holiday or event</span><input required value={holidayName} onChange={(event) => setHolidayName(event.target.value)} placeholder="Community donation drive" /></label><label><span>Start date</span><input required type="date" value={holidayDate} onChange={(event) => setHolidayDate(event.target.value)} /></label><label><span>Duration</span><input type="number" min="1" max="90" value={holidayDuration} onChange={(event) => setHolidayDuration(event.target.value)} /></label><label><span>Expected change %</span><input type="number" min="-90" max="300" value={holidayUplift} onChange={(event) => setHolidayUplift(event.target.value)} /></label><label><span>Store scope</span><select value={holidayLocation} onChange={(event) => setHolidayLocation(event.target.value)}><option value="all">All stores</option>{stores.map((store) => <option value={store.locationId} key={store.locationId}>{store.name}</option>)}</select></label><label><span>Goods scope</span><select value={holidayGoods} onChange={(event) => setHolidayGoods(event.target.value)}><option value="all">All categories</option>{goodsColumns.map((goodsType) => <option value={goodsType} key={goodsType}>{goodsType}</option>)}</select></label><button type="submit" className="primary"><Plus size={15} /> Add adjustment</button></form><div className="store-outlook__holiday-list">{holidays.map((holiday) => <article key={holiday.id} className={holiday.enabled ? "" : "store-outlook__holiday--disabled"}><span className="store-outlook__holiday-icon"><CalendarDays size={15} /></span><div><strong>{holiday.name}</strong><small>{holiday.date} · {holiday.durationDays} day{holiday.durationDays === 1 ? "" : "s"} · {holiday.locationId === "all" ? "All stores" : stores.find((store) => store.locationId === holiday.locationId)?.name ?? "Selected store"} · {holiday.goodsType === "all" ? "All categories" : holiday.goodsType}</small></div><label className="store-outlook__holiday-number"><span>Change %</span><input type="number" min="-90" max="300" value={holiday.upliftPercent} onChange={(event) => updateHoliday(holiday.id, { upliftPercent: Math.max(-90, Math.min(300, Number(event.target.value) || 0)) })} /></label><button type="button" className="secondary" onClick={() => updateHoliday(holiday.id, { enabled: !holiday.enabled })}>{holiday.enabled ? "Disable" : "Enable"}</button><button type="button" className="store-outlook__remove" onClick={() => setHolidays((current) => current.filter((item) => item.id !== holiday.id))} aria-label={`Remove ${holiday.name}`}><Trash2 size={14} /></button></article>)}</div></div>
    <div className="store-outlook__logic"><div><span className="eyebrow">How StackTrack calculates this</span><h3>Every recommendation is explainable</h3><p>The pilot uses accepted scanner observations as a transparent starting point. Once Goodwill supplies historical inventory snapshots, the same structure can be upgraded to seasonality and route-aware forecasting without changing the user workflow.</p></div><div className="store-outlook__logic-grid"><div><b>1</b><span><strong>Historical baseline</strong><small>Count load-assignment scans for the store, goods category, and container type over the last eight seven-day periods, then average them into weekly movement.</small></span></div><div><b>2</b><span><strong>Expected movement</strong><small>Weekly baseline × selected horizon ÷ 7, adjusted by the growth setting and any active holiday inputs for that store.</small></span></div><div><b>3</b><span><strong>Recommended on hand</strong><small>Weekly baseline × target days of cover, increased by the safety-stock percentage, but never below the store minimum.</small></span></div><div><b>4</b><span><strong>Planning gap</strong><small>Recommended on hand − current accepted on-hand count. A positive value is a delivery planning signal; it is not an inventory correction.</small></span></div></div></div>
    <p className="store-outlook__note">These settings are stored in this browser during the pilot. They are deliberately separate from immutable scans and should become organization-level configuration after Goodwill approves the target model, holiday calendar, and historical data source.</p>
  </section>;
}

type ServiceContainerType = (typeof serviceContainerTypes)[number];
type ServicePriority = "critical" | "high" | "watch" | "on_target";
type ServicePriorityFilter = "all" | "action" | "pickup" | "delivery" | "watch" | "on_target";
type ServicePlanMode = "queue" | "targets";

interface ServiceTargetValues {
  minimumOnHand: number;
  maximumOnHand: number;
  minimumEmpty: number;
  maximumFull: number;
}

interface ServiceTargetOverride extends ServiceTargetValues {
  locationId: string;
  goodsType: string;
  containerType: ServiceContainerType;
}

interface ServicePlanRow {
  key: string;
  location: Location;
  goodsType: string;
  containerType: ServiceContainerType;
  full: number;
  empty: number;
  unknown: number;
  total: number;
  target: ServiceTargetValues;
  pickupQty: number;
  deliveryQty: number;
  priority: ServicePriority;
  priorityScore: number;
  action: string;
  reason: string;
}

const serviceContainerTypes = ["bin", "cart", "gaylord"] as const;
const serviceTargetsStorageKey = "stacktrack.service-plan.targets";

function serviceTargetKey(locationId: string, goodsType: string, containerType: ServiceContainerType) {
  return `${locationId}|${goodsType}|${containerType}`;
}

function serviceDefaultTarget(location: Location, containerType: ServiceContainerType): ServiceTargetValues {
  if (location.type === "warehouse") return { minimumOnHand: 0, maximumOnHand: 999, minimumEmpty: 0, maximumFull: 999 };
  const base = containerType === "bin"
    ? location.type === "donation_express" ? { minimumOnHand: 8, maximumOnHand: 24, minimumEmpty: 4, maximumFull: 12 } : { minimumOnHand: 6, maximumOnHand: 18, minimumEmpty: 3, maximumFull: 8 }
    : containerType === "cart"
      ? location.type === "donation_express" ? { minimumOnHand: 4, maximumOnHand: 12, minimumEmpty: 2, maximumFull: 6 } : { minimumOnHand: 3, maximumOnHand: 10, minimumEmpty: 2, maximumFull: 5 }
      : location.type === "donation_express" ? { minimumOnHand: 3, maximumOnHand: 10, minimumEmpty: 2, maximumFull: 5 } : { minimumOnHand: 2, maximumOnHand: 8, minimumEmpty: 1, maximumFull: 4 };
  return base;
}

function normalizeServiceTarget(value: Partial<ServiceTargetValues> | null | undefined, fallback: ServiceTargetValues): ServiceTargetValues {
  const numberOr = (candidate: unknown, defaultValue: number) => Number.isFinite(Number(candidate)) ? Math.min(999, Math.max(0, Number(candidate))) : defaultValue;
  const minimumOnHand = numberOr(value?.minimumOnHand, fallback.minimumOnHand);
  const maximumOnHand = Math.max(minimumOnHand, numberOr(value?.maximumOnHand, fallback.maximumOnHand));
  const minimumEmpty = numberOr(value?.minimumEmpty, fallback.minimumEmpty);
  const maximumFull = Math.max(minimumEmpty, numberOr(value?.maximumFull, fallback.maximumFull));
  return { minimumOnHand, maximumOnHand, minimumEmpty, maximumFull };
}

function readServiceTargetOverrides(value: unknown): Record<string, ServiceTargetOverride> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, ServiceTargetOverride>>((result, [key, candidate]) => {
    if (!candidate || typeof candidate !== "object") return result;
    const item = candidate as Partial<ServiceTargetOverride>;
    if (typeof item.locationId !== "string" || typeof item.goodsType !== "string" || !serviceContainerTypes.includes(item.containerType as ServiceContainerType)) return result;
    const fallback = serviceDefaultTarget({ type: "store_backroom" } as Location, item.containerType as ServiceContainerType);
    result[key] = { locationId: item.locationId, goodsType: item.goodsType, containerType: item.containerType as ServiceContainerType, ...normalizeServiceTarget(item, fallback) };
    return result;
  }, {});
}

function servicePriorityLabel(priority: ServicePriority) {
  return { critical: "Critical", high: "Priority", watch: "Verify data", on_target: "On target" }[priority];
}

function servicePriorityTone(priority: ServicePriority): PillTone {
  return priority === "critical" ? "warn" : priority === "high" ? "blue" : priority === "watch" ? "muted" : "good";
}

function ServicePlanPage({ data, openLocation }: { data: OperationsData; openLocation: (locationId: string, filter?: LocationInventoryFilter) => void }) {
  const records = buildInventorySnapshotRecords(data);
  const locations = data.fixtures.locations.filter((location) => location.isActive !== false && location.type !== "in_transit" && !isUnknownLocation(location));
  const locationById = new Map(locations.map((location) => [location.locationId, location]));
  const goodsTypes = Array.from(new Set([
    ...data.fixtures.goodsTypes.map((goodsType) => goodsType.name),
    ...records.map((record) => record.goodsType)
  ])).filter(Boolean);
  const availableGoodsTypes = goodsTypes.length ? goodsTypes : ["Unclassified"];
  const [serviceDate, setServiceDate] = useState(dateInputValue(new Date()));
  const [mode, setMode] = useState<ServicePlanMode>("queue");
  const [locationFilter, setLocationFilter] = useState("all");
  const [goodsFilter, setGoodsFilter] = useState("all");
  const [containerFilter, setContainerFilter] = useState<"all" | ServiceContainerType>("all");
  const [priorityFilter, setPriorityFilter] = useState<ServicePriorityFilter>("action");
  const [targetOverrides, setTargetOverrides] = useState<Record<string, ServiceTargetOverride>>(() => readServiceTargetOverrides(readWarehouseForecastStorage<unknown>(serviceTargetsStorageKey, {})));
  const [targetLocation, setTargetLocation] = useState(locations[0]?.locationId ?? "");
  const [targetGoods, setTargetGoods] = useState(availableGoodsTypes[0] ?? "Unclassified");
  const [targetContainer, setTargetContainer] = useState<ServiceContainerType>("bin");

  useEffect(() => {
    try { window.localStorage.setItem(serviceTargetsStorageKey, JSON.stringify(targetOverrides)); } catch { /* Target setup remains usable if this browser blocks storage. */ }
  }, [targetOverrides]);

  const targetFor = (location: Location, goodsType: string, containerType: ServiceContainerType): ServiceTargetValues => {
    const key = serviceTargetKey(location.locationId, goodsType, containerType);
    return normalizeServiceTarget(targetOverrides[key], serviceDefaultTarget(location, containerType));
  };
  const combos = new Map<string, { locationId: string; goodsType: string; containerType: ServiceContainerType }>();
  records.forEach((record) => {
    if (!locationById.has(record.locationKey) || !serviceContainerTypes.includes(record.container.type as ServiceContainerType)) return;
    const containerType = record.container.type as ServiceContainerType;
    const key = serviceTargetKey(record.locationKey, record.goodsType, containerType);
    combos.set(key, { locationId: record.locationKey, goodsType: record.goodsType, containerType });
  });
  Object.values(targetOverrides).forEach((target) => {
    if (locationById.has(target.locationId)) combos.set(serviceTargetKey(target.locationId, target.goodsType, target.containerType), { locationId: target.locationId, goodsType: target.goodsType, containerType: target.containerType });
  });

  const rows: ServicePlanRow[] = Array.from(combos.values()).map(({ locationId, goodsType, containerType }) => {
    const location = locationById.get(locationId)!;
    const matching = records.filter((record) => record.locationKey === locationId && record.goodsType === goodsType && record.container.type === containerType);
    const full = matching.filter((record) => record.projection?.loadState === "loaded").length;
    const empty = matching.filter((record) => record.projection?.loadState === "empty").length;
    const unknown = matching.length - full - empty;
    const total = matching.length;
    const target = targetFor(location, goodsType, containerType);
    const pickupQty = Math.min(full, Math.max(0, full - target.maximumFull, total - target.maximumOnHand));
    const deliveryQty = Math.max(0, target.minimumEmpty - empty, target.minimumOnHand - total);
    const priority: ServicePriority = deliveryQty > 0 && (empty === 0 || total < Math.max(1, target.minimumOnHand / 2))
      ? "critical"
      : deliveryQty > 0 || pickupQty > 0
        ? "high"
        : unknown > 0
          ? "watch"
          : "on_target";
    const priorityScore = priority === "critical" ? 4 : priority === "high" ? 3 : priority === "watch" ? 2 : 1;
    const action = pickupQty > 0 && deliveryQty > 0 ? "Pickup + deliver" : pickupQty > 0 ? "Pickup full crates" : deliveryQty > 0 ? "Deliver empty crates" : unknown > 0 ? "Verify count" : "No action";
    const reason = pickupQty > 0 && deliveryQty > 0
      ? `Has ${pickupQty} full ${containerTypeLabel(containerType).toLowerCase()}${pickupQty === 1 ? "" : "s"} ready, but needs ${deliveryQty} empty to stay above its operating minimum.`
      : pickupQty > 0
        ? `${full} full crates are at or above the pickup threshold of ${target.maximumFull}.`
        : deliveryQty > 0
          ? `Only ${empty} empty crates are available; the configured minimum is ${target.minimumEmpty}.`
          : unknown > 0
            ? `${unknown} crate${unknown === 1 ? "" : "s"} has no confirmed full/empty state. Verify before dispatching.`
            : "Current full, empty, and total counts are within the configured limits.";
    return { key: serviceTargetKey(locationId, goodsType, containerType), location, goodsType, containerType, full, empty, unknown, total, target, pickupQty, deliveryQty, priority, priorityScore, action, reason };
  }).sort((left, right) => right.priorityScore - left.priorityScore || left.location.name.localeCompare(right.location.name) || left.goodsType.localeCompare(right.goodsType) || left.containerType.localeCompare(right.containerType));

  const filteredRows = rows.filter((row) => {
    if (locationFilter !== "all" && row.location.locationId !== locationFilter) return false;
    if (goodsFilter !== "all" && row.goodsType !== goodsFilter) return false;
    if (containerFilter !== "all" && row.containerType !== containerFilter) return false;
    return true;
  });
  const priorityMatches = (row: ServicePlanRow) => priorityFilter === "all"
    || (priorityFilter === "action" && (row.pickupQty > 0 || row.deliveryQty > 0))
    || (priorityFilter === "pickup" && row.pickupQty > 0)
    || (priorityFilter === "delivery" && row.deliveryQty > 0)
    || (priorityFilter === "watch" && row.priority === "watch")
    || (priorityFilter === "on_target" && row.priority === "on_target");
  const visibleRows = mode === "queue" ? filteredRows.filter(priorityMatches) : filteredRows;
  const actionRows = rows.filter((row) => row.pickupQty > 0 || row.deliveryQty > 0);
  const pickupRows = actionRows.filter((row) => row.pickupQty > 0);
  const deliveryRows = actionRows.filter((row) => row.deliveryQty > 0);
  const criticalRows = actionRows.filter((row) => row.priority === "critical");
  const unknownRows = rows.filter((row) => row.unknown > 0);
  const pickupStops = new Set(pickupRows.map((row) => row.location.locationId)).size;
  const deliveryStops = new Set(deliveryRows.map((row) => row.location.locationId)).size;
  const pickupTotal = pickupRows.reduce((total, row) => total + row.pickupQty, 0);
  const deliveryTotal = deliveryRows.reduce((total, row) => total + row.deliveryQty, 0);

  const updateTarget = (row: ServicePlanRow, field: keyof ServiceTargetValues, value: string) => {
    const numericValue = Math.min(999, Math.max(0, Number(value) || 0));
    setTargetOverrides((current) => {
      const base = current[row.key] ?? row.target;
      const next = normalizeServiceTarget({ ...base, [field]: numericValue }, row.target);
      return { ...current, [row.key]: { ...next, locationId: row.location.locationId, goodsType: row.goodsType, containerType: row.containerType } };
    });
  };
  const resetTarget = (row: ServicePlanRow) => setTargetOverrides((current) => {
    const next = { ...current };
    delete next[row.key];
    return next;
  });
  const addTarget = (event: React.FormEvent) => {
    event.preventDefault();
    const location = locationById.get(targetLocation);
    if (!location || !targetGoods) return;
    const key = serviceTargetKey(targetLocation, targetGoods, targetContainer);
    setTargetOverrides((current) => current[key] ? current : { ...current, [key]: { ...serviceDefaultTarget(location, targetContainer), locationId: targetLocation, goodsType: targetGoods, containerType: targetContainer } });
    setMode("targets");
    setLocationFilter(targetLocation);
    setGoodsFilter(targetGoods);
    setContainerFilter(targetContainer);
  };
  const exportServicePlan = () => downloadCsv(`stacktrack-service-plan-${serviceDate}.csv`, [
    ["STACKTRACK DAILY SERVICE PLAN"],
    ["Service date", serviceDate],
    ["Snapshot basis", "Latest accepted scanner projection; targets are local planning settings until API-backed configuration is available."],
    [],
    ["Location", "Location type", "Goods category", "Container type", "Full on hand", "Empty on hand", "Unknown state", "Total on hand", "Minimum on hand", "Maximum on hand", "Minimum empty", "Maximum full", "Action", "Priority", "Pickup quantity", "Delivery quantity", "Reason"],
    ...visibleRows.map((row) => [row.location.name, locationTypeLabel(row.location.type), row.goodsType, containerTypeLabel(row.containerType), row.full, row.empty, row.unknown, row.total, row.target.minimumOnHand, row.target.maximumOnHand, row.target.minimumEmpty, row.target.maximumFull, row.action, servicePriorityLabel(row.priority), row.pickupQty, row.deliveryQty, row.reason])
  ]);

  return <div className="service-plan-page">
    <section className="panel service-plan__intro">
      <div className="service-plan__intro-head"><div><span className="eyebrow">Transportation dispatch</span><h2>Daily pickup and delivery priorities</h2><p>Turn each location’s crate targets into a ranked service queue. Full crates above the pickup limit are ready to collect; empty-crate shortages are delivery priorities.</p></div><div className="service-plan__date"><label><span>Service date</span><input type="date" value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} /></label><button type="button" className="secondary" onClick={exportServicePlan} disabled={!visibleRows.length}><Download size={15} /> Export current plan</button></div></div>
      <div className="service-plan__truth"><Target size={17} /><span><strong>Planning layer, not a correction</strong><small>Counts come from the latest accepted scanner projections. The service date labels the report; scheduled route and arrival data will be needed before future dates can be simulated. Target changes are saved in this browser for the pilot and never rewrite scan history.</small></span><Pill tone="blue">Review before dispatch</Pill></div>
    </section>
    <section className="panel service-plan__filters"><div className="service-plan__section-heading"><div><span className="eyebrow">Report scope</span><strong>Choose the locations and crate mix</strong><p>Use the queue to find work for today, or open Target setup to tune each location’s operating limits.</p></div><button type="button" className="secondary" onClick={() => { setLocationFilter("all"); setGoodsFilter("all"); setContainerFilter("all"); setPriorityFilter("action"); }}>Clear filters</button></div><div className="service-plan__filter-grid"><label><span>Location</span><select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}><option value="all">All locations</option>{locations.map((location) => <option value={location.locationId} key={location.locationId}>{location.name}</option>)}</select></label><label><span>Goods category</span><select value={goodsFilter} onChange={(event) => setGoodsFilter(event.target.value)}><option value="all">All categories</option>{availableGoodsTypes.map((goodsType) => <option value={goodsType} key={goodsType}>{goodsType}</option>)}</select></label><label><span>Crate type</span><select value={containerFilter} onChange={(event) => setContainerFilter(event.target.value as "all" | ServiceContainerType)}><option value="all">All crate types</option>{serviceContainerTypes.map((containerType) => <option value={containerType} key={containerType}>{containerTypeLabel(containerType)}</option>)}</select></label><label><span>Queue status</span><select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as ServicePriorityFilter)}><option value="action">Needs service</option><option value="all">All target rows</option><option value="critical">Critical only</option><option value="pickup">Pickup ready</option><option value="delivery">Delivery needed</option><option value="watch">Verify data</option><option value="on_target">On target</option></select></label></div></section>
    <section className="service-plan__summary"><article><span><Truck size={16} />Pickup stops</span><strong>{pickupStops}</strong><small>{pickupTotal} full crate{pickupTotal === 1 ? "" : "s"} ready to collect</small></article><article><span><PackageCheck size={16} />Delivery stops</span><strong>{deliveryStops}</strong><small>{deliveryTotal} empty crate{deliveryTotal === 1 ? "" : "s"} needed</small></article><article><span><AlertTriangle size={16} />Critical shortages</span><strong>{criticalRows.length}</strong><small>Locations with no safe empty-crate buffer</small></article><article><span><CircleHelp size={16} />Data to verify</span><strong>{unknownRows.length}</strong><small>Target rows with an unknown crate state</small></article></section>
    <section className="panel service-plan__workspace"><div className="service-plan__workspace-head"><div><span className="eyebrow">Dispatch worklist</span><h2>{mode === "queue" ? "What transportation should review first" : "Location target setup"}</h2><p>{mode === "queue" ? `${visibleRows.length} matching target row${visibleRows.length === 1 ? "" : "s"} · sorted by shortage and pickup urgency.` : "Set the operating limits that create pickup and delivery recommendations. Start with the targets Goodwill already uses on paper."}</p></div><div className="service-plan__mode-tabs" role="tablist" aria-label="Service plan view"><button type="button" className={mode === "queue" ? "active" : ""} onClick={() => setMode("queue")}>Dispatch queue</button><button type="button" className={mode === "targets" ? "active" : ""} onClick={() => setMode("targets")}>Target setup</button></div></div>
      {mode === "queue" ? <div className="table-wrap service-plan__table-wrap"><table className="service-plan__table"><thead><tr><th>Priority</th><th>Location</th><th>Goods / crate</th><th>On hand</th><th>Configured trigger</th><th>Recommended move</th><th></th></tr></thead><tbody>{visibleRows.length ? visibleRows.map((row) => <tr key={row.key}><td><Pill tone={servicePriorityTone(row.priority)}>{servicePriorityLabel(row.priority)}</Pill></td><th><strong>{row.location.name}</strong><small>{locationTypeLabel(row.location.type)}</small></th><td><strong>{row.goodsType}</strong><small>{containerTypeLabel(row.containerType)}</small></td><td><strong>{row.full} full · {row.empty} empty</strong><small>{row.unknown ? `${row.unknown} state unknown · ` : ""}{row.total} total on hand</small></td><td><strong>{row.target.minimumEmpty} empty min · {row.target.maximumFull} full max</strong><small>{row.target.minimumOnHand}–{row.target.maximumOnHand} total on hand</small></td><td><strong>{row.action}</strong><small>{row.reason}</small>{(row.pickupQty > 0 || row.deliveryQty > 0) && <div className="service-plan__move-chips">{row.pickupQty > 0 && <span className="service-plan__move-chip service-plan__move-chip--pickup">Pick up {row.pickupQty}</span>}{row.deliveryQty > 0 && <span className="service-plan__move-chip service-plan__move-chip--delivery">Deliver {row.deliveryQty}</span>}</div>}</td><td><button type="button" className="secondary service-plan__view-button" onClick={() => openLocation(row.location.locationId, { goodsType: row.goodsType, containerType: row.containerType, bucket: "current" })}>View containers</button></td></tr>) : <tr><td colSpan={7}><div className="service-plan__empty"><CheckCircle2 size={22} /><strong>No service work matches these filters.</strong><span>Every visible target is on target, or the current scanner snapshot has not produced a matching row yet.</span></div></td></tr>}</tbody></table></div> : <div className="service-plan__targets"><form className="service-plan__add-target" onSubmit={addTarget}><div><span className="eyebrow">Add a target row</span><strong>Plan another location / goods / crate combination</strong><small>Use this when a location needs a rule before it has produced a scan.</small></div><label><span>Location</span><select value={targetLocation} onChange={(event) => setTargetLocation(event.target.value)}>{locations.map((location) => <option value={location.locationId} key={location.locationId}>{location.name}</option>)}</select></label><label><span>Goods category</span><select value={targetGoods} onChange={(event) => setTargetGoods(event.target.value)}>{availableGoodsTypes.map((goodsType) => <option value={goodsType} key={goodsType}>{goodsType}</option>)}</select></label><label><span>Crate type</span><select value={targetContainer} onChange={(event) => setTargetContainer(event.target.value as ServiceContainerType)}>{serviceContainerTypes.map((containerType) => <option value={containerType} key={containerType}>{containerTypeLabel(containerType)}</option>)}</select></label><button type="submit" className="primary"><Plus size={15} /> Add target</button></form><div className="table-wrap service-plan__target-table-wrap"><table className="service-plan__table service-plan__target-table"><thead><tr><th>Location</th><th>Goods</th><th>Crate</th><th>Minimum on hand</th><th>Maximum on hand</th><th>Minimum empty</th><th>Maximum full</th><th></th></tr></thead><tbody>{visibleRows.length ? visibleRows.map((row) => <tr key={row.key}><th><strong>{row.location.name}</strong><small>{locationTypeLabel(row.location.type)}</small></th><td>{row.goodsType}</td><td>{containerTypeLabel(row.containerType)}</td>{(["minimumOnHand", "maximumOnHand", "minimumEmpty", "maximumFull"] as const).map((field) => <td key={field}><input aria-label={`${field} for ${row.location.name} ${row.goodsType} ${containerTypeLabel(row.containerType)}`} type="number" min="0" max="999" value={row.target[field]} onChange={(event) => updateTarget(row, field, event.target.value)} /></td>)}<td><button type="button" className="service-plan__reset" onClick={() => resetTarget(row)} disabled={!targetOverrides[row.key]}>{targetOverrides[row.key] ? "Reset default" : "Default"}</button></td></tr>) : <tr><td colSpan={8}><div className="service-plan__empty"><Target size={22} /><strong>No target rows match these filters.</strong><span>Add a target above or broaden the location, goods, and crate filters.</span></div></td></tr>}</tbody></table></div></div>}
      <p className="service-plan__note">The initial defaults are placeholders to make the workflow visible. Goodwill should confirm actual minimums, pickup thresholds, truck capacity, route timing, and whether full crates can be swapped for empties on the same stop before this becomes an automated dispatch instruction.</p>
    </section>
  </div>;
}

function Dashboard({ data, setPage, openLocation }: { data: OperationsData; setPage: (page: Page) => void; openLocation: (locationId: string, filter?: LocationInventoryFilter) => void }) {
  const projections = Object.values(data.projections).filter(Boolean) as Projection[];
  const operatingLocations = data.fixtures.locations.filter((location) => location.type !== "in_transit" && location.isActive !== false && !isUnknownLocation(location));
  const loaded = projections.filter((item) => item.loadState === "loaded").length;
  const transitId = data.fixtures.locations.find((item) => item.type === "in_transit")?.locationId;
  const inTransit = transitId ? projections.filter((item) => item.locationId === transitId).length : 0;
  const review = projections.filter((item) => item.health === "needs_review").length;
  const pendingCorrections = data.correctionRequests.filter(
    (item) => item.status === "pending" || item.status === "reopened"
  );
  const recent = data.events.slice(0, 5);
  const locName = (id: string) => data.fixtures.locations.find((item) => item.locationId === id)?.name ?? "Unknown";
  const container = (id: string) => data.fixtures.containers.find((item) => item.containerId === id);
  const transitItems = projections
    .filter((item) => Boolean(transitId) && item.locationId === transitId)
    .map((projection) => {
      const route = getContainerRouteContext(projection.containerId, data);
      return {
        containerId: projection.containerId,
        label: container(projection.containerId)?.label ?? "Container",
        sourceLocationId: route.activeSegment?.origin?.locationId ?? null,
        destinationLocationId: route.activeSegment?.destination?.locationId ?? null
      };
    });
  const routeMap = new Map<string, DashboardRoute>();
  transitItems.forEach((item) => {
    const key = `${item.sourceLocationId ?? "unknown"}:${item.destinationLocationId ?? "unknown"}`;
    const route = routeMap.get(key) ?? {
      key,
      origin: data.fixtures.locations.find((location) => location.locationId === item.sourceLocationId) ?? null,
      destination: data.fixtures.locations.find((location) => location.locationId === item.destinationLocationId) ?? null,
      items: []
    };
    route.items.push(item);
    routeMap.set(key, route);
  });
  const activeRoutes = [...routeMap.values()].sort((left, right) => right.items.length - left.items.length);
  const transitLabels = transitItems.map((item) => item.label);
  const transitPreview = [
    ...transitLabels.slice(0, 6),
    ...(transitLabels.length > 6
      ? [`+${transitLabels.length - 6} more`]
      : [])
  ].join(", ");
  const activeDevices = data.fixtures.devices.filter((device) => device.isActive);
  const staleDevices = activeDevices.filter((device) => !device.lastReportedAt || Date.now() - Date.parse(device.lastReportedAt) > 24 * 60 * 60 * 1000);
  const observationsLastDay = data.events.filter((event) => Date.now() - Date.parse(event.receivedAt) <= 24 * 60 * 60 * 1000).length;
  const availableLoadCodes = data.events.filter((event) => event.eventType === "load_assigned" && data.projections[event.containerId]?.activeLoadCodeId === event.loadCodeId).length;
  const unobservedContainers = data.fixtures.containers.filter((item) => !data.projections[item.containerId]).length;
  const observedContainers = data.fixtures.containers.length - unobservedContainers;
  const coveragePercent = data.fixtures.containers.length ? Math.round((observedContainers / data.fixtures.containers.length) * 100) : 0;
  const loadedPercent = data.fixtures.containers.length ? Math.round((loaded / data.fixtures.containers.length) * 100) : 0;
  const attentionCount = review + pendingCorrections.length;
  const reviewItems = projections.filter((item) => item.health === "needs_review");

  return (
    <>
      <div className="metric-grid">
        <Metric icon={<ContainerIcon />} label="Tracked containers" value={data.fixtures.containers.length} detail={`${operatingLocations.length} active operating locations`} tone="blue" onClick={() => setPage("containers")} />
        <Metric icon={<PackageCheck />} label="Currently loaded" value={loaded} detail={`${loadedPercent}% of tracked assets`} tone="cyan" onClick={() => setPage("containers")} />
        <Metric icon={<Truck />} label="In transit" value={inTransit} detail="Awaiting destination receipt" tone="navy" onClick={() => setPage("locations")} />
        <Metric icon={<AlertTriangle />} label="Needs attention" value={attentionCount} detail={attentionCount ? `${review} history issue${review === 1 ? "" : "s"} · ${pendingCorrections.length} approval${pendingCorrections.length === 1 ? "" : "s"}` : "No open exceptions"} tone={attentionCount ? "orange" : "green"} onClick={() => setPage("exceptions")} />
      </div>

      <section className="panel operations-pulse">
        <PanelTitle title="Operations pulse" subtitle="Signals that help administrators prioritize today’s work" />
        <div className="pulse-grid">
          <button className="pulse-card pulse-card--blue" onClick={() => setPage("devices")}><span className="pulse-card__icon"><Wifi size={18} /></span><span><small>Scanner coverage</small><strong>{activeDevices.length} of {data.fixtures.devices.length} enabled</strong><em>{staleDevices.length ? `${staleDevices.length} stale report${staleDevices.length === 1 ? "" : "s"} · review Devices` : activeDevices.length ? "All enabled scanners reported recently" : "No scanners are enabled"}</em></span><ChevronRight size={16} /></button>
          <button className="pulse-card pulse-card--cyan" onClick={() => setPage("activity")}><span className="pulse-card__icon"><Activity size={18} /></span><span><small>Recent observations</small><strong>{observationsLastDay} in the last 24 hours</strong><em>{observationsLastDay ? "Open Activity to trace movement and scanner timing" : "No accepted observations in the last 24 hours"}</em></span><ChevronRight size={16} /></button>
          <button className="pulse-card pulse-card--navy" onClick={() => setPage("loads")}><span className="pulse-card__icon"><PackageCheck size={18} /></span><span><small>Load codes ready</small><strong>{availableLoadCodes} available for handoff</strong><em>{availableLoadCodes ? "Open Load codes to select a validated handoff." : "No validated handoff codes are ready."}</em></span><ChevronRight size={16} /></button>
          <button className="pulse-card pulse-card--green" onClick={() => setPage("containers")}><span className="pulse-card__icon"><ContainerIcon size={18} /></span><span><small>Observation coverage</small><strong>{observedContainers} of {data.fixtures.containers.length} observed</strong><em>{unobservedContainers ? `${unobservedContainers} container${unobservedContainers === 1 ? " has" : "s have"} no confirmed history` : `All registered containers have history · ${coveragePercent}% coverage`}</em></span><ChevronRight size={16} /></button>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel network-panel">
          <PanelTitle title="Active route monitor" subtitle={activeRoutes.length ? `${inTransit} container${inTransit === 1 ? "" : "s"} moving across ${activeRoutes.length} active route${activeRoutes.length === 1 ? "" : "s"}` : "No active transfers are waiting for a destination receipt"} action="View all locations" onClick={() => setPage("locations")} />
          {activeRoutes.length ? <div className="dashboard-route-list">{activeRoutes.slice(0, 4).map((route) => {
            const labels = route.items.slice(0, 3).map((item) => item.label).join(", ");
            const remaining = route.items.length - Math.min(route.items.length, 3);
            return <button className="dashboard-route" key={route.key} onClick={() => setPage("locations")} aria-label={`View ${route.items.length} containers moving from ${route.origin?.name ?? "origin pending"} to ${route.destination?.name ?? "destination pending"}`}>
              <span className="dashboard-route__endpoint"><span className="dashboard-route__endpoint-icon">{route.origin ? <LocationTypeIcon location={route.origin} size={17} /> : <MapPin size={17} />}</span><span><strong title={route.origin?.name ?? "Origin pending"}>{route.origin?.name ?? "Origin pending"}</strong><small>{route.origin ? locationTypeLabel(route.origin.type) : "Origin not confirmed"}</small></span></span>
              <span className="dashboard-route__motion"><span className="dashboard-route__status">{route.items.length} moving</span><span className="dashboard-route__track" aria-hidden="true"><i /><b><ContainerIcon size={13} /></b><em /></span><small>{labels}{remaining > 0 ? ` +${remaining} more` : ""}</small></span>
              <span className="dashboard-route__endpoint"><span className="dashboard-route__endpoint-icon dashboard-route__endpoint-icon--destination">{route.destination ? <LocationTypeIcon location={route.destination} size={17} /> : <MapPin size={17} />}</span><span><strong title={route.destination?.name ?? "Destination pending"}>{route.destination?.name ?? "Destination pending"}</strong><small>{route.destination ? locationTypeLabel(route.destination.type) : "Receipt destination pending"}</small></span></span>
              <ChevronRight size={16} />
            </button>;
          })}</div> : <div className="dashboard-route-empty"><span><CheckCircle2 size={20} /></span><div><strong>No containers are currently in transit.</strong><p>All latest valid observations point to a confirmed physical location. New transfers will appear here after a batch-out scan.</p></div></div>}
          {activeRoutes.length > 4 && <p className="dashboard-route-more">+ {activeRoutes.length - 4} additional active routes. Open Locations for the complete network view.</p>}
          <div className={`transit-summary ${inTransit ? "transit-summary--active" : ""}`}>
            <span className="transit-summary__icon"><Truck size={19} /></span>
            <div>
              <strong>{inTransit ? `${inTransit} container${inTransit === 1 ? "" : "s"} currently between locations` : "No containers currently between locations"}</strong>
              <span>{inTransit ? `${transitPreview} remain in transit until a destination receipt is scanned.` : unobservedContainers ? `${unobservedContainers} container${unobservedContainers === 1 ? " has" : "s have"} no accepted observation yet.` : "All tracked containers have a confirmed physical location."}</span>
            </div>
            <Pill tone={inTransit ? "blue" : "good"}>{inTransit ? "Moving" : "Clear"}</Pill>
          </div>
        </section>

        <section className="panel review-panel">
          <PanelTitle title="Attention center" subtitle={attentionCount ? `${attentionCount} item${attentionCount === 1 ? "" : "s"} need a review or approval` : "No open review or approval items"} action="Open queue" onClick={() => setPage("exceptions")} />
          {attentionCount === 0 ? <EmptyState>All container histories are internally consistent.</EmptyState> : (
            <>
            {reviewItems.slice(0, 3).map((item) => {
              const c = container(item.containerId);
              return (
                <button className="review-item" key={item.containerId} onClick={() => setPage("exceptions")}>
                  <span className="review-item__icon"><AlertTriangle size={19} /></span>
                  <span><strong>{c?.label}</strong><small>{item.conflicts[0] ? humanizeCode(item.conflicts[0].reason) : "Review evidence"}</small></span>
                  <Pill tone="warn">Review</Pill>
                  <ChevronRight size={17} />
                </button>
              );
            })}
            {pendingCorrections.slice(0, 4).map((item) => (
              <button className="review-item" key={item.correctionRequestId} onClick={() => setPage("corrections")}>
                <span className="review-item__icon"><FilePenLine size={19} /></span>
                <span><strong>{item.containerLabel}</strong><small>{item.impactLevel} correction requested by {item.requestedByDisplayName}</small></span>
                <Pill tone="warn">Approval</Pill>
                <ChevronRight size={17} />
              </button>
            ))}
            {attentionCount > reviewItems.slice(0, 3).length + Math.min(pendingCorrections.length, 4) && <p className="review-panel__more">More items are waiting in the review queue.</p>}
            </>
          )}
        </section>
      </div>

      <section className="panel">
        <PanelTitle title="Recent activity" subtitle="Newest device observations" action="View full ledger" onClick={() => setPage("activity")} />
        <div className="table-wrap">
         <table className="container-table">
            <thead><tr><th>Container</th><th>Observation</th><th>Location</th><th>Device time</th><th>Accuracy</th></tr></thead>
            <tbody>
              {recent.length === 0 ? <tr><td colSpan={5}><div className="dashboard-table-empty"><CheckCircle2 size={18} /><span><strong>No accepted observations yet</strong><small>New scanner observations will appear here after the first sync.</small></span></div></td></tr> : recent.map((event) => (
                <tr key={event.eventId}>
                  <td><strong>{container(event.containerId)?.label}</strong><small>{container(event.containerId)?.type}</small></td>
                  <td>{eventLabel(event.eventType)}</td>
                  <td>{locName(event.locationId)}</td>
                  <td>{relativeTime(event.eventAt)}</td>
                  <td>{event.accuracyFlags.length ? <Pill tone="warn">Check</Pill> : <Pill tone="good">No warnings</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <WarehouseInventoryOverview data={data} setPage={setPage} openLocation={openLocation} />
    </>
  );
}

type InventoryMatrixMode = "container" | "goods";
type InventoryLocationScope = "network" | "donation_express" | "store_backroom" | "warehouse";

interface InventorySnapshotRecord {
  container: Container;
  projection: Projection | null | undefined;
  locationKey: string;
  location: Location | null;
  locationName: string;
  locationType: string;
  goodsType: string;
  classification: string;
}

interface InventoryMatrixRow {
  key: string;
  location: Location | null;
  locationName: string;
  locationType: string;
  records: InventorySnapshotRecord[];
  isUnknown?: boolean;
}

const inventoryContainerTypes = ["bin", "cart", "gaylord"] as const;

function DashboardInventoryMatrix({ data, setPage, openLocation }: { data: OperationsData; setPage: (page: Page) => void; openLocation: (locationId: string, filter?: LocationInventoryFilter) => void }) {
  const [mode, setMode] = useState<InventoryMatrixMode>("container");
  const [locationScope, setLocationScope] = useState<InventoryLocationScope>("network");
  const [selectedContainerTypes, setSelectedContainerTypes] = useState<string[]>([]);
  const unknownLocation = data.fixtures.locations.find((location) => isUnknownLocation(location)) ?? null;
  const unknownKey = "__unknown_inventory_location__";
  const allRecords = buildInventorySnapshotRecords(data);
  const selectedTypeSet = new Set(selectedContainerTypes);
  const records = allRecords.filter((record) => {
    const typeMatches = selectedTypeSet.size === 0 || selectedTypeSet.has(record.container.type);
    const scopeMatches = locationScope === "network" || record.locationKey === unknownKey || record.location?.type === locationScope;
    return typeMatches && scopeMatches;
  });
  const recordsByLocation = new Map<string, InventorySnapshotRecord[]>();
  records.forEach((record) => recordsByLocation.set(record.locationKey, [...(recordsByLocation.get(record.locationKey) ?? []), record]));
  const locationRows: InventoryMatrixRow[] = data.fixtures.locations
    .filter((location) => !isUnknownLocation(location) && (locationScope === "network" || location.type === locationScope))
    .sort((left, right) => {
      const leftTransit = left.type === "in_transit" ? 1 : 0;
      const rightTransit = right.type === "in_transit" ? 1 : 0;
      return leftTransit - rightTransit || left.name.localeCompare(right.name);
    })
    .map((location) => ({ key: location.locationId, location, locationName: location.name, locationType: locationTypeLabel(location.type), records: recordsByLocation.get(location.locationId) ?? [] }));
  const unknownRecords = recordsByLocation.get(unknownKey) ?? [];
  if (unknownRecords.length > 0) locationRows.push({ key: unknownKey, location: unknownLocation, locationName: "Unknown / unassigned", locationType: "Needs assignment", records: unknownRecords, isUnknown: true });
  const goodsColumns = Array.from(new Set([
    ...data.fixtures.goodsTypes.map((goodsType) => goodsType.name),
    ...records.map((record) => record.goodsType).filter((goodsType) => goodsType !== "Unclassified")
  ]));
  if (records.some((record) => record.goodsType === "Unclassified")) goodsColumns.push("Unclassified");
  const columns = mode === "container"
    ? inventoryContainerTypes.filter((value) => selectedTypeSet.size === 0 || selectedTypeSet.has(value)).map((value) => ({ value, label: containerTypeLabel(value) }))
    : goodsColumns.map((value) => ({ value, label: value }));
  const transitRow = locationRows.find((row) => row.location?.type === "in_transit");
  const unknownRow = locationRows.find((row) => row.isUnknown);
  const physicalCount = records.length - (transitRow?.records.length ?? 0) - (unknownRow?.records.length ?? 0);
  const openRow = (row: InventoryMatrixRow, filter?: LocationInventoryFilter) => row.location && !row.isUnknown && row.location.type !== "in_transit" ? openLocation(row.location.locationId, filter) : setPage("containers");
  const recordsForColumn = (row: InventoryMatrixRow, value: string) => row.records.filter((record) => mode === "container" ? record.container.type === value : record.goodsType === value);
  const statusSummary = (items: InventorySnapshotRecord[]) => {
    const loaded = items.filter((item) => item.projection?.loadState === "loaded").length;
    const empty = items.filter((item) => item.projection?.loadState === "empty").length;
    const unknown = items.length - loaded - empty;
    return [loaded ? `${loaded} loaded` : "", empty ? `${empty} empty` : "", unknown ? `${unknown} not observed` : ""].filter(Boolean).join(" · ");
  };
  const cellDetail = (items: InventorySnapshotRecord[]) => mode === "container"
    ? Array.from(new Set(items.map((item) => item.goodsType))).map((goodsType) => `${goodsType} ${items.filter((item) => item.goodsType === goodsType).length}`).join(" · ")
    : Array.from(new Set(items.map((item) => containerTypeLabel(item.container.type)))).map((type) => `${type} ${items.filter((item) => containerTypeLabel(item.container.type) === type).length}`).join(" · ");
  const scopeLabel = locationScope === "network" ? "All locations" : locationScope === "donation_express" ? "Donation Xpress" : locationScope === "store_backroom" ? "Stores" : "Warehouses";
  const typeLabel = selectedContainerTypes.length ? selectedContainerTypes.map((value) => containerTypeLabel(value)).join(", ") : "All container types";
  const exportInventory = () => downloadCsv(`stacktrack-company-inventory-${locationScope}.csv`, [
    ["Location", "Location type", "Container label", "Container UUID", "Container type", "Goods category", "Classification", "Current state", "History health", "Last observed"],
    ...[...records].sort((left, right) => left.locationName.localeCompare(right.locationName) || left.container.label.localeCompare(right.container.label)).map((record) => [
      record.locationName,
      record.locationType,
      record.container.label,
      record.container.containerId,
      containerTypeLabel(record.container.type),
      record.goodsType,
      record.classification,
      loadStateLabel(record.projection?.loadState),
      projectionHealthLabel(record.projection?.health),
      record.projection?.lastObservedAt ?? ""
    ])
  ]);
  const clearInventoryFilters = () => {
    setLocationScope("network");
    setSelectedContainerTypes([]);
  };
  const handleInventoryCellCapture = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    const button = target.closest("button.inventory-matrix__cell");
    const rowElement = button?.closest("tbody tr");
    if (!button || !rowElement) return;
    const rowIndex = Array.from(rowElement.parentElement?.children ?? []).indexOf(rowElement);
    const row = locationRows[rowIndex];
    const cellIndex = (button.closest("td") as HTMLTableCellElement | null)?.cellIndex ?? -1;
    if (!row || cellIndex < 1 || cellIndex > columns.length) return;
    event.preventDefault();
    event.stopPropagation();
    const column = columns[cellIndex - 1];
    if (!column) return;
    openRow(row, mode === "container"
      ? { containerType: column.value as Container["type"], bucket: "current" }
      : { goodsType: column.value, bucket: "current" });
  };
  return <section className="panel inventory-matrix-panel" onClickCapture={handleInventoryCellCapture}>
    <PanelTitle title="Company-wide inventory" subtitle="Current container inventory by location and category. Each container is counted once using its latest accepted projection." action="View all containers" onClick={() => setPage("containers")} />
    <div className="inventory-matrix__toolbar"><div><span className="eyebrow">Network inventory snapshot</span><p>Use container type for physical capacity planning, or goods category to mirror the inventory report used by Goodwill operations.</p></div><div className="inventory-matrix__actions"><div className="inventory-matrix__modes" role="group" aria-label="Inventory breakdown"><button type="button" className={mode === "container" ? "active" : ""} onClick={() => setMode("container")}><ContainerIcon size={14} /> Container type</button><button type="button" className={mode === "goods" ? "active" : ""} onClick={() => setMode("goods")}><Boxes size={14} /> Goods category</button></div><button type="button" className="secondary" onClick={exportInventory} disabled={!records.length}><Download size={15} /> Excel-ready CSV</button></div></div>
    <div className="inventory-matrix__filters"><label><span>Location scope</span><select value={locationScope} onChange={(event) => setLocationScope(event.target.value as InventoryLocationScope)}><option value="network">All locations</option><option value="donation_express">Donation Xpress</option><option value="store_backroom">Stores</option><option value="warehouse">Warehouses</option></select></label><AuditMultiSelect label="Container types" options={inventoryContainerTypes.map((value) => ({ value, label: containerTypeLabel(value) }))} selected={selectedContainerTypes} onToggle={(value) => setSelectedContainerTypes((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])} onClear={() => setSelectedContainerTypes([])} emptyLabel="All container types" /><div className="inventory-matrix__filter-summary"><strong>{scopeLabel}</strong><span>{typeLabel}</span><small>{records.length} container{records.length === 1 ? "" : "s"} included</small></div><button type="button" className="inventory-matrix__clear" onClick={clearInventoryFilters} disabled={locationScope === "network" && selectedContainerTypes.length === 0}>Clear filters</button></div>
     <div className="inventory-matrix__summary"><div><span><ContainerIcon size={15} />Tracked containers</span><strong>{records.length}</strong><small>{scopeLabel} · {typeLabel}</small></div><div><span><MapPin size={15} />At operating locations</span><strong>{physicalCount}</strong><small>Confirmed physical placement</small></div><div><span><Truck size={15} />In transit</span><strong>{transitRow?.records.length ?? 0}</strong><small>Destination receipt pending</small></div><div><span><CircleHelp size={15} />Unknown / unassigned</span><strong>{unknownRow?.records.length ?? 0}</strong><small>{unknownRow?.records.length ? "Needs location follow-up" : "No current location gaps"}</small></div></div>
     <div className="table-wrap inventory-matrix__table-wrap"><table className="inventory-matrix"><thead><tr><th>Location</th>{columns.map((column) => <th key={column.value}>{column.label}</th>)}<th>Total</th></tr></thead><tbody>{locationRows.map((row) => <tr key={row.key}><th scope="row"><button type="button" className="inventory-matrix__location" onClick={() => openRow(row)}><span className={`inventory-matrix__location-icon ${row.isUnknown ? "inventory-matrix__location-icon--unknown" : row.location ? `inventory-matrix__location-icon--${row.location.type}` : "inventory-matrix__location-icon--unknown"}`}>{row.location && !row.isUnknown ? <LocationTypeIcon location={row.location} size={15} /> : <CircleHelp size={15} />}</span><span><strong>{row.locationName}</strong><small>{row.locationType}{row.location?.isActive === false ? " · Inactive" : ""}</small></span><ChevronRight size={13} /></button></th>{columns.map((column) => { const items = recordsForColumn(row, column.value); return <td key={column.value}>{items.length ? <button type="button" className="inventory-matrix__cell" onClick={() => openRow(row)} title={`${items.length} ${column.label.toLowerCase()} at ${row.locationName}. ${statusSummary(items)}.`}><strong>{items.length}</strong><small>{statusSummary(items)}</small><em>{cellDetail(items)}</em></button> : <span className="inventory-matrix__empty">—</span>}</td>; })}<td><button type="button" className="inventory-matrix__cell inventory-matrix__cell--total" onClick={() => openRow(row)} title={`${row.records.length} containers at ${row.locationName}.`}><strong>{row.records.length}</strong><small>{statusSummary(row.records) || "No current inventory"}</small></button></td></tr>)}</tbody><tfoot><tr><th>Network total</th>{columns.map((column) => <td key={column.value}><strong>{records.filter((record) => mode === "container" ? record.container.type === column.value : record.goodsType === column.value).length}</strong></td>)}<td><strong>{records.length}</strong></td></tr></tfoot></table></div>
    <p className="inventory-matrix__note">Counts reflect the latest accepted scan for each container. “Unknown / unassigned” keeps gaps visible instead of silently dropping them. The export includes one row per container so Excel users can filter or build a pivot table.</p>
  </section>;
}

interface DashboardRoute {
  key: string;
  origin: Location | null;
  destination: Location | null;
  items: { containerId: string; label: string; sourceLocationId: string | null; destinationLocationId: string | null }[];
}

function Metric({ icon, label, value, detail, tone, onClick }: { icon: ReactNode; label: string; value: number; detail: string; tone: string; onClick?: () => void }) {
  const content = <><div className={`metric__icon metric__icon--${tone}`}>{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></>;
  return onClick ? <button type="button" className="metric metric--action" onClick={onClick} aria-label={`${label}: ${value}. ${detail}`}>{content}</button> : <div className="metric">{content}</div>;
}

function PanelTitle({ title, subtitle, action, onClick }: { title: string; subtitle: string; action?: string; onClick?: () => void }) {
  return (
    <div className="panel-title">
      <div><h2>{title}</h2><p>{subtitle}</p></div>
      {action && <button onClick={onClick}>{action}<ChevronRight size={16} /></button>}
    </div>
  );
}

type RouteSegmentStatus = "in_transit" | "received" | "superseded";

interface ContainerRouteSegment {
  segmentId: string;
  departureEventId: string;
  receiptEventId: string | null;
  origin: Location | null;
  destination: Location | null;
  departedAt: string;
  receivedAt: string | null;
  status: RouteSegmentStatus;
}

interface ContainerRouteContext {
  inTransit: boolean;
  currentLocation: Location | null;
  lastConfirmedLocation: Location | null;
  origin: Location | null;
  destination: Location | null;
  departedAt: string | null;
  segments: ContainerRouteSegment[];
  activeSegment: ContainerRouteSegment | null;
  unresolvedSegmentCount: number;
}

function payloadLocationId(event: StoredEvent | undefined, key: "sourceLocationId" | "destinationLocationId") {
  const value = event?.payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Build every handoff so multi-hop journeys remain visible across the admin UI. */
function getContainerRouteContext(containerId: string, data: OperationsData): ContainerRouteContext {
  const transitId = data.fixtures.locations.find((location) => location.type === "in_transit")?.locationId;
  const locationFor = (locationId: string | null | undefined) => data.fixtures.locations.find((location) => location.locationId === locationId) ?? null;
  const projection = data.projections[containerId];
  const events = data.events
    .filter((event) => event.containerId === containerId)
    .sort((left, right) => Date.parse(left.effectiveAt) - Date.parse(right.effectiveAt) || Date.parse(left.receivedAt) - Date.parse(right.receivedAt) || left.eventId.localeCompare(right.eventId));
  let lastPhysicalLocationId: string | null = null;
  const departures: { event: StoredEvent; originId: string | null; destinationId: string | null }[] = [];
  for (const event of events) {
    if (event.eventType === "batch_out") {
      departures.push({
        event,
        originId: payloadLocationId(event, "sourceLocationId") ?? lastPhysicalLocationId,
        destinationId: payloadLocationId(event, "destinationLocationId")
      });
      continue;
    }
    if (event.locationId !== transitId) lastPhysicalLocationId = event.locationId;
  }
  const segments = departures.map((departure, index): ContainerRouteSegment => {
    const nextDepartureAt = departures[index + 1]?.event.effectiveAt;
    const departureTime = Date.parse(departure.event.effectiveAt);
    const nextDepartureTime = nextDepartureAt ? Date.parse(nextDepartureAt) : Number.POSITIVE_INFINITY;
    const receipt = events.find((event) => {
      const eventTime = Date.parse(event.effectiveAt);
      if (event.eventType !== "batch_in" || eventTime < departureTime || eventTime > nextDepartureTime) return false;
      return !departure.destinationId || event.locationId === departure.destinationId;
    });
    return {
      segmentId: `${departure.event.eventId}:${receipt?.eventId ?? "open"}`,
      departureEventId: departure.event.eventId,
      receiptEventId: receipt?.eventId ?? null,
      origin: locationFor(departure.originId),
      destination: locationFor(departure.destinationId),
      departedAt: departure.event.eventAt,
      receivedAt: receipt?.eventAt ?? null,
      status: receipt ? "received" : nextDepartureAt ? "superseded" : "in_transit"
    };
  });
  const latestEvent = events.at(-1);
  const latestPhysicalEvent = [...events].reverse().find((event) => event.locationId !== transitId);
  const currentLocation = locationFor(projection?.locationId);
  const activeSegment = [...segments].reverse().find((segment) => segment.status === "in_transit") ?? null;
  const latestSegment = segments.at(-1) ?? null;
  const routeSegment = activeSegment ?? latestSegment;
  return {
    inTransit: projection?.locationId === transitId,
    currentLocation,
    lastConfirmedLocation: currentLocation?.type === "in_transit" ? locationFor(latestPhysicalEvent?.locationId) : currentLocation,
    origin: routeSegment?.origin ?? locationFor(latestPhysicalEvent?.locationId),
    destination: routeSegment?.destination ?? null,
    departedAt: routeSegment?.departedAt ?? latestEvent?.eventAt ?? null,
    segments,
    activeSegment,
    unresolvedSegmentCount: segments.filter((segment) => segment.status !== "received").length
  };
}

function routeLocationNames(route: ContainerRouteContext): string[] {
  const names: string[] = [];
  for (const segment of route.segments) {
    if (segment.origin?.name && names.at(-1) !== segment.origin.name) names.push(segment.origin.name);
    if (segment.destination?.name && names.at(-1) !== segment.destination.name) names.push(segment.destination.name);
  }
  if (!names.length && route.currentLocation?.name) names.push(route.currentLocation.name);
  return names;
}

function ContainerRouteCell({ route }: { route: ContainerRouteContext }) {
  if (route.inTransit) {
    return (
      <div className="container-route-cell container-route-cell--active">
        <span className="container-route-cell__status"><i aria-hidden="true" /> In transit</span>
        <div className="container-route-cell__path">
          <strong title={route.origin?.name ?? "Origin pending"}>{route.origin?.name ?? "Origin pending"}</strong>
          <span className="container-route-cell__connector" aria-hidden="true"><i /><ArrowRight size={13} /></span>
          <strong title={route.destination?.name ?? "Destination pending"}>{route.destination?.name ?? "Destination pending"}</strong>
        </div>
        <small>Departed {relativeTime(route.departedAt)} · destination receipt pending{route.segments.length > 1 ? ` · hop ${route.segments.length}` : ""}</small>
      </div>
    );
  }

  return (
    <div className="container-location-cell">
      <span className="container-location-cell__icon">{route.currentLocation ? <LocationTypeIcon location={route.currentLocation} size={15} /> : <MapPin size={15} />}</span>
      <div>
        <strong>{route.currentLocation?.name ?? "Not yet observed"}</strong>
        <small>{route.currentLocation ? route.currentLocation.type === "donation_express" ? "Donation Xpress" : route.currentLocation.type === "warehouse" ? "Warehouse" : route.currentLocation.type === "store_backroom" ? "Store" : "In transit" : "No location confirmed"}{route.segments.length > 1 ? ` · ${route.segments.length} handoffs recorded` : ""}</small>
      </div>
    </div>
  );
}

function RouteLocationLink({ location, fallback, onOpenLocation }: { location: Location | null; fallback: string; onOpenLocation: (locationId: string) => void }) {
  if (!location) return <strong>{fallback}</strong>;
  return <button type="button" className="detail-route-summary__location-link" onClick={() => onOpenLocation(location.locationId)} title={`Open ${location.name} location workspace`}><strong>{location.name}</strong><ChevronRight size={13} aria-hidden="true" /></button>;
}

function ContainerRouteSummary({ containerId, data, onOpenLocation }: { containerId: string; data: OperationsData; onOpenLocation: (locationId: string) => void }) {
  const route = getContainerRouteContext(containerId, data);
  const current = data.events.filter((event) => event.containerId === containerId).sort((left, right) => Date.parse(left.effectiveAt) - Date.parse(right.effectiveAt)).at(-1);
  const currentName = route.currentLocation?.name ?? "Not confirmed";
  return <div className={`detail-route-summary ${route.inTransit ? "detail-route-summary--active" : ""}`}>
    <div className="detail-route-summary__heading"><span><Truck size={15} /> Route context</span><Pill tone={route.inTransit ? "blue" : "good"}>{route.inTransit ? "In transit" : "Physical location confirmed"}</Pill></div>
    {route.inTransit && <div className="detail-route-summary__path">
       <div><small>Origin</small><RouteLocationLink location={route.origin} fallback="Origin not confirmed" onOpenLocation={onOpenLocation} /></div>
       <span className="detail-route-summary__connector" aria-hidden="true"><i /><ArrowRight size={16} /></span>
       <div><small>Destination</small><RouteLocationLink location={route.destination} fallback="Destination pending" onOpenLocation={onOpenLocation} /></div>
     </div>}
     {!route.inTransit && route.segments.length > 0 && <div className="detail-route-summary__journey"><small>Recorded journey</small><strong>{routeLocationNames(route).join("  →  ")}</strong></div>}
     {!route.inTransit && route.currentLocation && <button type="button" className="detail-route-summary__workspace-link" onClick={() => onOpenLocation(route.currentLocation!.locationId)}>Open {currentName} location workspace <ChevronRight size={13} aria-hidden="true" /></button>}
    <small className="detail-route-summary__note">{route.inTransit ? `Movement is active from ${route.origin?.name ?? "the last confirmed location"} to ${route.destination?.name ?? "the destination"}. A destination receipt will close this hop.` : current ? `Last authoritative observation: ${eventLabel(current.eventType)} at ${currentName}. ${route.segments.length > 1 ? `${route.segments.length} handoffs are recorded for this container.` : ""}` : "No route observations are recorded yet."}</small>
    {route.unresolvedSegmentCount > 0 && !route.inTransit && <div className="detail-route-summary__warning"><AlertTriangle size={14} /> {route.unresolvedSegmentCount} handoff{route.unresolvedSegmentCount === 1 ? "" : "s"} still lacks a matching receipt.</div>}
  </div>;
}

function LegacyContainersPage({ data, query, openDetail, openLocation, setPage }: { data: OperationsData; query: string; openDetail: OpenDetail; openLocation: (locationId: string) => void; setPage: (page: Page) => void }) {
  const [filter, setFilter] = useState<"all" | "loaded" | "empty" | "unknown">("all");
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  useEffect(() => setPageIndex(0), [query]);
  const locationName = (id: string | null) => data.fixtures.locations.find((item) => item.locationId === id)?.name ?? "Not yet observed";
  const rows = data.fixtures.containers
    // Keep the UUID searchable for support workflows without presenting it in
    // the everyday table. The human-facing label is the unique identifier
    // staff use on printed tags and scanner screens.
    .filter((item) => `${item.label} ${item.containerId}`.toLowerCase().includes(query.toLowerCase()))
    .filter((item) => filter === "all" || (data.projections[item.containerId]?.loadState ?? "unknown") === filter);
  const filterCount = (value: typeof filter) => data.fixtures.containers.filter((item) =>
    value === "all" || (data.projections[item.containerId]?.loadState ?? "unknown") === value
  ).length;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const visibleRows = rows.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize);
  const showContainer = (container: Container) => {
    const projection = data.projections[container.containerId];
    const route = getContainerRouteContext(container.containerId, data);
    openDetail({
      eyebrow: `${container.type} record`,
      title: container.label,
      icon: <ContainerIcon size={18} />,
      status: projection?.health === "needs_review" ? { label: "Needs review", tone: "warn" } : { label: projection?.loadState === "loaded" ? "Loaded" : projection?.loadState === "empty" ? "Empty" : "Not observed", tone: projection?.loadState === "loaded" ? "blue" : projection?.loadState === "empty" ? "good" : "muted" },
      summary: "Immutable container record with current projection, official corrections, and the complete observation history.",
      recordId: container.containerId,
      recordIdLabel: "Container UUID",
      actions: projection?.health === "needs_review" ? <button className="secondary" onClick={() => setPage("exceptions")}><AlertTriangle size={15} /> Open review queue</button> : undefined,
      body: <><DetailFacts items={[
        ["Current state", loadStateLabel(projection?.loadState)],
        ["Movement status", route.inTransit ? "In transit" : "Stationary / location confirmed"],
        ["Route", route.inTransit ? `${route.origin?.name ?? "Origin pending"} → ${route.destination?.name ?? "Destination pending"}` : route.segments.length ? `${route.segments.length} handoff${route.segments.length === 1 ? "" : "s"} recorded` : "No active movement"],
        ["Last known location", route.inTransit ? `In transit · last confirmed ${route.lastConfirmedLocation?.name ?? "not recorded"}` : locationName(projection?.locationId ?? null)],
        ["History health", projectionHealthLabel(projection?.health)],
        ["Official correction", projection?.administrativeCorrection ? `Approved ${new Date(projection.administrativeCorrection.approvedAt).toLocaleString()}` : "None applied"],
        ["Container UUID", container.containerId]
      ]}/><ContainerRouteSummary containerId={container.containerId} data={data} onOpenLocation={openLocation}/>{projection?.administrativeCorrection && <div className="detail-callout"><FilePenLine size={20}/><span><strong>Approved correction by {projection.administrativeCorrection.approvedByDisplayName}:</strong> {projection.administrativeCorrection.reason}. A newer physical scan will automatically supersede this official-state override.</span></div>}<h3 className="detail-section-title">Immutable observation history</h3><EventEvidence events={data.events.filter((event) => event.containerId === container.containerId)} data={data}/></>
    });
  };
  const movementRows = data.fixtures.containers.map((container) => ({ container, route: getContainerRouteContext(container.containerId, data) })).filter((item) => item.route.inTransit);
  const movementGroups = Array.from(new Map(movementRows.map((item) => {
    const key = `${item.route.origin?.locationId ?? "unknown"}:${item.route.destination?.locationId ?? "unknown"}`;
    return [key, { key, origin: item.route.origin, destination: item.route.destination, count: 0, labels: [] as string[], first: item.container }] as const;
  })).values()).map((group) => {
    const matches = movementRows.filter((item) => (item.route.origin?.locationId ?? "unknown") === (group.origin?.locationId ?? "unknown") && (item.route.destination?.locationId ?? "unknown") === (group.destination?.locationId ?? "unknown"));
    return { ...group, count: matches.length, labels: matches.slice(0, 3).map((item) => item.container.label) };
  });
  const exportRows = () => downloadCsv("stacktrack-containers.csv", [
    ["Label", "Type", "State", "Location", "Last observed", "Health"],
    ...rows.map((container) => {
      const projection = data.projections[container.containerId];
      return [
        container.label,
        container.type,
        loadStateLabel(projection?.loadState),
        locationName(projection?.locationId ?? null),
        projection?.lastObservedAt ?? "",
        projectionHealthLabel(projection?.health)
      ];
    })
  ]);
  return (
    <section className="panel">
      <div className="toolbar"><div className="filter-tabs">{(["all", "loaded", "empty", "unknown"] as const).map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => { setFilter(value); setPageIndex(0); }}>{value[0]!.toUpperCase() + value.slice(1)} <b>{filterCount(value)}</b></button>)}</div><div className="container-toolbar-actions"><span className="container-table-note"><CircleHelp size={13} /> Labels are unique; technical ID is in Details.</span><button className="secondary" onClick={exportRows}><Download size={16} /> Export CSV</button></div></div>
      {movementRows.length > 0 && <div className="container-movement-summary">
        <div className="container-movement-summary__intro"><span className="container-movement-summary__icon"><Truck size={20} /></span><div><span className="eyebrow">Movement monitor</span><strong>{movementRows.length} container{movementRows.length === 1 ? "" : "s"} currently in transit</strong><p>Each route shows the last confirmed origin and planned destination. The movement closes when the destination receipt is scanned.</p></div></div>
        <div className="container-movement-summary__routes">{movementGroups.slice(0, 3).map((group) => <button className="container-movement-summary__route" key={group.key} onClick={() => showContainer(group.first)}><span className="container-movement-summary__route-icon"><i /><Truck size={14} /></span><span><strong title={`${group.origin?.name ?? "Origin pending"} to ${group.destination?.name ?? "Destination pending"}`}>{group.origin?.name ?? "Origin pending"} <ArrowRight size={12} /> {group.destination?.name ?? "Destination pending"}</strong><small>{group.count} moving · {group.labels.join(", ")}{group.count > group.labels.length ? ` +${group.count - group.labels.length} more` : ""}</small></span><ChevronRight size={15} /></button>)}{movementGroups.length > 3 && <small className="container-movement-summary__more">+ {movementGroups.length - 3} additional route{movementGroups.length - 3 === 1 ? "" : "s"} in the table below</small>}</div>
      </div>}
      <div className="table-wrap">
        <table className="container-table">
          <thead><tr><th>Container label</th><th>Container type</th><th>Current state</th><th>Position / movement</th><th>Last observed</th><th>History health</th></tr></thead>
          <tbody>{visibleRows.map((container) => {
            const projection = data.projections[container.containerId];
            const route = getContainerRouteContext(container.containerId, data);
            return <tr className="clickable-row" role="button" tabIndex={0} aria-label={`Open details for ${container.label}`} key={container.containerId} onClick={() => showContainer(container)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); showContainer(container); } }}>
              <td><strong className="asset-label" title="Unique container label">{container.label}</strong></td>
              <td className="capitalize">{container.type}</td>
              <td><Pill tone={projection?.loadState === "loaded" ? "blue" : "muted"}>{loadStateLabel(projection?.loadState)}</Pill></td>
              <td><ContainerRouteCell route={route} /></td>
              <td>{relativeTime(projection?.lastObservedAt)}</td>
              <td>{projection?.health === "needs_review" ? <Pill tone="warn">Needs review</Pill> : projection?.administrativeCorrection ? <Pill tone="blue">Corrected</Pill> : projection ? <Pill tone="good">Clean</Pill> : <Pill tone="muted">No history</Pill>}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <PaginationControls pageIndex={pageIndex} pageCount={pageCount} pageSize={pageSize} total={rows.length} ariaLabel="Container pagination" onPageChange={setPageIndex} onPageSizeChange={(nextSize) => { setPageSize(nextSize); setPageIndex(0); }} />
    </section>
  );
}

type ContainerTimeWindow = "all" | "today" | "7d" | "30d";
type ContainerSort = "newest" | "oldest" | "label" | "location" | "health";
type ContainerMovement = "stationary" | "in_transit" | "not_observed";
type ContainerHealth = "clean" | "warning" | "needs_review" | "corrected" | "no_history";
type ContainerMessageFilter = "with_message" | "without_message";

interface ContainerFilters {
  states: Projection["loadState"][];
  types: Container["type"][];
  locations: string[];
  movement: ContainerMovement[];
  health: ContainerHealth[];
  messages: ContainerMessageFilter[];
  timeWindow: ContainerTimeWindow;
  from: string;
  to: string;
  sort: ContainerSort;
}

const emptyContainerFilters: ContainerFilters = {
  states: [], types: [], locations: [], movement: [], health: [], messages: [], timeWindow: "all", from: "", to: "", sort: "newest"
};

interface ContainerFilterRow {
  container: Container;
  projection: Projection | null | undefined;
  route: ContainerRouteContext;
  movement: ContainerMovement;
  health: ContainerHealth;
  locationIds: string[];
  locationLabel: string;
  lastObservedAt: string | null;
  latestMessage: string | null;
  messageCount: number;
  events: StoredEvent[];
}

function eventSortTimestamp(event: StoredEvent) {
  const effective = Date.parse(event.effectiveAt);
  if (!Number.isNaN(effective)) return effective;
  const observed = Date.parse(event.eventAt);
  return Number.isNaN(observed) ? Date.parse(event.receivedAt) : observed;
}

function containerHealthKey(projection: Projection | null | undefined): ContainerHealth {
  if (!projection) return "no_history";
  if (projection.administrativeCorrection) return "corrected";
  return projection.health;
}

function containerHealthLabel(value: ContainerHealth) {
  return ({ clean: "Clean", warning: "Warning", needs_review: "Needs review", corrected: "Corrected", no_history: "No history" } as Record<ContainerHealth, string>)[value];
}

function ContainersPage({ data, query, openDetail, openLocation, setPage }: { data: OperationsData; query: string; openDetail: OpenDetail; openLocation: (locationId: string) => void; setPage: (page: Page) => void }) {
  const [draft, setDraft] = useState<ContainerFilters>(emptyContainerFilters);
  const [applied, setApplied] = useState<ContainerFilters>(emptyContainerFilters);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  useEffect(() => setPageIndex(0), [query, applied]);

  const locationName = (id: string | null | undefined) => data.fixtures.locations.find((item) => item.locationId === id)?.name ?? "Not yet observed";
  const allRows = useMemo<ContainerFilterRow[]>(() => data.fixtures.containers.map((container) => {
    const projection = data.projections[container.containerId];
    const route = getContainerRouteContext(container.containerId, data);
    const events = data.events.filter((event) => event.containerId === container.containerId).sort((left, right) => eventSortTimestamp(left) - eventSortTimestamp(right));
    const messages = events.map(eventMessage).filter((message): message is string => Boolean(message));
    const lastObservedAt = projection?.lastObservedAt ?? events.at(-1)?.effectiveAt ?? null;
    const movement: ContainerMovement = !projection ? "not_observed" : route.inTransit ? "in_transit" : "stationary";
    const locationIds = Array.from(new Set([
      projection?.locationId,
      route.currentLocation?.locationId,
      route.origin?.locationId,
      route.destination?.locationId,
      ...events.map((event) => event.locationId),
      ...events.flatMap((event) => [payloadLocationId(event, "sourceLocationId"), payloadLocationId(event, "destinationLocationId")])
    ].filter((value): value is string => Boolean(value))));
    const locationLabel = route.inTransit
      ? `${route.origin?.name ?? "Origin pending"} → ${route.destination?.name ?? "Destination pending"}`
      : route.currentLocation?.name ?? "Not yet observed";
    return { container, projection, route, movement, health: containerHealthKey(projection), locationIds, locationLabel, lastObservedAt, latestMessage: messages.at(-1) ?? null, messageCount: messages.length, events };
  }), [data]);

  const locationOptions = data.fixtures.locations
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((location) => ({ value: location.locationId, label: `${location.type === "in_transit" ? "In transit" : location.name}${location.isActive === false ? " (inactive)" : ""}` }));
  const searchTerm = query.trim().toLowerCase();
  const startOfDate = (value: string) => { const timestamp = Date.parse(`${value}T00:00:00`); return Number.isNaN(timestamp) ? null : timestamp; };
  const endOfDate = (value: string) => { const timestamp = Date.parse(`${value}T23:59:59.999`); return Number.isNaN(timestamp) ? null : timestamp; };
  const quickStart = applied.timeWindow === "today" ? Date.now() - 24 * 60 * 60 * 1000 : applied.timeWindow === "7d" ? Date.now() - 7 * 24 * 60 * 60 * 1000 : applied.timeWindow === "30d" ? Date.now() - 30 * 24 * 60 * 60 * 1000 : null;
  const fromTimestamp = startOfDate(applied.from);
  const toTimestamp = endOfDate(applied.to);
  const draftDateError = draft.from && draft.to && (startOfDate(draft.from) ?? 0) > (endOfDate(draft.to) ?? 0) ? "The start date must be on or before the end date." : null;
  // Container filters are local and inexpensive to evaluate, so keep the
  // result set in sync with the controls as soon as a choice changes.  An
  // invalid date range is the one exception: retain the last valid result
  // until the user fixes the range.
  useEffect(() => {
    if (!draftDateError) {
      setApplied(draft);
      setPageIndex(0);
    }
  }, [draft, draftDateError]);
  const hasDateRestriction = quickStart !== null || fromTimestamp !== null || toTimestamp !== null;
  const matchesDate = (row: ContainerFilterRow) => {
    if (!hasDateRestriction) return true;
    if (!row.lastObservedAt) return false;
    const timestamp = Date.parse(row.lastObservedAt);
    if (Number.isNaN(timestamp)) return false;
    return (quickStart === null || timestamp >= quickStart) && (fromTimestamp === null || timestamp >= fromTimestamp) && (toTimestamp === null || timestamp <= toTimestamp);
  };
  const filteredRows = allRows.filter((row) => {
    const searchable = [row.container.label, row.container.containerId, row.container.type, row.locationLabel, row.latestMessage ?? "", ...row.events.map((event) => eventNarrative(event, data))].join(" ").toLowerCase();
    return (!searchTerm || searchable.includes(searchTerm))
      && (!applied.states.length || applied.states.includes(row.projection?.loadState ?? "unknown"))
      && (!applied.types.length || applied.types.includes(row.container.type))
      && (!applied.locations.length || applied.locations.some((locationId) => row.locationIds.includes(locationId)))
      && (!applied.movement.length || applied.movement.includes(row.movement))
      && (!applied.health.length || applied.health.includes(row.health))
      && (!applied.messages.length || applied.messages.includes(row.latestMessage ? "with_message" : "without_message"))
      && matchesDate(row);
  }).sort((left, right) => {
    if (applied.sort === "label") return left.container.label.localeCompare(right.container.label);
    if (applied.sort === "location") return left.locationLabel.localeCompare(right.locationLabel) || left.container.label.localeCompare(right.container.label);
    if (applied.sort === "health") return containerHealthLabel(left.health).localeCompare(containerHealthLabel(right.health)) || left.container.label.localeCompare(right.container.label);
    const leftTime = left.lastObservedAt ? Date.parse(left.lastObservedAt) : null;
    const rightTime = right.lastObservedAt ? Date.parse(right.lastObservedAt) : null;
    if (leftTime === null && rightTime === null) return left.container.label.localeCompare(right.container.label);
    if (leftTime === null) return 1;
    if (rightTime === null) return -1;
    return applied.sort === "oldest" ? leftTime - rightTime : rightTime - leftTime;
  });
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const visibleRows = filteredRows.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize);
  const activeFilterCount = draft.states.length + draft.types.length + draft.locations.length + draft.movement.length + draft.health.length + draft.messages.length + (draft.timeWindow !== "all" ? 1 : 0) + (draft.from ? 1 : 0) + (draft.to ? 1 : 0);
  const clearFilters = () => { setDraft(emptyContainerFilters); setApplied(emptyContainerFilters); setPageIndex(0); };
  const setSingleContainerFilter = (key: "states" | "types" | "locations" | "movement" | "health" | "messages", value: string) => setDraft((current) => ({ ...current, [key]: value ? [value] : [] } as ContainerFilters));

  const showContainer = (container: Container) => {
    const projection = data.projections[container.containerId];
    const route = getContainerRouteContext(container.containerId, data);
    const events = data.events.filter((event) => event.containerId === container.containerId).sort((left, right) => eventSortTimestamp(right) - eventSortTimestamp(left));
    const messageEvents = events.filter((event) => eventMessage(event));
    openDetail({
      eyebrow: `${containerTypeLabel(container.type)} record`,
      title: container.label,
      icon: <ContainerIcon size={18} />,
      status: projection?.health === "needs_review" ? { label: "Needs review", tone: "warn" } : { label: projection?.loadState === "loaded" ? "Loaded" : projection?.loadState === "empty" ? "Empty" : "Not observed", tone: projection?.loadState === "loaded" ? "blue" : projection?.loadState === "empty" ? "good" : "muted" },
      summary: "Current container state, recorded movement, scanner messages, and the complete observation history.",
      recordId: container.containerId,
      recordIdLabel: "Container UUID",
      actions: projection?.health === "needs_review" ? <button className="secondary" onClick={() => setPage("exceptions")}><AlertTriangle size={15} /> Open review queue</button> : undefined,
      body: <><DetailFacts items={[
        ["Current state", loadStateLabel(projection?.loadState)],
        ["Movement status", route.inTransit ? "In transit" : projection ? "Stationary / location confirmed" : "Not observed"],
        ["Route", route.inTransit ? `${route.origin?.name ?? "Origin pending"} → ${route.destination?.name ?? "Destination pending"}` : route.segments.length ? `${route.segments.length} handoff${route.segments.length === 1 ? "" : "s"} recorded` : "No active movement"],
        ["Last known location", route.inTransit ? `In transit · last confirmed ${route.lastConfirmedLocation?.name ?? "not recorded"}` : locationName(projection?.locationId)],
        ["History health", projectionHealthLabel(projection?.health)],
        ["Messages", messageEvents.length ? `${messageEvents.length} message${messageEvents.length === 1 ? "" : "s"} from scanners` : "No scanner messages"],
        ["Official correction", projection?.administrativeCorrection ? `Approved ${new Date(projection.administrativeCorrection.approvedAt).toLocaleString()}` : "None applied"]
      ]}/><ContainerRouteSummary containerId={container.containerId} data={data} onOpenLocation={openLocation}/>{messageEvents.length > 0 && <section className="container-message-panel"><div className="container-message-panel__heading"><MessageSquare size={17} /><div><h3>Messages from scanners</h3><p>Notes entered on the mobile app are kept with the observation so operations can see the context.</p></div></div><div className="container-message-list">{messageEvents.map((event) => <article key={event.eventId}><div><strong>{eventNarrative(event, data)}</strong><time>{new Date(event.eventAt).toLocaleString()}</time></div><p>{eventMessage(event)}</p><small>{scannerNumber(event.deviceId)} · {data.fixtures.devices.find((device) => device.deviceId === event.deviceId)?.label ?? "Unknown scanner"}</small></article>)}</div></section>}{projection?.administrativeCorrection && <div className="detail-callout"><FilePenLine size={20}/><span><strong>Approved correction by {projection.administrativeCorrection.approvedByDisplayName}:</strong> {projection.administrativeCorrection.reason}. A newer physical scan will automatically supersede this official-state override.</span></div>}<h3 className="detail-section-title">Immutable observation history</h3><EventEvidence events={events} data={data}/></>
    });
  };
  const movementRows = filteredRows.filter((row) => row.movement === "in_transit");
  const movementGroups = Array.from(new Map(movementRows.map((row) => {
    const key = `${row.route.origin?.locationId ?? "unknown"}:${row.route.destination?.locationId ?? "unknown"}`;
    return [key, { key, origin: row.route.origin, destination: row.route.destination, rows: [] as ContainerFilterRow[] }] as const;
  })).values()).map((group) => {
    const rows = movementRows.filter((row) => (row.route.origin?.locationId ?? "unknown") === (group.origin?.locationId ?? "unknown") && (row.route.destination?.locationId ?? "unknown") === (group.destination?.locationId ?? "unknown"));
    return { ...group, rows, count: rows.length, labels: rows.slice(0, 3).map((row) => row.container.label) };
  });
  const exportRows = () => downloadCsv("stacktrack-containers.csv", [
    ["Label", "Type", "State", "Position or route", "Last observed", "History health", "Messages", "Latest message"],
    ...filteredRows.map((row) => [row.container.label, containerTypeLabel(row.container.type), loadStateLabel(row.projection?.loadState), row.locationLabel, row.lastObservedAt ?? "", containerHealthLabel(row.health), String(row.messageCount), row.latestMessage ?? ""])
  ]);
  return (
    <section className="panel containers-panel">
      <div className="container-filter-panel"><div className="container-filter-panel__header"><div><span className="eyebrow">Detailed container filters</span><h2>Find the exact assets to review</h2><p>Each filter has one active choice and updates immediately. The location filter includes current, origin, and destination locations so multi-hop journeys remain findable.</p></div><div className="container-filter-panel__actions"><span>{filteredRows.length} matching</span><button className="secondary" onClick={clearFilters} disabled={!activeFilterCount}>Clear filters</button><span className="filter-live-note">Updates as you choose</span></div></div><div className="container-filter-grid">
        <SingleFilterSelect label="Current state" options={[{ value: "loaded", label: "Loaded" }, { value: "empty", label: "Empty" }, { value: "unknown", label: "Not observed" }]} value={draft.states[0] ?? ""} onChange={(value) => setSingleContainerFilter("states", value)} emptyLabel="All states" />
        <SingleFilterSelect label="Container type" options={[{ value: "bin", label: "Bin" }, { value: "cart", label: "Cart" }, { value: "gaylord", label: "Gaylord" }]} value={draft.types[0] ?? ""} onChange={(value) => setSingleContainerFilter("types", value)} emptyLabel="All types" />
        <SingleFilterSelect label="Locations involved" options={locationOptions} value={draft.locations[0] ?? ""} onChange={(value) => setSingleContainerFilter("locations", value)} emptyLabel="All locations" />
        <SingleFilterSelect label="Movement" options={[{ value: "stationary", label: "At confirmed location" }, { value: "in_transit", label: "In transit" }, { value: "not_observed", label: "Not observed" }]} value={draft.movement[0] ?? ""} onChange={(value) => setSingleContainerFilter("movement", value)} emptyLabel="All movement" />
        <SingleFilterSelect label="History health" options={[{ value: "clean", label: "Clean" }, { value: "warning", label: "Warning" }, { value: "needs_review", label: "Needs review" }, { value: "corrected", label: "Corrected" }, { value: "no_history", label: "No history" }]} value={draft.health[0] ?? ""} onChange={(value) => setSingleContainerFilter("health", value)} emptyLabel="All health" />
        <SingleFilterSelect label="Scanner messages" options={[{ value: "with_message", label: "Has a message" }, { value: "without_message", label: "No message" }]} value={draft.messages[0] ?? ""} onChange={(value) => setSingleContainerFilter("messages", value)} emptyLabel="Any message status" />
        <label>Time window<select value={draft.timeWindow} onChange={(event) => setDraft((current) => ({ ...current, timeWindow: event.target.value as ContainerTimeWindow }))}><option value="all">Any time</option><option value="today">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label>
        <label>Sort results<select value={draft.sort} onChange={(event) => setDraft((current) => ({ ...current, sort: event.target.value as ContainerSort }))}><option value="newest">Most recently observed</option><option value="oldest">Least recently observed</option><option value="label">Container label A–Z</option><option value="location">Location A–Z</option><option value="health">Health status</option></select></label>
        <label>From date<input type="date" value={draft.from} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} /></label>
        <label>To date<input type="date" value={draft.to} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} /></label>
      </div>{draftDateError && <p className="container-filter-error">{draftDateError}</p>}<p className="container-filter-help">The global search above also searches labels, UUIDs, locations, movement descriptions, and scanner messages. Date filters use the latest accepted observation for each container.</p></div>
      <div className="toolbar"><div className="container-toolbar-actions"><span className="container-table-note"><CircleHelp size={13} /> Labels are unique; technical ID is available in Details.</span><span className="container-table-note"><MessageSquare size={13} /> Message counts include notes entered on scanners.</span></div><button className="secondary" onClick={exportRows}><Download size={16} /> Export filtered CSV</button></div>
      {movementRows.length > 0 && <div className="container-movement-summary"><div className="container-movement-summary__intro"><span className="container-movement-summary__icon"><Truck size={20} /></span><div><span className="eyebrow">Movement monitor</span><strong>{movementRows.length} container{movementRows.length === 1 ? "" : "s"} currently in transit</strong><p>Each route shows the last confirmed origin and planned destination. The movement closes when the destination receipt is scanned.</p></div></div><div className="container-movement-summary__routes">{movementGroups.slice(0, 3).map((group) => <button className="container-movement-summary__route" key={group.key} onClick={() => showContainer(group.rows[0]!.container)}><span className="container-movement-summary__route-icon"><i /><Truck size={14} /></span><span><strong title={`${group.origin?.name ?? "Origin pending"} to ${group.destination?.name ?? "Destination pending"}`}>{group.origin?.name ?? "Origin pending"} <ArrowRight size={12} /> {group.destination?.name ?? "Destination pending"}</strong><small>{group.count} moving · {group.labels.join(", ")}{group.count > group.labels.length ? ` +${group.count - group.labels.length} more` : ""}</small></span><ChevronRight size={15} /></button>)}{movementGroups.length > 3 && <small className="container-movement-summary__more">+ {movementGroups.length - 3} additional route{movementGroups.length - 3 === 1 ? "" : "s"} in the table below</small>}</div></div>}
      <div className="table-wrap"><table className="container-table"><thead><tr><th>Container label</th><th>Container type</th><th>Current state</th><th>Position / movement</th><th>Last observed</th><th>Messages</th><th>History health</th></tr></thead><tbody>{visibleRows.map((row) => <tr className="clickable-row" role="button" tabIndex={0} aria-label={`Open details for ${row.container.label}`} key={row.container.containerId} onClick={() => showContainer(row.container)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); showContainer(row.container); } }}><td><strong className="asset-label" title="Unique container label">{row.container.label}</strong>{row.latestMessage && <small className="container-label-note"><MessageSquare size={12} /> Message recorded</small>}</td><td className="capitalize">{containerTypeLabel(row.container.type)}</td><td><Pill tone={row.projection?.loadState === "loaded" ? "blue" : row.projection?.loadState === "empty" ? "good" : "muted"}>{loadStateLabel(row.projection?.loadState)}</Pill></td><td><ContainerRouteCell route={row.route} /></td><td>{relativeTime(row.lastObservedAt)}</td><td>{row.messageCount ? <span className="container-message-count"><MessageSquare size={13} /> {row.messageCount}</span> : <span className="container-message-none">None</span>}</td><td>{row.health === "needs_review" ? <Pill tone="warn">Needs review</Pill> : row.health === "corrected" ? <Pill tone="blue">Corrected</Pill> : row.health === "clean" ? <Pill tone="good">Clean</Pill> : row.health === "warning" ? <Pill tone="warn">Warning</Pill> : <Pill tone="muted">No history</Pill>}</td></tr>)}</tbody></table>{filteredRows.length === 0 && <EmptyState>No containers match the current filters. Clear a filter or broaden the global search.</EmptyState>}</div>
      <PaginationControls pageIndex={pageIndex} pageCount={pageCount} pageSize={pageSize} total={filteredRows.length} ariaLabel="Container pagination" onPageChange={setPageIndex} onPageSizeChange={(nextSize) => { setPageSize(nextSize); setPageIndex(0); }} />
    </section>
  );
}

type LoadTimeWindow = "all" | "today" | "7d" | "30d";
type LoadSort = "newest" | "oldest" | "location" | "code";
interface LoadFilters {
  locationId: string;
  goodsType: string;
  timeWindow: LoadTimeWindow;
  from: string;
  to: string;
  sort: LoadSort;
}

const emptyLoadFilters: LoadFilters = { locationId: "", goodsType: "", timeWindow: "all", from: "", to: "", sort: "newest" };

function LoadsPage({ data, query, openDetail }: { data: OperationsData; query: string; openDetail: OpenDetail }) {
  const [filter, setFilter] = useState<"available" | "used" | "previous">("available");
  const [draft, setDraft] = useState<LoadFilters>(emptyLoadFilters);
  const [applied, setApplied] = useState<LoadFilters>(emptyLoadFilters);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(12);
  useEffect(() => setPageIndex(0), [query, filter, applied]);
  const containerName = (id: string) => data.fixtures.containers.find((item) => item.containerId === id)?.label ?? "Unknown container";
  const locationName = (id: string) => data.fixtures.locations.find((item) => item.locationId === id)?.name ?? "Unknown location";
  const codeFor = (event: StoredEvent) => String(event.payload.displayLoadCode ?? event.loadCodeId ?? "");
  const isToday = (value: string) => new Date(value).toDateString() === new Date().toDateString();
  const isActive = (event: StoredEvent) => data.projections[event.containerId]?.activeLoadCodeId === event.loadCodeId;
  const sourceLoads = data.events.filter((event) => event.eventType === "load_assigned");
  const goodsOptions = Array.from(new Set(sourceLoads.map((event) => String(event.payload.goodsType ?? "").trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right));
  const searchTerm = query.trim().toLowerCase();
  const now = Date.now();
  const quickStart = applied.timeWindow === "today" ? now - 24 * 60 * 60 * 1000 : applied.timeWindow === "7d" ? now - 7 * 24 * 60 * 60 * 1000 : applied.timeWindow === "30d" ? now - 30 * 24 * 60 * 60 * 1000 : null;
  const startOfDate = (value: string) => { const timestamp = Date.parse(`${value}T00:00:00`); return Number.isNaN(timestamp) ? null : timestamp; };
  const endOfDate = (value: string) => { const timestamp = Date.parse(`${value}T23:59:59.999`); return Number.isNaN(timestamp) ? null : timestamp; };
  const fromTimestamp = startOfDate(applied.from);
  const toTimestamp = endOfDate(applied.to);
  const allLoads = sourceLoads.filter((event) => {
    const searchable = [codeFor(event), containerName(event.containerId), locationName(event.locationId), String(event.payload.goodsType ?? ""), String(event.payload.secondaryValue ?? "")].join(" ").toLowerCase();
    const eventTimestamp = Date.parse(event.eventAt);
    const lowerBound = Math.max(quickStart ?? Number.NEGATIVE_INFINITY, fromTimestamp ?? Number.NEGATIVE_INFINITY);
    const upperBound = Math.min(toTimestamp ?? Number.POSITIVE_INFINITY, applied.timeWindow === "today" ? now : Number.POSITIVE_INFINITY);
    return (!searchTerm || searchable.includes(searchTerm)) &&
      (!applied.locationId || event.locationId === applied.locationId) &&
      (!applied.goodsType || String(event.payload.goodsType ?? "") === applied.goodsType) &&
      eventTimestamp >= lowerBound && eventTimestamp <= upperBound;
  });
  const loads = [...allLoads].filter((event) =>
    filter === "available" ? isActive(event) : filter === "used" ? !isActive(event) : !isToday(event.eventAt)
  ).sort((left, right) => {
    if (applied.sort === "location") return locationName(left.locationId).localeCompare(locationName(right.locationId)) || Date.parse(right.eventAt) - Date.parse(left.eventAt);
    if (applied.sort === "code") return codeFor(left).localeCompare(codeFor(right), undefined, { numeric: true }) || Date.parse(right.eventAt) - Date.parse(left.eventAt);
    return applied.sort === "oldest" ? Date.parse(left.eventAt) - Date.parse(right.eventAt) : Date.parse(right.eventAt) - Date.parse(left.eventAt);
  });
  const pageCount = Math.max(1, Math.ceil(loads.length / pageSize));
  const visibleLoads = loads.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize);
  const activeCount = Object.entries(applied).filter(([key, value]) => key !== "sort" && Boolean(value) && value !== "all").length + (applied.sort !== "newest" ? 1 : 0);
  const statusLabel = filter === "available" ? "Available codes" : filter === "used" ? "Used codes" : "Previous days";
  const invalidRange = Boolean(draft.from && draft.to && draft.from > draft.to);
  useEffect(() => {
    if (!invalidRange) {
      setApplied(draft);
      setPageIndex(0);
    }
  }, [draft, invalidRange]);
  const hasLoadFilterValues = (value: LoadFilters) => Boolean(value.locationId || value.goodsType || value.timeWindow !== "all" || value.from || value.to || value.sort !== "newest");
  const draftHasFilters = Boolean(filter !== "available" || hasLoadFilterValues(draft) || hasLoadFilterValues(applied));
  const updateFilter = (field: keyof LoadFilters, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const clearFilters = () => { setDraft(emptyLoadFilters); setApplied(emptyLoadFilters); setFilter("available"); setPageIndex(0); };
  const exportLoads = () => {
    if (!loads.length) return;
    downloadCsv("stacktrack-load-codes.csv", [
      ["Load code", "Container", "Location", "Status", "Goods type", "Classification", "Message for operations", "Created at", "Scanner"],
      ...loads.map((event) => [
        codeFor(event),
        containerName(event.containerId),
        locationName(event.locationId),
        isActive(event) ? "Available" : "Used",
        String(event.payload.goodsType ?? ""),
        String(event.payload.secondaryValue ?? ""),
        eventMessage(event) ?? "",
        event.eventAt,
        data.fixtures.devices.find((device) => device.deviceId === event.deviceId)?.label ?? `Scanner ${scannerNumber(event.deviceId)}`
      ])
    ]);
  };
  return (
    <>
      <div className="notice-banner"><CheckCircle2 size={22} /><div><strong>Validated load-code register</strong><span>Managers can use these codes in the production system. Filter or sort the accepted mark-full observations before exporting.</span></div><button className="primary" onClick={exportLoads} disabled={!loads.length}><Download size={16} /> Download filtered list</button></div>
      <section className="panel">
        <section className="load-filter-panel">
          <div className="load-filter-panel__header"><div><strong>Filter and sort load codes</strong><span>{statusLabel}{activeCount ? ` · ${activeCount} active filter${activeCount === 1 ? "" : "s"}` : ""} · {loads.length.toLocaleString()} matching</span></div><div><button className="secondary" type="button" onClick={clearFilters} disabled={!draftHasFilters}>Clear filters</button><span className="filter-live-note">Updates as you choose</span></div></div>
          <div className="load-filter-grid">
            <label className="load-filter--wide">Location<select value={draft.locationId} onChange={(event) => updateFilter("locationId", event.target.value)}><option value="">All locations</option>{data.fixtures.locations.map((location) => <option value={location.locationId} key={location.locationId}>{location.name}</option>)}</select></label>
            <label>Time window<select value={draft.timeWindow} onChange={(event) => updateFilter("timeWindow", event.target.value as LoadTimeWindow)}><option value="all">All available</option><option value="today">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label>
            <label>Goods type<select value={draft.goodsType} onChange={(event) => updateFilter("goodsType", event.target.value)}><option value="">All goods types</option>{goodsOptions.map((goodsType) => <option value={goodsType} key={goodsType}>{goodsType}</option>)}</select></label>
            <label>From date<input type="date" value={draft.from} onChange={(event) => updateFilter("from", event.target.value)} /></label>
            <label>To date<input type="date" value={draft.to} onChange={(event) => updateFilter("to", event.target.value)} /></label>
            <label>Sort by<select value={draft.sort} onChange={(event) => updateFilter("sort", event.target.value as LoadSort)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="location">Location A–Z</option><option value="code">Load code A–Z</option></select></label>
          </div>
          {invalidRange && <p className="load-filter-error">The from date must be on or before the to date.</p>}
        </section>
        <div className="toolbar"><div className="filter-tabs"><button className={filter === "available" ? "active" : ""} onClick={() => { setFilter("available"); setPageIndex(0); }}>Available <b>{allLoads.filter(isActive).length}</b></button><button className={filter === "used" ? "active" : ""} onClick={() => { setFilter("used"); setPageIndex(0); }}>Used <b>{allLoads.filter((event) => !isActive(event)).length}</b></button><button className={filter === "previous" ? "active" : ""} onClick={() => { setFilter("previous"); setPageIndex(0); }}>Previous days</button></div><span className="date-chip"><Clock3 size={15} /> {loads.length.toLocaleString()} matching</span></div>
        <div className="load-grid">{visibleLoads.map((event) => (
          <article className="load-card" key={event.eventId}>
            <div className="load-card__top"><span>LOAD CODE</span><Pill tone="good">Validated</Pill></div>
            <strong>{codeFor(event)}</strong>
            <div className="load-card__details"><span><ContainerIcon size={15} /> {containerName(event.containerId)}</span><span><MapPin size={15} /> {locationName(event.locationId)}</span><span><Boxes size={15} /> {String(event.payload.goodsType ?? "Not set")} · {String(event.payload.secondaryValue ?? "Not set")}</span></div>
            <div className="load-card__bottom"><span>Created {relativeTime(event.eventAt)}</span><button onClick={() => openDetail({
              eyebrow: "Load code history",
              title: codeFor(event),
              icon: <PackageCheck size={18} />,
              status: { label: isActive(event) ? "Available" : "Used", tone: isActive(event) ? "good" : "muted" },
              summary: "Validated production handoff linked to an immutable mark-full observation.",
              recordId: event.loadCodeId ?? event.eventId,
              recordIdLabel: event.loadCodeId ? "Load code UUID" : "Source event UUID",
              body: <><DetailFacts items={[
                ["Container", containerName(event.containerId) ?? "Unknown"],
                ["Current status", isActive(event) ? "Active / available" : "Completed / used"],
                ["Origin", locationName(event.locationId) ?? "Unknown"],
                ["Recorded journey", routeLocationNames(getContainerRouteContext(event.containerId, data)).join(" → ") || "No handoffs recorded"],
                ["Goods", `${String(event.payload.goodsType ?? "Not set")} · ${String(event.payload.secondaryValue ?? "Not set")}`]
              ]}/><h3 className="detail-section-title">Container evidence</h3><EventEvidence events={data.events.filter((item) => item.containerId === event.containerId)} data={data}/></>
            })}>View history <ChevronRight size={15} /></button></div>
          </article>
        ))}</div>
        <PaginationControls pageIndex={pageIndex} pageCount={pageCount} pageSize={pageSize} total={loads.length} ariaLabel="Load code pagination" onPageChange={setPageIndex} onPageSizeChange={(nextSize) => { setPageSize(nextSize); setPageIndex(0); }} />
      </section>
    </>
  );
}

type LocationMetric = {
  location: Location;
  current: Projection[];
  arriving: Projection[];
  leaving: Projection[];
  eventsLastDay: number;
  flaggedEvents: number;
  scanners: Device[];
  staleScanners: number;
  needsReview: number;
};

function locationTypeLabel(type: Location["type"]) {
  return type === "donation_express" ? "Donation Xpress" : type === "warehouse" ? "Warehouse" : type === "in_transit" ? "In transit" : "Store";
}

function isUnknownLocation(location: Location): boolean {
  return location.name.trim().toLowerCase() === "unknown location";
}

type RouteRecord = { container: Container; projection: Projection | null; route: ContainerRouteContext };

function LocationNetworkOverview({ metrics, movingCount, movingReviewCount, routeRecords, onSelect, onOpen }: { metrics: LocationMetric[]; movingCount: number; movingReviewCount: number; routeRecords: RouteRecord[]; onSelect: (locationId: string) => void; onOpen: (record: RouteRecord) => void }) {
  const sortByWork = (left: LocationMetric, right: LocationMetric) => (right.current.length + right.arriving.length + right.leaving.length + right.needsReview) - (left.current.length + left.arriving.length + left.leaving.length + left.needsReview);
  const currentCount = metrics.reduce((total, metric) => total + metric.current.length, 0);
  const attentionCount = metrics.reduce((total, metric) => total + metric.needsReview, movingReviewCount);
  const activeScanners = metrics.reduce((total, metric) => total + metric.scanners.filter((device) => device.isActive).length, 0);
  const activeSegments = routeRecords.flatMap((record) => record.route.activeSegment ? [{ record, segment: record.route.activeSegment }] : []).sort((left, right) => Date.parse(right.segment.departedAt) - Date.parse(left.segment.departedAt));
  const renderLocationNode = (metric: LocationMetric) => <button className="location-flow-node" key={metric.location.locationId} onClick={() => onSelect(metric.location.locationId)}>
    <span className={`location-flow-node__icon location-flow-node__icon--${metric.location.type}`}><LocationTypeIcon location={metric.location} size={16} /></span>
    <span className="location-flow-node__body"><strong>{metric.location.name}</strong><small>{locationTypeLabel(metric.location.type)} · {metric.current.length} here · {metric.arriving.length} inbound</small></span>
    <span className="location-flow-node__stats"><b>{metric.eventsLastDay}</b><small>24h scans</small></span>
    <span className="location-flow-node__actions">
      {metric.needsReview > 0 && <Pill tone="warn">{metric.needsReview} review</Pill>}
      <ChevronRight size={15} />
    </span>
  </button>;
  return <section className="location-network panel">
    <div className="location-network__header"><div><span className="eyebrow">Location view option 1 · recommended</span><PanelTitle title="Operational network map" subtitle="Every location is a peer node. The system does not assume a store-to-warehouse path, so multi-hop and rerouted journeys remain honest." /></div><span className="location-network__hint">Best for daily triage: select a node to focus its containers, scanners, and active handoffs below.</span></div>
    <div className="location-network__summary"><span><b>{metrics.length}</b><small>operating locations</small></span><span><b>{currentCount}</b><small>containers at sites</small></span><span><b>{movingCount}</b><small>active handoffs</small></span><span><b>{activeScanners}</b><small>enabled scanners</small></span><span className={attentionCount ? "location-network__summary--warn" : ""}><b>{attentionCount}</b><small>needs review</small></span></div>
    <div className="location-network__nodes">{[...metrics].sort(sortByWork).map(renderLocationNode)}</div>
    <div className="location-network__active"><div className="location-network__active-heading"><div><span className="eyebrow">Live handoffs</span><h3>{movingCount ? `${movingCount} container${movingCount === 1 ? "" : "s"} between locations` : "No containers are currently between locations"}</h3></div><Pill tone={movingReviewCount ? "warn" : movingCount ? "blue" : "good"}>{movingReviewCount ? `${movingReviewCount} review` : movingCount ? "Moving" : "Clear"}</Pill></div>{activeSegments.length ? <div className="location-network__active-list">{activeSegments.slice(0, 6).map(({ record, segment }) => <button key={segment.segmentId} onClick={() => onOpen(record)}><span className="location-network__active-icon"><Truck size={15} /></span><span><strong>{record.container.label}</strong><small>{segment.origin?.name ?? "Origin pending"} <ArrowRight size={12} /> {segment.destination?.name ?? "Destination pending"}</small></span><span className="location-network__active-age">{relativeTime(segment.departedAt)}</span><ChevronRight size={15} /></button>)}</div> : <p className="location-network__active-empty">A batch-out scan will appear here with its origin, declared destination, and receipt status.</p>}{activeSegments.length > 6 && <small className="location-network__active-more">+ {activeSegments.length - 6} additional handoffs are included in the route matrix below.</small>}</div>
  </section>;
}

function LocationRouteMatrix({ routeRecords, onSelect }: { routeRecords: RouteRecord[]; onSelect: (locationId: string) => void }) {
  const pairs = new Map<string, { origin: Location | null; destination: Location | null; active: number; received: number; superseded: number; review: number; containers: string[]; lastDeparture: string | null }>();
  for (const record of routeRecords) {
    for (const segment of record.route.segments) {
      const key = `${segment.origin?.locationId ?? "unknown"}:${segment.destination?.locationId ?? "unknown"}`;
      const pair = pairs.get(key) ?? { origin: segment.origin, destination: segment.destination, active: 0, received: 0, superseded: 0, review: 0, containers: [], lastDeparture: null };
      if (segment.status === "in_transit") pair.active += 1;
      else if (segment.status === "received") pair.received += 1;
      else pair.superseded += 1;
      if (record.projection?.health === "needs_review") pair.review += 1;
      if (!pair.containers.includes(record.container.label)) pair.containers.push(record.container.label);
      if (!pair.lastDeparture || Date.parse(segment.departedAt) > Date.parse(pair.lastDeparture)) pair.lastDeparture = segment.departedAt;
      pairs.set(key, pair);
    }
  }
  const rows = [...pairs.values()].sort((left, right) => (right.active - left.active) || (right.review - left.review) || Date.parse(right.lastDeparture ?? "") - Date.parse(left.lastDeparture ?? ""));
  const unresolved = routeRecords.reduce((total, record) => total + record.route.segments.filter((segment) => !segment.destination).length, 0);
  return <section className="location-option panel"><div className="location-option__header"><div><span className="eyebrow">Location view option 2 · route matrix</span><h2>Origin → destination workload</h2><p>Use this when operations leadership needs to compare lanes, find reroutes, or see which warehouse handoffs are aging. Each row is an independent pair; rows do not imply a single chain.</p></div><span className="location-option__icon"><Waypoints size={19} /></span></div><div className="location-option__summary"><span><b>{rows.length}</b> route pairs</span><span><b>{rows.reduce((total, row) => total + row.active, 0)}</b> active</span><span><b>{rows.reduce((total, row) => total + row.received, 0)}</b> completed handoffs</span><span className={unresolved ? "location-option__summary--warn" : ""}><b>{unresolved}</b> missing destinations</span></div>{rows.length ? <div className="route-matrix"><div className="route-matrix__head"><span>Origin</span><span>Destination</span><span>Containers / status</span><span>Last departure</span><span /></div>{rows.map((row) => <button className="route-matrix__row" key={`${row.origin?.locationId ?? "unknown"}:${row.destination?.locationId ?? "unknown"}`} onClick={() => onSelect(row.origin?.locationId ?? row.destination?.locationId ?? "")}><span><strong>{row.origin?.name ?? "Origin not recorded"}</strong><small>{row.origin ? locationTypeLabel(row.origin.type) : "Needs review"}</small></span><span className="route-matrix__destination"><ArrowRight size={14} /><strong>{row.destination?.name ?? "Destination not recorded"}</strong></span><span><strong>{row.containers.length}</strong><small>{row.active ? `${row.active} active` : "No active"}{row.received ? ` · ${row.received} completed` : ""}{row.superseded ? ` · ${row.superseded} rerouted` : ""}</small></span><span>{row.lastDeparture ? relativeTime(row.lastDeparture) : "—"}{row.review > 0 && <Pill tone="warn">{row.review} review</Pill>}</span><ChevronRight size={15} /></button>)}</div> : <EmptyState>No route handoffs have been recorded yet.</EmptyState>}</section>;
}

function LocationLifecycleExplorer({ routeRecords, focusLocationId, onOpen }: { routeRecords: RouteRecord[]; focusLocationId: string; onOpen: (record: RouteRecord) => void }) {
  const [showAll, setShowAll] = useState(false);
  const journeys = routeRecords.filter((record) => record.route.segments.length > 0 && (!focusLocationId || record.route.segments.some((segment) => segment.origin?.locationId === focusLocationId || segment.destination?.locationId === focusLocationId))).sort((left, right) => (Number(right.route.inTransit) - Number(left.route.inTransit)) || (right.route.segments.length - left.route.segments.length) || Date.parse(right.route.departedAt ?? "") - Date.parse(left.route.departedAt ?? ""));
  const visible = showAll ? journeys : journeys.slice(0, 8);
  return <section className="location-option location-lifecycle panel"><div className="location-option__header"><div><span className="eyebrow">Location view option 3 · container lifecycle</span><h2>Follow every checkpoint in order</h2><p>Use this when a container has visited several sites. It shows the recorded journey as a chain, highlights the current open hop, and keeps a reroute visible rather than flattening it into one “last location.”</p></div><span className="location-option__icon"><GitBranch size={19} /></span></div>{visible.length ? <div className="lifecycle-list">{visible.map((record) => { const route = record.route; const names = routeLocationNames(route); return <button className="lifecycle-row" key={record.container.containerId} onClick={() => onOpen(record)}><span className="lifecycle-row__identity"><span className="lifecycle-row__icon"><ContainerIcon size={15} /></span><span><strong>{record.container.label}</strong><small>{record.container.type} · {route.segments.length} recorded handoff{route.segments.length === 1 ? "" : "s"}</small></span></span><span className="lifecycle-row__journey">{names.map((name, index) => <span key={`${record.container.containerId}:${name}:${index}`}><b>{name}</b>{index < names.length - 1 && <ArrowRight size={12} />}</span>)}{!names.length && <em>Locations not recorded</em>}</span><span className="lifecycle-row__status">{route.inTransit ? <Pill tone="blue">In transit</Pill> : route.unresolvedSegmentCount ? <Pill tone="warn">Receipt gap</Pill> : <Pill tone="good">Journey recorded</Pill>}<ChevronRight size={15} /></span></button>; })}</div> : <div className="location-lifecycle__empty"><Layers3 size={19} /><span><strong>No multi-hop journeys match this location.</strong><small>Once a container is received and sent again, its complete checkpoint chain will appear here.</small></span></div>}{journeys.length > 8 && <button className="location-option__more" onClick={() => setShowAll((value) => !value)}>{showAll ? "Show fewer journeys" : `Show all ${journeys.length} journeys`}</button>}</section>;
}

function LocationWorkspacePage({ data, locationId, locationFilter, openLocation, openDetail, setPage, session }: { data: OperationsData; locationId: string; locationFilter?: LocationInventoryFilter; openLocation: (locationId: string, filter?: LocationInventoryFilter) => void; openDetail: OpenDetail; setPage: (page: Page) => void; session: AdminSession | null }) {
  const location = data.fixtures.locations.find((item) => item.locationId === locationId && item.type !== "in_transit" && item.isActive !== false && !isUnknownLocation(item));
  const principal = session?.principal;
  const canManageScanners = Boolean(principal && ["organization_owner", "operations_administrator", "location_manager"].includes(principal.role));
  const canRequestCorrections = Boolean(principal && ["organization_owner", "operations_administrator", "location_manager"].includes(principal.role));
  if (!location) {
    return <section className="location-workspace-denied panel"><div className="location-workspace-denied__icon"><ShieldCheck size={24} /></div><span className="eyebrow">Location workspace</span><h2>Location unavailable</h2><p>This site is outside the signed-in account's operating scope, has been retired, or no longer exists. Return to the network directory to choose an available location.</p><button className="secondary" onClick={() => setPage("locations")}><MapPin size={15} /> Back to locations</button></section>;
  }
  const transitId = data.fixtures.locations.find((item) => item.type === "in_transit")?.locationId;
  const projections = Object.values(data.projections).filter(Boolean) as Projection[];
  const routeFor = (containerId: string) => getContainerRouteContext(containerId, data);
  const current = projections.filter((projection) => projection.locationId === location.locationId);
  const moving = transitId ? projections.filter((projection) => projection.locationId === transitId) : [];
  const arriving = moving.filter((projection) => routeFor(projection.containerId).activeSegment?.destination?.locationId === location.locationId);
  const leaving = moving.filter((projection) => routeFor(projection.containerId).activeSegment?.origin?.locationId === location.locationId);
  const localEvents = data.events
    .filter((event) => event.locationId === location.locationId)
    .sort((left, right) => Date.parse(right.eventAt) - Date.parse(left.eventAt));
  const localEventIds = new Set(localEvents.map((event) => event.eventId));
  const localReviews = data.reviewCases.filter((item) => item.evidenceEventIds.some((eventId) => localEventIds.has(eventId)));
  const scanners = data.fixtures.devices.filter((device) => device.assignedLocationId === location.locationId);
  const staleScanners = scanners.filter((device) => !device.lastReportedAt || Date.now() - Date.parse(device.lastReportedAt) > 24 * 60 * 60 * 1000);
  const scansLastDay = localEvents.filter((event) => Date.now() - Date.parse(event.receivedAt) <= 24 * 60 * 60 * 1000).length;
  const flaggedScans = localEvents.filter((event) => event.accuracyFlags.length > 0).length;
  const openReviews = localReviews.filter((item) => !["resolved", "approved", "rejected"].includes(item.status));
  const containerFor = (containerId: string) => data.fixtures.containers.find((item) => item.containerId === containerId);
  const openContainer = (projection: Projection) => {
    const record = containerFor(projection.containerId);
    openDetail({
      eyebrow: "Location container",
      title: record?.label ?? "Tracked container",
      icon: <ContainerIcon size={18} />,
      status: { label: projection.health === "needs_review" ? "Needs review" : loadStateLabel(projection.loadState), tone: projection.health === "needs_review" ? "warn" : projection.loadState === "loaded" ? "blue" : "good" },
      summary: "This container is shown in the location workspace using its latest accepted projection and preserved scan evidence.",
      ...(record?.containerId ? { recordId: record.containerId } : {}),
      recordIdLabel: "Container ID",
      body: <><DetailFacts items={[ ["Container type", record?.type ?? "Unknown"], ["Current state", loadStateLabel(projection.loadState)], ["Official location", data.fixtures.locations.find((item) => item.locationId === projection.locationId)?.name ?? "In transit / not observed"], ["Last observed", relativeTime(projection.lastObservedAt)], ["History health", projectionHealthLabel(projection.health)] ]} /><h3 className="detail-section-title">Immutable observation history</h3><EventEvidence events={data.events.filter((event) => event.containerId === projection.containerId)} data={data} /></>
    });
  };
  const openEvent = (event: StoredEvent) => openDetail({
    eyebrow: "Local scanner observation",
    title: containerFor(event.containerId)?.label ?? "Tracked container",
    icon: <Activity size={18} />,
    status: event.accuracyFlags.length ? { label: "Review flags", tone: "warn" } : { label: "No data-quality warnings", tone: "good" },
    summary: `Observed at ${location.name} by ${data.fixtures.devices.find((device) => device.deviceId === event.deviceId)?.label ?? "a scanner"}.`,
    recordId: event.eventId,
    recordIdLabel: "Observation ID",
     body: <><DetailFacts items={[["Observation", eventLabel(event.eventType)], ["Location", location.name], ["Scanner", `${scannerNumber(event.deviceId)} · ${data.fixtures.devices.find((device) => device.deviceId === event.deviceId)?.label ?? "Unknown scanner"}`], ["Observed", new Date(event.eventAt).toLocaleString()], ["Received", new Date(event.receivedAt).toLocaleString()], ["Data quality", event.accuracyFlags.length ? event.accuracyFlags.map(accuracyFlagDetail).join(", ") : "No data-quality warnings"]]} /><h3 className="detail-section-title">Preserved evidence</h3><EventEvidence events={[event]} data={data} /></>
  });
  const inventoryRecords = buildInventorySnapshotRecords(data);
  const selectedBucket: LocationInventoryBucket = locationFilter?.bucket ?? "current";
  const recordsForBucket = (bucket: LocationInventoryBucket) => inventoryRecords.filter((record) => {
    const route = routeFor(record.container.containerId);
    const isCurrent = record.projection?.locationId === location.locationId;
    const isInTransit = Boolean(transitId && record.projection?.locationId === transitId);
    const isArriving = isInTransit && route.activeSegment?.destination?.locationId === location.locationId;
    const isLeaving = isInTransit && route.activeSegment?.origin?.locationId === location.locationId;
    if (bucket === "arriving") return isArriving;
    if (bucket === "leaving") return isLeaving;
    return isCurrent;
  }).filter((record) => {
    if (locationFilter?.containerType && record.container.type !== locationFilter.containerType) return false;
    if (locationFilter?.goodsType && record.goodsType !== locationFilter.goodsType) return false;
    if (locationFilter?.loadState && record.projection?.loadState !== locationFilter.loadState) return false;
    return true;
  });
  const inventoryByBucket = {
    current: recordsForBucket("current"),
    arriving: recordsForBucket("arriving"),
    leaving: recordsForBucket("leaving")
  } satisfies Record<LocationInventoryBucket, InventorySnapshotRecord[]>;
  const visibleInventory = inventoryByBucket[selectedBucket];
  const inventoryGoodsOptions = Array.from(new Set([
    ...data.fixtures.goodsTypes.map((goodsType) => goodsType.name),
    ...inventoryRecords.map((record) => record.goodsType)
  ])).sort((left, right) => left.localeCompare(right));
  const inventoryTypeOptions = ["bin", "cart", "gaylord"] as const;
  const updateInventoryFilter = (next: Partial<LocationInventoryFilter>) => {
    const nextFilter: LocationInventoryFilter = { ...(locationFilter ?? {}), ...next };
    Object.entries(nextFilter).forEach(([key, value]) => { if (!value) delete nextFilter[key as keyof LocationInventoryFilter]; });
    openLocation(location.locationId, nextFilter);
  };
  const clearInventoryFilters = () => openLocation(location.locationId);
  const inventoryFilterSummary = [
    locationFilter?.containerType ? containerTypeLabel(locationFilter.containerType) : "All container types",
    locationFilter?.goodsType ?? "All goods categories",
    locationFilter?.loadState ? loadStateLabel(locationFilter.loadState) : "Any state"
  ];
  const movementLabelFor = (record: InventorySnapshotRecord) => {
    const segment = routeFor(record.container.containerId).activeSegment;
    if (!segment) return "Location confirmed";
    if (selectedBucket === "arriving") return `From ${segment.origin?.name ?? "origin pending"}`;
    if (selectedBucket === "leaving") return `To ${segment.destination?.name ?? "destination pending"}`;
    return segment.destination ? `Moving to ${segment.destination.name}` : "Destination pending";
  };
  const inventoryCountLabel = (bucket: LocationInventoryBucket) => `${inventoryByBucket[bucket].length} ${bucket === "current" ? "here" : bucket}`;
  const typeLabel = locationTypeLabel(location.type);
  return <div className="location-focused-page">
    <section className="location-inventory panel"><div className="location-inventory__header"><div><span className="eyebrow">Location inventory</span><h3>Filter the containers associated with this site</h3><p>Select a count or filter to see the exact bins, carts, or gaylords behind it. The selected view is preserved in the URL so a filtered location link can be shared.</p></div><div className="location-inventory__header-count"><strong>{visibleInventory.length}</strong><span>{selectedBucket === "current" ? "at this location" : `${selectedBucket} this location`}</span></div></div><div className="location-inventory__tabs" role="tablist" aria-label="Location inventory view"><button type="button" className={selectedBucket === "current" ? "active" : ""} onClick={() => updateInventoryFilter({ bucket: "current" })}>At this location <b>{inventoryCountLabel("current")}</b></button><button type="button" className={selectedBucket === "arriving" ? "active" : ""} onClick={() => updateInventoryFilter({ bucket: "arriving" })}>Arriving <b>{inventoryCountLabel("arriving")}</b></button><button type="button" className={selectedBucket === "leaving" ? "active" : ""} onClick={() => updateInventoryFilter({ bucket: "leaving" })}>Leaving <b>{inventoryCountLabel("leaving")}</b></button></div><div className="location-inventory__filters"><label><span>Container type</span><select value={locationFilter?.containerType ?? ""} onChange={(event) => updateInventoryFilter({ containerType: (event.target.value || undefined) as LocationInventoryFilter["containerType"] })}><option value="">All types</option>{inventoryTypeOptions.map((value) => <option value={value} key={value}>{containerTypeLabel(value)}</option>)}</select></label><label><span>Goods category</span><select value={locationFilter?.goodsType ?? ""} onChange={(event) => updateInventoryFilter({ goodsType: event.target.value || undefined })}><option value="">All categories</option>{inventoryGoodsOptions.map((value) => <option value={value} key={value}>{value}</option>)}</select></label><label><span>Current state</span><select value={locationFilter?.loadState ?? ""} onChange={(event) => updateInventoryFilter({ loadState: (event.target.value || undefined) as LocationInventoryFilter["loadState"] })}><option value="">Any state</option><option value="loaded">Loaded</option><option value="empty">Empty</option><option value="unknown">Unknown</option></select></label><div className="location-inventory__filter-summary"><strong>{visibleInventory.length} matching</strong><span>{inventoryFilterSummary.join(" · ")}</span></div><button type="button" className="secondary" onClick={clearInventoryFilters} disabled={!locationFilter || Object.keys(locationFilter).length === 0}>Clear filters</button></div><div className="location-inventory__breakdown">{inventoryTypeOptions.map((type) => { const count = visibleInventory.filter((record) => record.container.type === type).length; return <button type="button" key={type} className={locationFilter?.containerType === type ? "active" : ""} onClick={() => updateInventoryFilter({ containerType: locationFilter?.containerType === type ? undefined : type })}><strong>{count}</strong><span>{containerTypeLabel(type)}s</span><small>Show only these containers</small></button>; })}</div><div className="location-inventory__list">{visibleInventory.length ? visibleInventory.map((record) => <button type="button" className="location-inventory__row" key={record.container.containerId} onClick={() => record.projection && openContainer(record.projection)} disabled={!record.projection}><span className="location-inventory__row-icon"><ContainerIcon size={15} /></span><span className="location-inventory__row-main"><strong>{record.container.label}</strong><small>{containerTypeLabel(record.container.type)} · {record.goodsType} · {loadStateLabel(record.projection?.loadState)}</small></span><span className="location-inventory__row-movement">{movementLabelFor(record)}</span><span className="location-inventory__row-time">{record.projection ? relativeTime(record.projection.lastObservedAt) : "No observation"}</span><ChevronRight size={14} /></button>) : <div className="location-focused-empty">No containers match these filters in this workflow view.</div>}</div></section>
    <div className="location-focused-toolbar"><button className="secondary" onClick={() => setPage("locations")}><ArrowRight size={15} className="location-focused-toolbar__back" /> All locations</button><span className="location-focused-toolbar__crumb"><MapPin size={14} /> {typeLabel} workspace</span><button className="secondary" onClick={() => void window.scrollTo({ top: 0, behavior: "smooth" })}><RefreshCw size={15} /> Refresh view</button></div>
    <section className="location-focused-hero panel"><div className="location-focused-hero__identity"><span className={`location-title-icon location-title-icon--${location.type}`}><LocationTypeIcon location={location} size={23} /></span><div><span className="eyebrow">Focused operating location</span><h2>{location.name}</h2><p>{typeLabel} · {scanners.length} assigned scanner{scanners.length === 1 ? "" : "s"} · {scansLastDay} accepted scan{scansLastDay === 1 ? "" : "s"} in the last 24 hours</p><div className="location-focused-hero__tags"><Pill tone={openReviews.length ? "warn" : "good"}>{openReviews.length ? `${openReviews.length} review${openReviews.length === 1 ? "" : "s"} open` : "No open reviews"}</Pill><Pill tone={staleScanners.length ? "warn" : "good"}>{staleScanners.length ? `${staleScanners.length} stale scanner${staleScanners.length === 1 ? "" : "s"}` : "Scanner reports fresh"}</Pill></div></div></div><div className="location-focused-hero__actions"><button className={canManageScanners ? "primary" : "secondary"} onClick={() => setPage("devices")}><Smartphone size={15} /> {canManageScanners ? "Manage scanners" : "View scanners"}</button><button className="secondary" onClick={() => setPage("activity")}><Activity size={15} /> Local activity</button>{canRequestCorrections && <button className="secondary" onClick={() => setPage("corrections")}><FilePenLine size={15} /> Request correction</button>}</div></section>
    <section className="location-focused-metrics"><article><span className="location-focused-metric__icon location-focused-metric__icon--blue"><Boxes size={18} /></span><div><small>At this location</small><strong>{current.length}</strong><em>Latest projection</em></div></article><article><span className="location-focused-metric__icon location-focused-metric__icon--green"><ArrowRight size={18} /></span><div><small>Arriving</small><strong>{arriving.length}</strong><em>Destination receipt pending</em></div></article><article><span className="location-focused-metric__icon location-focused-metric__icon--orange"><Truck size={18} /></span><div><small>Leaving</small><strong>{leaving.length}</strong><em>Outbound handoff open</em></div></article><article><span className="location-focused-metric__icon location-focused-metric__icon--slate"><Smartphone size={18} /></span><div><small>Scanner coverage</small><strong>{scanners.filter((device) => device.isActive).length}/{scanners.length}</strong><em>{staleScanners.length ? `${staleScanners.length} report stale` : "Reports within 24 hours"}</em></div></article><article><span className="location-focused-metric__icon location-focused-metric__icon--cyan"><Activity size={18} /></span><div><small>Recent scans</small><strong>{scansLastDay}</strong><em>{flaggedScans ? `${flaggedScans} flagged for review` : "No scan-quality flags"}</em></div></article></section>
    <section className="location-focused-section panel"><div className="location-focused-section__header"><div><span className="eyebrow">Physical workflow</span><h3>What is at, arriving to, and leaving this site</h3><p>Each lane is independent. A container can appear in multiple lanes over time, and a multi-hop route stays tied to its own recorded checkpoints.</p></div><Pill tone="blue">{current.length + arriving.length + leaving.length} active records</Pill></div><div className="workflow-lanes"><LocationWorkflowLane title="At this location" subtitle="Official current projection" tone="here" items={current} data={data} onOpen={openContainer} /><LocationWorkflowLane title="Arriving here" subtitle="Open handoffs with this destination" tone="arriving" items={arriving} data={data} onOpen={openContainer} /><LocationWorkflowLane title="Leaving here" subtitle="Open handoffs from this origin" tone="leaving" items={leaving} data={data} onOpen={openContainer} /></div></section>
    <div className="location-focused-columns"><section className="location-focused-section panel"><div className="location-focused-section__header"><div><span className="eyebrow">Local devices</span><h3>Scanner readiness</h3><p>Use Devices for changes; this summary makes local coverage visible without leaving the workspace.</p></div><button className="secondary" onClick={() => setPage("devices")}>Open Devices <ChevronRight size={14} /></button></div>{scanners.length ? <div className="location-scanner-list">{scanners.map((device) => <button key={device.deviceId} onClick={() => openDetail(deviceDetail(device, data))}><span className="location-scanner-list__icon"><Smartphone size={16} /></span><span><strong>{device.label}</strong><small>Scanner {scannerNumber(device.deviceId)} · {device.reportedAppVersion ?? "Version not reported"}</small></span><span className="location-scanner-list__state"><Pill tone={device.isActive ? "good" : "warn"}>{device.isActive ? "Enabled" : "Disabled"}</Pill><small>{relativeTime(device.lastReportedAt)}</small></span><ChevronRight size={14} /></button>)}</div> : <EmptyState>No scanners are assigned to this location.</EmptyState>}</section><section className="location-focused-section panel"><div className="location-focused-section__header"><div><span className="eyebrow">Local attention</span><h3>Reviews and recent observations</h3><p>{openReviews.length ? "These review items are linked to evidence recorded at this location." : "The latest scanner activity is clear for this location."}</p></div><div className="location-focused-section__header-actions"><button className="secondary" onClick={() => setPage("activity")}>Activity <ChevronRight size={14} /></button>{openReviews.length > 0 && <button className="secondary" onClick={() => setPage("exceptions")}>Review queue <ChevronRight size={14} /></button>}</div></div>{openReviews.length > 0 && <div className="location-review-list">{openReviews.slice(0, 4).map((item) => <button key={item.reviewCaseId} onClick={() => setPage("exceptions")}><span className="location-review-list__icon"><AlertTriangle size={15} /></span><span><strong>{item.containerLabel}</strong><small>{humanizeCode(item.reasonCode)} · opened {relativeTime(item.openedAt)}</small></span><Pill tone="warn">Needs review</Pill><ChevronRight size={14} /></button>)}</div>}<div className="location-activity-list">{localEvents.slice(0, 5).map((event) => <button key={event.eventId} onClick={() => openEvent(event)}><span><strong>{eventLabel(event.eventType)}</strong><small>{containerFor(event.containerId)?.label ?? "Container"} · {data.fixtures.devices.find((device) => device.deviceId === event.deviceId)?.label ?? "Scanner"}</small></span><time>{relativeTime(event.eventAt)}</time><ChevronRight size={14} /></button>)}{localEvents.length === 0 && <div className="location-focused-empty">No scanner observations have been recorded at this location.</div>}</div></section></div>
     <section className="location-focused-health panel"><div><span className="eyebrow">Location health</span><h3>Trust signals for this site</h3><p>These signals describe evidence freshness, not the physical condition of containers.</p></div><div className="location-health-grid"><span><strong>{flaggedScans}</strong><small>Flagged observations</small><em>{flaggedScans ? "Review scan timing or scanner order" : "No scan flags"}</em></span><span><strong>{openReviews.length}</strong><small>Open reviews</small><em>{openReviews.length ? "Corporate decision may be needed" : "No local review queue"}</em></span><span><strong>{staleScanners.length}</strong><small>Stale scanners</small><em>{staleScanners.length ? "Confirm power and connectivity" : "All scanners reported recently"}</em></span><span><strong>{localEvents.length}</strong><small>Total observations</small><em>Retained in the immutable ledger</em></span></div></section>
  </div>;
}

function LocationsPage({ data, focusedLocationId, focusedLocationFilter, openLocation, openDetail, setPage, session }: { data: OperationsData; focusedLocationId?: string; focusedLocationFilter?: LocationInventoryFilter; openLocation: (locationId: string, filter?: LocationInventoryFilter) => void; openDetail: OpenDetail; setPage: (page: Page) => void; session: AdminSession | null }) {
  const physicalLocations = data.fixtures.locations.filter((location) => location.type !== "in_transit" && location.isActive !== false && !isUnknownLocation(location));
  const [selectedLocationId, setSelectedLocationIdState] = useState(physicalLocations[0]?.locationId ?? "");
  const setSelectedLocationId = (nextLocationId: string) => {
    setSelectedLocationIdState(nextLocationId);
    openLocation(nextLocationId);
  };
  const [locationQuery, setLocationQuery] = useState("");
  const [locationTypeFilter, setLocationTypeFilter] = useState<"all" | Location["type"]>("all");
  const [locationHealthFilter, setLocationHealthFilter] = useState<"all" | "attention">("all");
  const [locationSort, setLocationSort] = useState<"work" | "containers" | "activity" | "alphabetical">("work");
  if (focusedLocationId) return <LocationWorkspacePage data={data} locationId={focusedLocationId} {...(focusedLocationFilter ? { locationFilter: focusedLocationFilter } : {})} openLocation={openLocation} openDetail={openDetail} setPage={setPage} session={session} />;
  const selected = (physicalLocations.find((location) => location.locationId === selectedLocationId) ?? physicalLocations[0])!;
  if (!selected) return <section className="panel"><EmptyState>No active operating locations are available. Add or restore a location from Settings before reviewing workflow.</EmptyState><button className="secondary" onClick={() => setPage("settings")}><Settings size={15} /> Open Settings</button></section>;

  const transitId = data.fixtures.locations.find((location) => location.type === "in_transit")?.locationId;
  const container = (id: string) => data.fixtures.containers.find((item) => item.containerId === id);
  const eventsFor = (containerId: string) => data.events
    .filter((event) => event.containerId === containerId)
    .sort((left, right) => Date.parse(right.effectiveAt) - Date.parse(left.effectiveAt));
  const projections = Object.values(data.projections).filter(Boolean) as Projection[];
  const routeRecords: RouteRecord[] = data.fixtures.containers.map((item) => ({
    container: item,
    projection: data.projections[item.containerId] ?? null,
    route: getContainerRouteContext(item.containerId, data)
  }));
  const routeFor = (projection: Projection) => getContainerRouteContext(projection.containerId, data);
  const metricsFor = (location: Location): LocationMetric => {
    const current = projections.filter((projection) => projection.locationId === location.locationId);
    const moving = projections.filter((projection) => projection.locationId === transitId);
    const arriving = moving.filter((projection) => routeFor(projection).activeSegment?.destination?.locationId === location.locationId);
    const leaving = moving.filter((projection) => routeFor(projection).activeSegment?.origin?.locationId === location.locationId);
    const locationEvents = data.events.filter((event) => event.locationId === location.locationId);
    const scanners = data.fixtures.devices.filter((device) => device.assignedLocationId === location.locationId);
    return {
      location,
      current,
      arriving,
      leaving,
      eventsLastDay: locationEvents.filter((event) => Date.now() - Date.parse(event.receivedAt) <= 24 * 60 * 60 * 1000).length,
      flaggedEvents: locationEvents.filter((event) => event.accuracyFlags.length > 0).length,
      scanners,
      staleScanners: scanners.filter((device) => !device.lastReportedAt || Date.now() - Date.parse(device.lastReportedAt) > 24 * 60 * 60 * 1000).length,
      needsReview: current.filter((projection) => projection.health === "needs_review").length
    };
  };
  const locationMetrics = physicalLocations.map(metricsFor);
  const selectedMetric = locationMetrics.find((metric) => metric.location.locationId === selected.locationId)!;
  const moving = projections.filter((projection) => projection.locationId === transitId);
  const movingReviewCount = moving.filter((projection) => projection.health === "needs_review").length;
  const locationSearch = locationQuery.trim().toLowerCase();
  const matchingMetrics = locationMetrics
    .filter((metric) => locationTypeFilter === "all" || metric.location.type === locationTypeFilter)
    .filter((metric) => locationHealthFilter === "all" || metric.needsReview > 0 || metric.flaggedEvents > 0 || metric.staleScanners > 0)
    .filter((metric) => !locationSearch || `${metric.location.name} ${locationTypeLabel(metric.location.type)}`.toLowerCase().includes(locationSearch))
    .sort((left, right) => {
      if (locationSort === "alphabetical") return left.location.name.localeCompare(right.location.name);
      if (locationSort === "containers") return right.current.length - left.current.length;
      if (locationSort === "activity") return right.eventsLastDay - left.eventsLastDay;
      return (right.current.length + right.arriving.length + right.leaving.length + right.needsReview) - (left.current.length + left.arriving.length + left.leaving.length + left.needsReview);
    });
  const current = projections.filter((projection) => projection.locationId === selected.locationId);
  const arriving = moving.filter((projection) => routeFor(projection).activeSegment?.destination?.locationId === selected.locationId);
  const leaving = moving.filter((projection) => routeFor(projection).activeSegment?.origin?.locationId === selected.locationId);
  const openContainer = (projection: Projection) => openDetail({
    eyebrow: "Route container",
    title: container(projection.containerId)?.label ?? "Tracked container",
    body: <><DetailFacts items={[
      ["Current state", loadStateLabel(projection.loadState)],
      ["Official location", data.fixtures.locations.find((item) => item.locationId === projection.locationId)?.name ?? "Not observed"],
      ["History health", projectionHealthLabel(projection.health)],
      ["Last observed", relativeTime(projection.lastObservedAt)]
    ]}/><h3 className="detail-section-title">Immutable observation history</h3><EventEvidence events={eventsFor(projection.containerId)} data={data}/></>
  });

  const openRouteRecord = (record: RouteRecord) => {
    if (record.projection) {
      openContainer(record.projection);
      return;
    }
    openDetail({
      eyebrow: "Container lifecycle",
      title: record.container.label,
      icon: <ContainerIcon size={18} />,
      summary: "Recorded route history for this container. No current projection is available.",
      body: <><DetailFacts items={[["Container type", record.container.type], ["Recorded handoffs", String(record.route.segments.length)], ["Journey", routeLocationNames(record.route).join(" → ") || "Locations not recorded"]]} /><h3 className="detail-section-title">Immutable observation history</h3><EventEvidence events={eventsFor(record.container.containerId)} data={data}/></>
    });
  };

  return <>
    <LocationNetworkOverview metrics={locationMetrics} movingCount={moving.length} movingReviewCount={movingReviewCount} routeRecords={routeRecords} onSelect={openLocation} onOpen={openRouteRecord} />
    <LocationRouteMatrix routeRecords={routeRecords} onSelect={openLocation} />
    <LocationLifecycleExplorer routeRecords={routeRecords} focusLocationId={selected.locationId} onOpen={(record) => {
      const projection = record.projection;
      if (projection) openContainer(projection);
      else openDetail({
        eyebrow: "Container lifecycle",
        title: record.container.label,
        icon: <ContainerIcon size={18} />,
        summary: "Recorded route history for this container. No current projection is available.",
        body: <><DetailFacts items={[["Container type", record.container.type], ["Recorded handoffs", String(record.route.segments.length)], ["Journey", routeLocationNames(record.route).join(" → ") || "Locations not recorded"]]} /><h3 className="detail-section-title">Immutable observation history</h3><EventEvidence events={eventsFor(record.container.containerId)} data={data}/></>
      });
    }} />
    <section className="location-selector panel">
      <div className="location-selector__heading"><PanelTitle title="Location directory" subtitle="Search, sort, and filter every physical location before opening its operating picture." /><div className="location-directory-tools"><label className="location-search"><Search size={17} /><input value={locationQuery} onChange={(event) => setLocationQuery(event.target.value)} placeholder="Search locations" aria-label="Search locations" /></label><select value={locationTypeFilter} onChange={(event) => setLocationTypeFilter(event.target.value as typeof locationTypeFilter)} aria-label="Filter by location type"><option value="all">All location types</option><option value="store_backroom">Stores</option><option value="donation_express">Donation Xpress</option><option value="warehouse">Warehouses</option></select><select value={locationHealthFilter} onChange={(event) => setLocationHealthFilter(event.target.value as typeof locationHealthFilter)} aria-label="Filter locations needing attention"><option value="all">All locations</option><option value="attention">Needs attention</option></select><select value={locationSort} onChange={(event) => setLocationSort(event.target.value as typeof locationSort)} aria-label="Sort locations"><option value="work">Sort by active work</option><option value="containers">Sort by containers here</option><option value="activity">Sort by 24h activity</option><option value="alphabetical">Sort A–Z</option></select></div></div>
      <div className="location-directory-summary"><span>Showing <b>{matchingMetrics.length}</b> of {physicalLocations.length} locations</span><span>{matchingMetrics.reduce((total, metric) => total + metric.current.length, 0)} containers in the filtered view</span><span>{matchingMetrics.reduce((total, metric) => total + metric.needsReview, 0)} need review</span></div>
      <div className="location-selector__list">{matchingMetrics.map((metric) => {
        const location = metric.location;
        return <button key={location.locationId} className={`location-directory-card ${location.locationId === selected.locationId ? "active" : ""}`} onClick={() => setSelectedLocationId(location.locationId)}><span className={`location-type-icon location-type-icon--${location.type}`}><LocationTypeIcon location={location} /></span><span className="location-directory-card__body"><b>{location.name}</b><small>{locationTypeLabel(location.type)} · {metric.scanners.length} scanner{metric.scanners.length === 1 ? "" : "s"}</small><span className="location-directory-card__stats"><span><strong>{metric.current.length}</strong> here</span><span><strong>{metric.arriving.length}</strong> in</span><span><strong>{metric.leaving.length}</strong> out</span><span><strong>{metric.eventsLastDay}</strong> scans</span></span></span><span className="location-directory-card__status">{metric.needsReview > 0 ? <Pill tone="warn">{metric.needsReview} review</Pill> : metric.staleScanners > 0 ? <Pill tone="warn">{metric.staleScanners} stale</Pill> : <Pill tone="good">Operating</Pill>}<ChevronRight size={17} /></span></button>;
      })}{matchingMetrics.length === 0 && <div className="location-selector__empty">No locations match the current search and filters.</div>}</div>
    </section>

     {false && <section className="location-workspace panel">
      <div className="location-workspace__head">
        <div><span className="eyebrow">Selected operating location</span><h2><span className={`location-title-icon location-title-icon--${selected.type}`}><LocationTypeIcon location={selected} size={20} /></span>{selected.name}</h2><p>One place to review containers physically here, inbound, and outbound without mixing simultaneous routes together.</p><div className="location-workspace__actions"><button className="secondary location-details-button" onClick={() => openDetail(locationDetail(selected, data, setPage, openDetail))}><MapPin size={15} /> Location details</button><button className="secondary location-details-button" onClick={() => setPage("activity")}><Activity size={15} /> View activity</button></div></div>
        <div className="location-workspace__counts"><span><b>{current.length}</b> here</span><span><b>{arriving.length}</b> arriving</span><span><b>{leaving.length}</b> leaving</span></div>
      </div>
      <div className="location-workspace__signals"><article><span className="location-workspace__signal-icon location-workspace__signal-icon--blue"><Boxes size={17} /></span><div><small>Current containers</small><strong>{current.length}</strong><em>{current.length ? "Officially assigned here" : "No confirmed containers"}</em></div></article><article><span className="location-workspace__signal-icon location-workspace__signal-icon--green"><ArrowRight size={17} /></span><div><small>Inbound / outbound</small><strong>{arriving.length} / {leaving.length}</strong><em>Recorded route involvement</em></div></article><article><span className="location-workspace__signal-icon location-workspace__signal-icon--orange"><AlertTriangle size={17} /></span><div><small>Attention</small><strong>{selectedMetric.needsReview + selectedMetric.flaggedEvents}</strong><em>{selectedMetric.needsReview ? "Containers need a decision" : selectedMetric.flaggedEvents ? "Flagged observations" : "No active flags"}</em></div></article><article><span className="location-workspace__signal-icon location-workspace__signal-icon--slate"><Wifi size={17} /></span><div><small>Scanner coverage</small><strong>{selectedMetric.scanners.filter((device) => device.isActive).length} / {selectedMetric.scanners.length}</strong><em>{selectedMetric.staleScanners ? `${selectedMetric.staleScanners} stale report${selectedMetric.staleScanners === 1 ? "" : "s"}` : `${selectedMetric.eventsLastDay} scans in 24 hours`}</em></div></article></div>
      <div className="workflow-lanes">
        <LocationWorkflowLane title="Containers at this location" subtitle="Official current state is this location" tone="here" items={current} data={data} onOpen={openContainer} />
        <LocationWorkflowLane title="Containers arriving" subtitle="In transit with this location as the recorded destination" tone="arriving" items={arriving} data={data} onOpen={openContainer} />
        <LocationWorkflowLane title="Containers leaving" subtitle="In transit after departing this location" tone="leaving" items={leaving} data={data} onOpen={openContainer} />
      </div>
     </section>}
   </>;
}

function LocationAdministrationPanel({
  data,
  session,
  refresh,
  setPage,
  retiredLocations
}: {
  data: OperationsData;
  session: AdminSession | null;
  refresh: () => Promise<void>;
  setPage: (page: Page) => void;
  retiredLocations?: Location[];
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [locationName, setLocationName] = useState("");
  const [locationType, setLocationType] = useState<ManagedLocationType>("store_backroom");
  const [retireLocationId, setRetireLocationId] = useState("");
  const [dependencies, setDependencies] = useState<LocationDependencySummary | null>(null);
  const [retireTarget, setRetireTarget] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeLocations = data.fixtures.locations.filter(
    (location) => location.type !== "in_transit" && location.isActive !== false && !isUnknownLocation(location)
  );
  const retired = retiredLocations ?? data.fixtures.locations.filter(
    (location) => location.type !== "in_transit" && location.isActive === false && !isUnknownLocation(location)
  );
  const principal = session?.principal;
  const canCreate = principal?.role === "organization_owner" || principal?.role === "operations_administrator";
  const canRetire = principal?.role === "organization_owner";
  const selectedRetireLocation = activeLocations.find((location) => location.locationId === retireLocationId);
  const selectedTargetLocation = activeLocations.find((location) => location.locationId === retireTarget);
  const targetIsUnknown = retireTarget === "unknown";
  const hasDevices = Boolean(dependencies?.devices.length);
  const hasManagers = Boolean(dependencies?.managers.length);

  const resetRetirement = () => {
    setDependencies(null);
    setRetireTarget("");
    setConfirmation("");
    setError(null);
  };

  const inspectDependencies = async () => {
    if (!session || !retireLocationId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setDependencies(await getLocationDependencies(session, retireLocationId));
      setRetireTarget("");
      setConfirmation("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Location dependencies could not be loaded.");
    } finally {
      setBusy(false);
    }
  };

  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!session || !canCreate) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await createLocation(session, { name: locationName.trim(), type: locationType });
      setLocationName("");
      setCreateOpen(false);
      await refresh();
      setNotice("Location added. It is now available in scanner assignment and workflow views.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Location could not be added.");
    } finally {
      setBusy(false);
    }
  };

  const submitRetire = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!session || !canRetire || !selectedRetireLocation || !dependencies) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await retireLocation(session, selectedRetireLocation.locationId, {
        confirmation: confirmation.trim(),
        ...(targetIsUnknown
          ? { moveDevicesToUnknown: true }
          : selectedTargetLocation
            ? { replacementLocationId: selectedTargetLocation.locationId }
            : {})
      });
      await refresh();
      setRetireLocationId("");
      resetRetirement();
      setNotice(
        result.movedDeviceCount
          ? `${selectedRetireLocation.name} was retired and ${result.movedDeviceCount} scanner${result.movedDeviceCount === 1 ? " was" : "s were"} moved safely.`
          : `${selectedRetireLocation.name} was retired. Its scan and load history remains available for audit.`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Location could not be retired.");
    } finally {
      setBusy(false);
    }
  };

  return <section className="location-admin-panel panel">
    <div className="location-admin-panel__header">
      <div>
        <span className="eyebrow">Location administration</span>
        <h2>Maintain the operating location directory.</h2>
        <p>This is infrequent, high-impact configuration. Add a new site or retire one that has closed only after checking scanners, managers, and historical dependencies. Retirement preserves every historical scan.</p>
      </div>
      {canCreate && <button className="primary" onClick={() => { setCreateOpen((value) => !value); setError(null); }}>{createOpen ? <X size={15} /> : <Building2 size={15} />}{createOpen ? "Close form" : "Add location"}</button>}
    </div>
    {notice && <div className="location-admin-notice"><CheckCircle2 size={17} /><span>{notice}</span></div>}
    {error && <div className="location-admin-notice location-admin-notice--error"><AlertTriangle size={17} /><span>{error}</span></div>}
    {createOpen && canCreate && <form className="location-create-form" onSubmit={(event) => void submitCreate(event)}>
      <div><strong>Add an operating location</strong><small>The name is shown to scanners and administrators. “In transit” is a system handoff and cannot be added here.</small></div>
      <label><span>Location name</span><input value={locationName} onChange={(event) => setLocationName(event.target.value)} placeholder="Example: Folsom Store" maxLength={120} disabled={busy} autoFocus /></label>
      <label><span>Location type</span><select value={locationType} onChange={(event) => setLocationType(event.target.value as ManagedLocationType)} disabled={busy}><option value="store_backroom">Store</option><option value="donation_express">Donation Xpress</option><option value="warehouse">Warehouse</option></select></label>
      <button className="primary" type="submit" disabled={busy || locationName.trim().length < 2}>{busy ? "Adding…" : "Add location"}</button>
    </form>}
    <div className="location-admin-panel__body">
      <div className="location-admin-stat"><span><Building2 size={17} /></span><div><strong>{activeLocations.length}</strong><small>active operating locations</small></div></div>
      <div className="location-admin-stat"><span><ScrollText size={17} /></span><div><strong>{retired.length}</strong><small>retired names retained in history</small></div></div>
      <div className="location-admin-policy"><ShieldCheck size={17} /><div><strong>Retirement is deliberately rare.</strong><p>Before retiring a site, update its scanners where possible. If a scanner cannot be updated immediately, the controlled fallback is <b>Unknown location</b>; no observation is silently reassigned.</p></div></div>
    </div>
    {canRetire && <form className="location-retire-form" onSubmit={(event) => void submitRetire(event)}>
      <div className="location-retire-form__heading"><div><strong>Retire a location</strong><small>First inspect its dependencies. The final action requires the exact location name and Organization Owner approval.</small></div><Pill tone="warn">High impact</Pill></div>
      <div className="location-retire-form__controls"><label><span>Location to retire</span><select value={retireLocationId} onChange={(event) => { setRetireLocationId(event.target.value); resetRetirement(); }} disabled={busy}><option value="">Select an active location</option>{activeLocations.map((location) => <option key={location.locationId} value={location.locationId}>{location.name}</option>)}</select></label><button className="secondary" type="button" disabled={busy || !retireLocationId} onClick={() => void inspectDependencies()}>{busy ? "Checking…" : "Check dependencies"}</button></div>
      {dependencies && selectedRetireLocation && <div className="location-dependency-review">
        <div className="location-dependency-review__headline"><div><span className="eyebrow">Before you retire {selectedRetireLocation.name}</span><strong>Review what will be affected.</strong></div><button className="icon-button" type="button" aria-label="Clear dependency review" onClick={resetRetirement}><X size={16} /></button></div>
         <div className="location-dependency-grid"><div><b>{dependencies.devices.length}</b><span>assigned scanners</span></div><div><b>{dependencies.managers.length}</b><span>scoped administrators</span></div><div><b>{dependencies.currentContainerCount}</b><span>containers last observed here</span></div><div><b>{dependencies.loadCodeCount}</b><span>load codes created here</span></div><div><b>{dependencies.observationCount}</b><span>immutable observations</span></div></div>
        {hasDevices && <div className="location-retire-warning"><AlertTriangle size={18} /><div><strong>Scanners are still assigned to this location.</strong><p>Move them individually from the Devices page when possible. If one cannot be updated, choose a destination below so it remains usable without claiming it is at a closed site.</p><button className="secondary" type="button" onClick={() => setPage("devices")}><Smartphone size={14} /> Open scanner administration</button></div></div>}
        {hasManagers && <div className="location-retire-warning location-retire-warning--manager"><AlertTriangle size={18} /><div><strong>Location Manager access is still assigned.</strong><p>Update these administrator scopes in Settings before retiring the site. StackTrack will not silently remove a manager’s access or leave a stale assignment behind.</p><ul>{dependencies.managers.map((manager) => <li key={manager.userId}>{manager.displayName} <span>@{manager.username}</span></li>)}</ul><button className="secondary" type="button" onClick={() => setPage("settings")}><UserRound size={14} /> Open administrator access</button></div></div>}
        {!hasDevices && <div className="location-retire-safe"><CheckCircle2 size={17} /><span>No scanners are assigned. Historical container observations and load codes will remain linked to this location name.</span></div>}
        <label className="location-retire-destination"><span>Remaining scanner destination {hasDevices ? "(required)" : "(optional)"}</span><select value={retireTarget} onChange={(event) => setRetireTarget(event.target.value)} disabled={busy}><option value="">Move scanners first (recommended)</option><option value="unknown">Unknown location</option>{activeLocations.filter((location) => location.locationId !== selectedRetireLocation.locationId).map((location) => <option key={location.locationId} value={location.locationId}>{location.name}</option>)}</select></label>
        <div className="location-retire-history-note"><ScrollText size={16} /><span><strong>History is preserved.</strong> {dependencies.currentContainerCount ? `${dependencies.currentContainerCount} container${dependencies.currentContainerCount === 1 ? " remains" : "s remain"} recorded against this name;` : "No containers are currently observed here;"} the original scan events and load-code origins will not be edited.</span></div>
        <label className="location-retire-confirm"><span>Type “{selectedRetireLocation.name}” to confirm</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={selectedRetireLocation.name} disabled={busy} /></label>
        <button className="primary location-retire-button" type="submit" disabled={busy || hasManagers || confirmation.trim() !== selectedRetireLocation.name || (hasDevices && !retireTarget)}>{busy ? "Retiring…" : hasManagers ? "Update manager scopes first" : "Retire this location"}</button>
      </div>}
    </form>}
    {retired.length > 0 && <div className="location-retired-list"><div><strong>Retired location names</strong><small>Kept so historical records stay understandable; they are not available for new scanner assignments.</small></div><div>{retired.map((location) => <span key={location.locationId}><MapPin size={13} />{location.name}<Pill tone="muted">Retired</Pill></span>)}</div></div>}
  </section>;
}

function LocationWorkflowLane({ title, subtitle, tone, items, data, onOpen }: { title: string; subtitle: string; tone: "here" | "arriving" | "leaving"; items: Projection[]; data: OperationsData; onOpen: (projection: Projection) => void }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, 8);
  const locationName = (id: string | null) => data.fixtures.locations.find((location) => location.locationId === id)?.name ?? "Unconfirmed";
  return <section className={`workflow-lane workflow-lane--${tone}`}>
    <header><span>{tone === "here" ? <Boxes size={18} /> : tone === "arriving" ? <ArrowRight size={18} /> : <Truck size={18} />}</span><div><h3>{title}</h3><p>{subtitle}</p></div><b>{items.length}</b></header>
    <div className="workflow-lane__items">{visible.length ? visible.map((projection) => {
      const record = data.fixtures.containers.find((container) => container.containerId === projection.containerId);
      const route = getContainerRouteContext(projection.containerId, data);
      const routeLabel = tone === "arriving" || tone === "leaving"
        ? `${route.origin?.name ?? "Origin pending"} → ${route.destination?.name ?? "Destination pending"}`
        : locationName(projection.locationId);
      const routeDescription = tone === "arriving"
        ? "Inbound handoff"
        : tone === "leaving"
          ? "Outbound handoff"
          : locationName(projection.locationId);
      return <button key={projection.containerId} onClick={() => onOpen(projection)}><span><strong>{record?.label ?? "Unknown"}</strong><small>{record?.type} · {loadStateLabel(projection.loadState)} · {routeLabel}</small><em>{routeDescription}{route.segments.length > 1 ? ` · ${route.segments.length} handoffs recorded` : ""}</em></span><Pill tone={projection.health === "needs_review" ? "warn" : projection.loadState === "loaded" ? "blue" : "good"}>{projection.health === "needs_review" ? "Needs review" : loadStateLabel(projection.loadState)}</Pill><ChevronRight size={16} /></button>;
    }) : <div className="workflow-lane__empty">No containers in this workflow lane.</div>}</div>
    {items.length > 8 && <button className="workflow-lane__more" onClick={() => setExpanded((value) => !value)}>{expanded ? "Show fewer" : `Show all ${items.length}`}</button>}
  </section>;
}

function locationDetail(location: Location, data: OperationsData, setPage?: (page: Page) => void, openDetail?: OpenDetail): DetailView {
  const projections = Object.values(data.projections).filter(Boolean) as Projection[];
  const containersHere = projections.filter((projection) => projection.locationId === location.locationId);
  const assignedDevices = data.fixtures.devices.filter((device) => device.assignedLocationId === location.locationId);
  const recentEvents = data.events.filter((event) => event.locationId === location.locationId).slice(0, 10);
  const routeHandoffs = data.fixtures.containers.flatMap((container) => {
    const route = getContainerRouteContext(container.containerId, data);
    return route.segments.filter((segment) => segment.origin?.locationId === location.locationId || segment.destination?.locationId === location.locationId).map((segment) => ({ container, segment }));
  }).sort((left, right) => Date.parse(right.segment.departedAt) - Date.parse(left.segment.departedAt)).slice(0, 8);
  const typeLabel = location.type === "donation_express" ? "Donation Xpress" : location.type === "warehouse" ? "Warehouse" : location.type === "in_transit" ? "In transit" : "Store";
  return {
    eyebrow: "Operating location",
    title: location.name,
    icon: <LocationTypeIcon location={location} size={18} />,
    status: { label: `${containersHere.length} container${containersHere.length === 1 ? "" : "s"} here`, tone: containersHere.some((projection) => projection.health === "needs_review") ? "warn" : "good" },
    summary: `${typeLabel} record with assigned scanners and the latest observations associated with this location.`,
    recordId: location.locationId,
    recordIdLabel: "Location UUID",
    actions: setPage ? <><button className="secondary" onClick={() => setPage("devices")}><Smartphone size={15} /> Manage scanners</button><button className="secondary" onClick={() => setPage("containers")}><ContainerIcon size={15} /> View containers</button></> : undefined,
    body: <>
      <DetailFacts items={[["Location type", typeLabel], ["Active scanners", String(assignedDevices.length)], ["Containers here", String(containersHere.length)], ["Needs review", String(containersHere.filter((projection) => projection.health === "needs_review").length)], ["Latest event", recentEvents[0] ? relativeTime(recentEvents[0].receivedAt) : "No observations"]]} />
      <h3 className="detail-section-title">Route checkpoints touching this location</h3>
      {routeHandoffs.length ? <div className="detail-related-list detail-related-list--routes">{routeHandoffs.map(({ container, segment }) => <div key={segment.segmentId}><span className="detail-related-list__icon"><GitBranch size={15} /></span><div><strong>{container.label}</strong><small>{segment.origin?.name ?? "Origin not recorded"} → {segment.destination?.name ?? "Destination not recorded"}</small></div><Pill tone={segment.status === "received" ? "good" : segment.status === "in_transit" ? "blue" : "warn"}>{segment.status === "received" ? "Received" : segment.status === "in_transit" ? "In transit" : "Rerouted"}</Pill></div>)}</div> : <p className="detail-empty-note">No handoff checkpoints currently reference this location.</p>}
      <h3 className="detail-section-title">Assigned scanners</h3>
      {assignedDevices.length ? <div className="detail-related-list">{assignedDevices.map((device) => <div key={device.deviceId}><span className="detail-related-list__icon"><Smartphone size={15} /></span><div><strong>{device.label}</strong><small>Scanner {scannerNumber(device.deviceId)} · {device.isActive ? "Scanning enabled" : "Disabled"}</small></div><Pill tone={device.isActive ? "good" : "warn"}>{device.isActive ? "Online" : "Disabled"}</Pill></div>)}</div> : <EmptyState>No scanners are currently assigned to this location.</EmptyState>}
      <h3 className="detail-section-title">Latest location observations</h3>
      <EventEvidence events={recentEvents} data={data} />
    </>
  };
}

function LegacyExceptionsPage({ data, openDetail }: { data: OperationsData; openDetail: OpenDetail }) {
  const exceptions = Object.values(data.projections).filter((item) => item?.health === "needs_review") as Projection[];
  const containerName = (id: string) => data.fixtures.containers.find((item) => item.containerId === id)?.label;
  return <section className="panel exceptions-panel">
    <div className="accuracy-summary"><span><ShieldCheck size={25} /></span><div><strong>Evidence is preserved</strong><p>Reviewing an exception will create a correction record. It will not rewrite or delete the original device observations.</p></div></div>
    {exceptions.length === 0 ? <EmptyState>No contradictory scans are waiting for a manager.</EmptyState> : exceptions.map((projection) => (
      <article className="exception-card" key={projection.containerId}>
        <div className="exception-card__icon"><AlertTriangle size={22} /></div>
        <div className="exception-card__body">
          <div><Pill tone="warn">Major correction</Pill><span>{relativeTime(projection.lastReceivedAt)}</span></div>
          <h2>{containerName(projection.containerId)} has two active load assignments</h2>
          <p>The second load was accepted as evidence but was not applied to the official state. A corporate data steward should confirm which load remains active.</p>
          <div className="evidence"><span><strong>{projection.conflicts.length}</strong> conflict</span><span><strong>{projection.appliedEventIds?.length ?? 0}</strong> applied events</span><span><strong>{projection.warnings.length}</strong> data-quality warnings</span></div>
        </div>
        <div className="exception-card__actions"><button className="primary" onClick={() => openDetail({
          eyebrow: "Controlled correction",
          title: `Review ${containerName(projection.containerId)}`,
          body: <><div className="detail-callout detail-callout--warn"><AlertTriangle size={20}/><span>This case is ready for workflow testing, but approval is intentionally unavailable until Goodwill confirms corporate roles and Entra authentication.</span></div><DetailFacts items={[
            ["Impact", "Material state correction"],
            ["Required authority", "Corporate data steward"],
            ["Evidence retained", `${projection.appliedEventIds.length + projection.conflicts.flatMap((item) => item.eventIds).length} event references`],
            ["Proposed next step", "Select the authoritative active load"]
          ]}/><h3 className="detail-section-title">Implementation status</h3><p className="detail-lead">The database already contains append-only correction request and correction action tables. The next production slice will add signed-in actors, reason capture, and two-person approval where required.</p></>
        })}>Start review</button><button className="secondary" onClick={() => openDetail({
          eyebrow: "Preserved evidence",
          title: `${containerName(projection.containerId)} event history`,
          body: <EventEvidence events={data.events.filter((event) => event.containerId === projection.containerId)} data={data}/>
        })}>View evidence</button></div>
      </article>
    ))}
  </section>;
}

function correctionStatusLabel(status: CorrectionRequest["status"]) {
  return {
    pending: "Pending approval",
    approved: "Approved",
    rejected: "Rejected",
    reopened: "Pending approval"
  }[status];
}

function CorrectionRequestForm({
  data,
  session,
  refresh
}: {
  data: OperationsData;
  session: AdminSession;
  refresh: () => Promise<void>;
}) {
  const observedContainers = data.fixtures.containers
    .filter((item) => data.projections[item.containerId])
    .sort((left, right) => left.label.localeCompare(right.label));
  const [containerId, setContainerId] = useState(observedContainers[0]?.containerId ?? "");
  const [locationId, setLocationId] = useState("");
  const [loadState, setLoadState] = useState<"" | Projection["loadState"]>("");
  const [impactLevel, setImpactLevel] = useState<"routine" | "material">("material");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projection = data.projections[containerId];
  const currentLocation = data.fixtures.locations.find(
    (item) => item.locationId === projection?.locationId
  );
  const canRequest =
    session.principal.role === "organization_owner" ||
    session.principal.role === "operations_administrator" ||
    session.principal.role === "location_manager";
  const changed =
    (locationId !== "" && locationId !== projection?.locationId) ||
    (loadState !== "" && loadState !== projection?.loadState);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await createCorrectionRequest(session, {
        containerId,
        impactLevel,
        reason,
        proposedCorrection: {
          ...(locationId ? { locationId } : {}),
          ...(loadState ? { loadState } : {})
        }
      });
      setLocationId("");
      setLoadState("");
      setReason("");
      setImpactLevel("material");
      await refresh();
      setNotice("Correction request recorded. The original scan evidence is unchanged.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Correction request could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="correction-request-panel">
      <div className="correction-request-panel__intro">
        <span><FilePenLine size={22} /></span>
        <div>
          <h2>Request an official-state correction</h2>
          <p>Choose only the fields that are wrong. StackTrack keeps every original scan and records the requester, approver, reason, and before/after evidence.</p>
        </div>
      </div>
      {!canRequest ? (
        <div className="device-read-only">Read-only access: you can inspect correction history but cannot request a change.</div>
      ) : (
        <form className="correction-form" onSubmit={(event) => void submit(event)}>
          <label>
            Container
            <select value={containerId} onChange={(event) => { setContainerId(event.target.value); setLocationId(""); setLoadState(""); }}>
              {observedContainers.map((container) => (
                <option value={container.containerId} key={container.containerId}>{container.label} · {container.type}</option>
              ))}
            </select>
          </label>
          <div className="correction-current">
            <span>Current official view</span>
            <strong>{loadStateLabel(projection?.loadState)} · {currentLocation?.name ?? "No confirmed location"}</strong>
            {projection?.administrativeCorrection && <small>Includes approved correction {projection.administrativeCorrection.correctionRequestId.slice(0, 8)}</small>}
          </div>
          <div className="correction-form__grid">
            <label>
              Correct location
              <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
                <option value="">No location change</option>
                {data.fixtures.locations.filter((item) => item.type !== "in_transit").map((location) => (
                  <option value={location.locationId} key={location.locationId}>{location.name}</option>
                ))}
              </select>
            </label>
            <label>
              Correct state
              <select value={loadState} onChange={(event) => setLoadState(event.target.value as typeof loadState)}>
                <option value="">No state change</option>
                <option value="loaded">Loaded</option>
                <option value="empty">Empty</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>
            <label>
              Impact
              <select value={impactLevel} onChange={(event) => setImpactLevel(event.target.value as typeof impactLevel)}>
                <option value="material">Material · second owner approval</option>
                <option value="routine">Routine · owner approval</option>
              </select>
            </label>
          </div>
          <label>
            Evidence and reason
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Describe what was verified, why the official state is wrong, and who confirmed the physical container." />
          </label>
          {impactLevel === "material" && (
            <div className="correction-policy-note"><ShieldCheck size={18} /><span>The requester cannot approve their own material correction. A different Organization Owner must verify it.</span></div>
          )}
          {error && <div className="sign-in-error">{error}</div>}
          {notice && <div className="device-notice">{notice}</div>}
          <button className="primary" disabled={busy || !changed || reason.trim().length < 8}>
            {busy ? "Recording…" : "Submit correction request"}
          </button>
        </form>
      )}
    </section>
  );
}

function CorrectionCard({
  item,
  data,
  session,
  onAction
}: {
  item: CorrectionRequest;
  data: OperationsData;
  session: AdminSession;
  onAction: (action: CorrectionAction, reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const location = item.proposedCorrection.locationId
    ? data.fixtures.locations.find((entry) => entry.locationId === item.proposedCorrection.locationId)
    : null;
  const projection = data.projections[item.containerId];
  const isPending = item.status === "pending" || item.status === "reopened";
  const isEffective =
    item.status === "approved" &&
    projection?.administrativeCorrection?.correctionRequestId === item.correctionRequestId;
  const canDecide = session.principal.role === "organization_owner";
  const selfApprovalBlocked =
    item.impactLevel === "material" &&
    item.requestedByUserId === session.principal.userId;

  const act = async (action: CorrectionAction) => {
    setBusy(true);
    setError(null);
    try {
      await onAction(action, reason);
      setReason("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Correction decision could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`correction-card correction-card--${item.status}`}>
      <div className="correction-card__head">
        <div>
          <Pill tone={isPending ? "warn" : item.status === "approved" ? "good" : "muted"}>{correctionStatusLabel(item.status)}</Pill>
          {isEffective && <Pill tone="blue">Applied to official view</Pill>}
          {item.status === "approved" && !isEffective && <Pill tone="muted">Superseded by newer scan</Pill>}
        </div>
        <time>{relativeTime(item.latestActionAt ?? item.requestedAt)}</time>
      </div>
      <div className="correction-card__body">
        <div>
          <span className="asset-label">{item.containerLabel}</span>
          <h2>{item.impactLevel === "material" ? "Material" : "Routine"} correction request</h2>
          <p>{item.reason}</p>
        </div>
        <div className="correction-targets">
          {location && <span><MapPin size={15} /><small>Correct location</small><strong>{location.name}</strong></span>}
          {item.proposedCorrection.loadState && <span><ContainerIcon size={15} /><small>Correct state</small><strong>{loadStateLabel(item.proposedCorrection.loadState)}</strong></span>}
        </div>
        <dl>
          <div><dt>Requested by</dt><dd>{item.requestedByDisplayName}</dd></div>
          <div><dt>Requested</dt><dd>{new Date(item.requestedAt).toLocaleString()}</dd></div>
          <div><dt>Recorded decisions</dt><dd>{item.actionCount}</dd></div>
          {item.latestActorDisplayName && <div><dt>Latest decision by</dt><dd>{item.latestActorDisplayName}</dd></div>}
        </dl>
        {item.latestActionReason && <div className="review-last-action"><strong>Latest decision reason:</strong> {item.latestActionReason}</div>}
        {canDecide && (
          <label className="review-reason">
            <span>{isPending ? "Decision reason" : "Reopen reason"}</span>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} placeholder={isPending ? "State what evidence you verified before deciding." : "Explain why this correction needs another review."} />
          </label>
        )}
        {selfApprovalBlocked && isPending && <div className="correction-policy-note"><ShieldCheck size={18}/><span>A different Organization Owner must approve this material correction. You may still reject it.</span></div>}
        {error && <div className="sign-in-error">{error}</div>}
      </div>
      {canDecide && (
        <div className="correction-card__actions">
          {isPending ? (
            <>
              <button className="secondary" disabled={busy || reason.trim().length < 8} onClick={() => void act("rejected")}>{busy ? "Recording…" : "Reject"}</button>
              <button className="primary" disabled={busy || reason.trim().length < 8 || selfApprovalBlocked} onClick={() => void act("approved")}>{busy ? "Recording…" : "Approve correction"}</button>
            </>
          ) : (
            <button className="secondary" disabled={busy || reason.trim().length < 8} onClick={() => void act("reopened")}>{busy ? "Recording…" : "Reopen for review"}</button>
          )}
        </div>
      )}
    </article>
  );
}

function CorrectionsPage({
  data,
  query,
  session,
  refresh
}: {
  data: OperationsData;
  query: string;
  session: AdminSession;
  refresh: () => Promise<void>;
}) {
  const [filter, setFilter] = useState<"active" | "approved" | "rejected" | "all">("active");
  const normalizedQuery = query.trim().toLowerCase();
  const items = data.correctionRequests
    .filter((item) =>
      !normalizedQuery ||
      item.containerLabel.toLowerCase().includes(normalizedQuery) ||
      item.requestedByDisplayName.toLowerCase().includes(normalizedQuery)
    )
    .filter((item) =>
      filter === "all"
        ? true
        : filter === "active"
          ? item.status === "pending" || item.status === "reopened"
          : item.status === filter
    );

  return (
    <>
      <CorrectionRequestForm data={data} session={session} refresh={refresh} />
      <section className="panel corrections-history">
        <div className="toolbar">
          <div className="filter-tabs">
            {(["active", "approved", "rejected", "all"] as const).map((value) => (
              <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
                {value[0]!.toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
          <span className="date-chip"><FilePenLine size={15}/> {data.correctionRequests.length} total requests</span>
        </div>
        {items.length ? (
          <div className="correction-list">
            {items.map((item) => (
              <CorrectionCard
                key={item.correctionRequestId}
                item={item}
                data={data}
                session={session}
                onAction={async (action, reason) => {
                  await correctionRequestAction(
                    session,
                    item.correctionRequestId,
                    action,
                    reason
                  );
                  await refresh();
                }}
              />
            ))}
          </div>
        ) : (
          <EmptyState>
            {data.correctionRequests.length
              ? "No correction requests match this filter."
              : "No governed corrections have been requested. Original scan evidence remains authoritative."}
          </EmptyState>
        )}
      </section>
    </>
  );
}

type ActivityWindow = "all" | "today" | "7d" | "30d";

type ActivityEventNeighbors = {
  previousContainer?: StoredEvent;
  nextContainer?: StoredEvent;
  previousScanner?: StoredEvent;
  nextScanner?: StoredEvent;
};

function activityEventColor(containerId: string): CSSProperties {
  let hash = 0;
  for (const character of containerId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  // Keep relationship colors in a calm blue/teal/violet range. Red and orange
  // are reserved for genuine warnings so a normal container group never looks
  // like an operational problem.
  const hue = 160 + (hash % 130);
  return {
    "--timeline-accent": `hsl(${hue} 56% 40%)`,
    "--timeline-rail": `hsl(${hue} 48% 78%)`,
    "--timeline-wash": `hsl(${hue} 46% 98%)`
  } as CSSProperties;
}

function activityEventOrder(left: StoredEvent, right: StoredEvent) {
  return Date.parse(left.eventAt) - Date.parse(right.eventAt)
    || Date.parse(left.receivedAt) - Date.parse(right.receivedAt)
    || left.eventId.localeCompare(right.eventId);
}

function activityLocalBoundary(dateValue: string, timeValue: string, endOfMinute = false) {
  const dateParts = dateValue.split("-").map(Number);
  if (dateParts.length !== 3 || !dateParts.every(Number.isFinite)) return null;
  const [year, month, day] = dateParts;
  const timeParts = timeValue ? timeValue.split(":").map(Number) : [endOfMinute ? 23 : 0, endOfMinute ? 59 : 0];
  const [hours, minutes] = timeParts;
  if (![year, month, day, hours, minutes].every(Number.isFinite)) return null;
  const value = new Date(year!, month! - 1, day, hours, minutes, endOfMinute ? 59 : 0, endOfMinute ? 999 : 0);
  return Number.isNaN(value.getTime()) ? null : value.getTime();
}

function activityMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours! * 60 + minutes! : null;
}

function ActivityPage({ data, query, openDetail, setPage }: { data: OperationsData; query: string; openDetail: OpenDetail; setPage: (page: Page) => void }) {
  const [eventFilters, setEventFilters] = useState<StoredEvent["eventType"][]>([]);
  const [locationFilters, setLocationFilters] = useState<string[]>([]);
  const [deviceFilters, setDeviceFilters] = useState<string[]>([]);
  const [windowFilter, setWindowFilter] = useState<ActivityWindow>("all");
  const [fromDate, setFromDate] = useState("");
  const [fromTime, setFromTime] = useState("");
  const [toDate, setToDate] = useState("");
  const [toTime, setToTime] = useState("");
  const containerName = (id: string) => data.fixtures.containers.find((item) => item.containerId === id)?.label ?? "Unknown container";
  const locationName = (id: string) => data.fixtures.locations.find((item) => item.locationId === id)?.name ?? "Unknown location";
  const deviceFor = (id: string) => data.fixtures.devices.find((item) => item.deviceId === id);
  const searchTerm = query.trim().toLowerCase();
  const eventOrder = [...data.events].sort(activityEventOrder);
  const neighborsByEventId = new Map<string, ActivityEventNeighbors>();
  const previousContainerEvent = new Map<string, StoredEvent>();
  const previousScannerEvent = new Map<string, StoredEvent>();
  for (const event of eventOrder) {
    const neighbors = neighborsByEventId.get(event.eventId) ?? {};
    const previousContainer = previousContainerEvent.get(event.containerId);
    const previousScanner = previousScannerEvent.get(event.deviceId);
    if (previousContainer) {
      neighbors.previousContainer = previousContainer;
      const previousNeighbors = neighborsByEventId.get(previousContainer.eventId) ?? {};
      previousNeighbors.nextContainer = event;
      neighborsByEventId.set(previousContainer.eventId, previousNeighbors);
    }
    if (previousScanner) {
      neighbors.previousScanner = previousScanner;
      const previousNeighbors = neighborsByEventId.get(previousScanner.eventId) ?? {};
      previousNeighbors.nextScanner = event;
      neighborsByEventId.set(previousScanner.eventId, previousNeighbors);
    }
    neighborsByEventId.set(event.eventId, neighbors);
    previousContainerEvent.set(event.containerId, event);
    previousScannerEvent.set(event.deviceId, event);
  }
  const customFrom = fromDate ? activityLocalBoundary(fromDate, fromTime) : null;
  const customTo = toDate ? activityLocalBoundary(toDate, toTime, true) : null;
  const quickStart = windowFilter === "today" ? Date.now() - 24 * 60 * 60 * 1000 : windowFilter === "7d" ? Date.now() - 7 * 24 * 60 * 60 * 1000 : windowFilter === "30d" ? Date.now() - 30 * 24 * 60 * 60 * 1000 : null;
  const lowerBound = customFrom === null ? quickStart : quickStart === null ? customFrom : Math.max(customFrom, quickStart);
  const upperBound = customTo === null ? Date.now() : Math.min(customTo, Date.now());
  const dateRangeError = customFrom !== null && customTo !== null && customFrom > customTo
    ? "The start of the range must be before the end of the range."
    : null;
  const hasDateRange = Boolean(fromDate || toDate);
  const fromMinutes = activityMinutes(fromTime);
  const toMinutes = activityMinutes(toTime);
  const locationOptions = data.fixtures.locations.map((location) => ({ value: location.locationId, label: location.name }));
  const deviceOptions = data.fixtures.devices.map((device) => ({ value: device.deviceId, label: `${scannerNumber(device.deviceId)} · ${device.label}` }));
  const actionOptions = [
    { value: "load_assigned", label: "Marked full" },
    { value: "batch_out", label: "Departed / in transit" },
    { value: "batch_in", label: "Arrived" },
    { value: "emptied", label: "Marked empty" }
  ] as const;
  const events = data.events.filter((event) => {
    const device = deviceFor(event.deviceId);
    const relatedLocationIds = [event.locationId, payloadLocationId(event, "sourceLocationId"), payloadLocationId(event, "destinationLocationId")].filter((value): value is string => Boolean(value));
    const searchable = [
      containerName(event.containerId),
      eventLabel(event.eventType),
      event.eventType,
      event.eventId,
      event.loadCodeId ?? "",
      String(event.payload.displayLoadCode ?? ""),
      String(event.payload.goodsType ?? ""),
      String(event.payload.secondaryValue ?? ""),
      locationName(event.locationId),
      ...relatedLocationIds.map(locationName),
      device?.label ?? "",
      scannerNumber(event.deviceId),
      event.accuracyFlags.join(" ")
    ].join(" ").toLowerCase();
    const eventTimestamp = Date.parse(event.eventAt);
    const eventLocalTime = new Date(eventTimestamp);
    const eventMinutes = eventLocalTime.getHours() * 60 + eventLocalTime.getMinutes();
    const timeOfDayMatches = hasDateRange || (fromMinutes === null && toMinutes === null)
      ? true
      : fromMinutes === null
        ? eventMinutes <= toMinutes!
        : toMinutes === null
          ? eventMinutes >= fromMinutes
          : fromMinutes <= toMinutes
            ? eventMinutes >= fromMinutes && eventMinutes <= toMinutes
            : eventMinutes >= fromMinutes || eventMinutes <= toMinutes;
    return (!eventFilters.length || eventFilters.includes(event.eventType)) &&
      (!searchTerm || searchable.includes(searchTerm)) &&
      (!locationFilters.length || locationFilters.some((locationId) => relatedLocationIds.includes(locationId))) &&
      (!deviceFilters.length || deviceFilters.includes(event.deviceId)) &&
      (lowerBound === null || eventTimestamp >= lowerBound) &&
      eventTimestamp <= upperBound &&
      timeOfDayMatches;
  }).sort((left, right) => -activityEventOrder(left, right));
  const visibleEvents = events.slice(0, 100);
  const clearFilters = () => { setEventFilters([]); setLocationFilters([]); setDeviceFilters([]); setWindowFilter("all"); setFromDate(""); setFromTime(""); setToDate(""); setToTime(""); };
  const hasFilters = Boolean(searchTerm || locationFilters.length || deviceFilters.length || windowFilter !== "all" || eventFilters.length || fromDate || fromTime || toDate || toTime);
  const filtersInvalid = Boolean(dateRangeError);
  return <section className="panel activity-page">
    <div className="activity-purpose"><div><span className="eyebrow">Operational feed</span><strong>Physical observations from scanners</strong><p>Use Activity to trace where a container was scanned and how the movement unfolded. For administrator changes, sign-ins, device controls, and approvals, use Audit trail.</p></div><button className="secondary" onClick={() => setPage("audit")}><ScrollText size={15} /> Open audit trail</button></div>
    <div className="activity-filter-panel">
      <div className="activity-filter-panel__header"><div><span className="eyebrow">Filter observations</span><h2>Choose exactly what to review</h2><p>Choose one action, location, or scanner at a time. Every selection applies immediately; clear a field to return to all results.</p></div><div className="activity-filter-panel__actions"><span className="date-chip">{events.length} shown</span><button className="secondary" onClick={clearFilters} disabled={!hasFilters}>Clear filters</button><span className="filter-live-note">Live filters</span></div></div>
      <div className="activity-filters activity-filters--expanded">
        <SingleFilterSelect label="Actions" options={actionOptions} value={eventFilters[0] ?? ""} onChange={(value) => setEventFilters(value ? [value as StoredEvent["eventType"]] : [])} emptyLabel="All actions" />
        <SingleFilterSelect label="Locations" options={locationOptions} value={locationFilters[0] ?? ""} onChange={(value) => setLocationFilters(value ? [value] : [])} emptyLabel="All locations" />
        <SingleFilterSelect label="Scanners" options={deviceOptions} value={deviceFilters[0] ?? ""} onChange={(value) => setDeviceFilters(value ? [value] : [])} emptyLabel="All scanners" />
        <label>Quick time window<select value={windowFilter} onChange={(event) => setWindowFilter(event.target.value as ActivityWindow)}><option value="all">All available</option><option value="today">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label>
        <label>From date<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
        <label>From time<input type="time" value={fromTime} onChange={(event) => setFromTime(event.target.value)} /></label>
        <label>To date<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
        <label>To time<input type="time" value={toTime} onChange={(event) => setToTime(event.target.value)} /></label>
      </div>
      {dateRangeError && <p className="activity-filter-error" role="alert">{dateRangeError}</p>}
      {(fromDate || toDate || fromTime || toTime) && !filtersInvalid && <p className="activity-filter-help">{fromDate && !toDate ? `From ${fromDate}${fromTime ? ` at ${fromTime}` : ""} through now.` : toDate && !fromDate ? `Through ${toDate}${toTime ? ` at ${toTime}` : ""}.` : fromDate && toDate ? `${fromDate}${fromTime ? ` ${fromTime}` : ""} through ${toDate}${toTime ? ` ${toTime}` : ""}.` : `Daily events between ${fromTime || "00:00"} and ${toTime || "23:59"}${fromMinutes !== null && toMinutes !== null && fromMinutes > toMinutes ? " (overnight)" : ""}.`}</p>}
    </div>
    {searchTerm && <p className="activity-search-summary">Searching event IDs, load codes, goods, containers, scanners, locations, and warning text for <strong>“{query.trim()}”</strong>.</p>}
     {filtersInvalid ? <EmptyState>Adjust the time range to see scanner observations.</EmptyState> : events.length ? <div className="timeline">{visibleEvents.map((event, index) => {
       const container = data.fixtures.containers.find((item) => item.containerId === event.containerId);
       const location = locationName(event.locationId);
       // Relationships are resolved against the complete event history, not the
       // filtered list. A location/scanner filter must never make unrelated rows
       // look adjacent simply because the intervening evidence was hidden.
       const neighbors = neighborsByEventId.get(event.eventId) ?? {};
       const sameScanner = Boolean(neighbors.previousScanner || neighbors.nextScanner);
       const sameContainer = Boolean(neighbors.previousContainer || neighbors.nextContainer);
       const adjacentSameContainer = visibleEvents[index - 1]?.containerId === event.containerId || visibleEvents[index + 1]?.containerId === event.containerId;
       const relationship = sameContainer ? adjacentSameContainer ? "Same container · adjacent event" : "Same container · history" : sameScanner ? "Same scanner · different container" : null;
       const eventRoute = getContainerRouteContext(event.containerId, data);
       const eventSegment = eventRoute.segments.find((segment) => segment.departureEventId === event.eventId || segment.receiptEventId === event.eventId);
       const routeText = eventSegment ? `${eventSegment.origin?.name ?? "Origin pending"} → ${eventSegment.destination?.name ?? "Destination pending"}` : null;
       const relationshipClass = sameContainer ? "" : "timeline__relationship--scanner";
       return <article className={`clickable-timeline ${sameContainer ? "clickable-timeline--linked" : ""} ${adjacentSameContainer ? "clickable-timeline--adjacent" : ""}`} style={activityEventColor(event.containerId)} key={event.eventId} onClick={() => openDetail({
         eyebrow: "Scanner observation",
         icon: <FileClock size={18} />,
         status: event.accuracyFlags.length ? { label: "Review evidence", tone: "warn" } : { label: "No data-quality warnings", tone: "good" },
        summary: "A physical observation received from a shared scanner. Use this feed for movement history; use Audit trail for administrator actions.",
        recordId: event.eventId,
        recordIdLabel: "Event UUID",
        title: `${container?.label ?? "Unknown container"} · ${eventLabel(event.eventType)}`,
         body: <><DetailFacts items={[["Observed at", new Date(event.eventAt).toLocaleString()], ["Received at", new Date(event.receivedAt).toLocaleString()], ["Location", location], ["Scanner", `${scannerNumber(event.deviceId)} · ${deviceFor(event.deviceId)?.label ?? "Unknown"}`], ["Handoff", routeText ?? "Not a location handoff"], ["Message for operations", eventMessage(event) ?? "No message recorded"], ["Load code", String(event.payload.displayLoadCode ?? event.loadCodeId ?? "Not assigned")]]}/><h3 className="detail-section-title">Observation evidence</h3><EventEvidence events={[event]} data={data}/></>
         })}><div className={`timeline__rail ${adjacentSameContainer ? "timeline__rail--linked" : ""}`}><span>{index + 1}</span>{adjacentSameContainer && <i aria-hidden="true" />}</div><div className="timeline__card"><div className="timeline__card-heading"><span><span className={`timeline__event-pill timeline__event-pill--${event.eventType}`}>{eventLabel(event.eventType)}</span>{event.accuracyFlags.length > 0 && <span className="timeline__warning">Needs review</span>}{relationship && <span className={`timeline__relationship ${relationshipClass}`}><Link2 size={11} />{relationship}</span>}</span><time>{new Date(event.eventAt).toLocaleString()}</time></div><h3>{container?.label ?? "Unknown container"}</h3><p className="timeline__narrative">{eventNarrative(event, data)}</p>{eventMessage(event) && <p className="timeline__message"><MessageSquare size={11} />Message for operations: {eventMessage(event)}</p>}<p className="timeline__meta"><span className="timeline__scanner"><Smartphone size={11} />{deviceFor(event.deviceId)?.label ?? `Scanner ${scannerNumber(event.deviceId)}`}</span>{routeText && <span className="timeline__route"><GitBranch size={11} />Route: {routeText}</span>}<span>received {relativeTime(event.receivedAt)}</span>{event.accuracyFlags.length > 0 && <span>{event.accuracyFlags.length} data-quality warning{event.accuracyFlags.length === 1 ? "" : "s"}</span>}</p></div></article>;
     })}</div> : <EmptyState>No scanner observations match these filters. Try another location, scanner, time window, or search term.</EmptyState>}
    {events.length > 100 && <p className="activity-limit-note">Showing the newest 100 matching observations. Use the filters to narrow the feed further.</p>}
  </section>;
}

function LegacyActivityPage({ data, query, openDetail }: { data: OperationsData; query: string; openDetail: OpenDetail }) {
  const [eventFilter, setEventFilter] = useState<"all" | StoredEvent["eventType"]>("all");
  const c = (id: string) => data.fixtures.containers.find((item) => item.containerId === id);
  const l = (id: string) => data.fixtures.locations.find((item) => item.locationId === id)?.name;
  const events = data.events.filter((event) => {
    const label = c(event.containerId)?.label ?? "";
    return (eventFilter === "all" || event.eventType === eventFilter) && label.toLowerCase().includes(query.toLowerCase());
  });
  return <section className="panel"><div className="toolbar"><div className="filter-tabs">{(["all", "load_assigned", "batch_out", "batch_in", "emptied"] as const).map((value) => <button key={value} className={eventFilter === value ? "active" : ""} onClick={() => setEventFilter(value)}>{value === "all" ? "All events" : eventLabel(value)}</button>)}</div><span className="date-chip">{events.length} shown</span></div><div className="timeline">{events.slice(0, 100).map((event, index) => (
    <article className="clickable-timeline" key={event.eventId} onClick={() => openDetail({
      eyebrow: "Immutable ledger event",
      icon: <FileClock size={18} />,
      status: event.accuracyFlags.length ? { label: "Review evidence", tone: "warn" } : { label: "No data-quality warnings", tone: "good" },
      summary: "The original scanner observation is preserved exactly as received by StackTrack.",
      recordId: event.eventId,
      recordIdLabel: "Event UUID",
      title: `${c(event.containerId)?.label} · ${eventLabel(event.eventType)}`,
      body: <><DetailFacts items={[
        ["Observed at", new Date(event.eventAt).toLocaleString()],
        ["Received at", new Date(event.receivedAt).toLocaleString()],
        ["Location", l(event.locationId) ?? "Unknown"],
        ["Event UUID", event.eventId]
        ]}/><h3 className="detail-section-title">Accuracy evidence</h3><p className="detail-lead">{event.accuracyFlags.length ? event.accuracyFlags.map(accuracyFlagDetail).join(" · ") : "No data-quality warnings were recorded."}</p><EventEvidence events={[event]} data={data}/></>
    })}><div className="timeline__rail"><span>{index + 1}</span><i /></div><div className="timeline__card">
      <div><Pill tone="blue">{eventLabel(event.eventType)}</Pill><time>{new Date(event.eventAt).toLocaleString()}</time></div>
      <h3>{c(event.containerId)?.label} · {l(event.locationId)}</h3>
      <p>Event {event.eventId.slice(0, 8)} · received {relativeTime(event.receivedAt)} · {event.accuracyFlags.length ? `${event.accuracyFlags.length} warning` : "no data-quality warnings"}</p>
    </div></article>
  ))}</div></section>;
}

type DeviceStatusFilter = "all" | "enabled" | "disabled" | "stale" | "attention";
type DeviceSort = "attention" | "status" | "location" | "last_reported" | "scanner_id" | "name" | "observations";

function DevicesPage({ data, query, setQuery, openDetail, refresh, session, onRequestSignIn }: { data: OperationsData; query: string; setQuery: (query: string) => void; openDetail: OpenDetail; refresh: () => Promise<void>; session: AdminSession | null; onRequestSignIn: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const [locationFilter, setLocationFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<DeviceStatusFilter>("all");
  const [versionFilter, setVersionFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState<DeviceSort>("attention");
  const operatingLocations = data.fixtures.locations.filter((location) => location.type !== "in_transit" && location.isActive !== false);
  const allLocations = data.fixtures.locations
    .filter((location) => location.type !== "in_transit")
    .sort((left, right) => left.name.localeCompare(right.name));
  const locationName = (locationId: string | null | undefined) => data.fixtures.locations.find((location) => location.locationId === locationId)?.name ?? "Unknown location";
  const isStale = (device: Device) => {
    if (!device.lastReportedAt) return true;
    const reportedAt = Date.parse(device.lastReportedAt);
    return !Number.isFinite(reportedAt) || Date.now() - reportedAt > 24 * 60 * 60 * 1000;
  };
  const needsAttention = (device: Device) => !device.isActive || isStale(device) || !device.reportedAppVersion;
  const versions = Array.from(new Set(data.fixtures.devices.map((device) => device.reportedAppVersion).filter((version): version is string => Boolean(version)))).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const searchTerm = query.trim().toLowerCase();
  const filteredDevices = data.fixtures.devices.filter((device) => {
    const assignedLocation = locationName(device.assignedLocationId);
    const previousLocations = data.fixtures.deviceAssignments
      .filter((entry) => entry.deviceId === device.deviceId)
      .flatMap((entry) => [entry.previousLocationId, entry.assignedLocationId])
      .map((locationId) => locationName(locationId))
      .join(" ");
    const searchText = `${device.label} ${scannerNumber(device.deviceId)} ${assignedLocation} ${previousLocations}`.toLowerCase();
    const statusMatches = statusFilter === "all"
      || (statusFilter === "enabled" && device.isActive)
      || (statusFilter === "disabled" && !device.isActive)
      || (statusFilter === "stale" && isStale(device))
      || (statusFilter === "attention" && needsAttention(device));
    const versionMatches = versionFilter === "all"
      || (versionFilter === "not_reported" && !device.reportedAppVersion)
      || device.reportedAppVersion === versionFilter;
    return (!searchTerm || searchText.includes(searchTerm))
      && (locationFilter === "all" || device.assignedLocationId === locationFilter || (locationFilter === "unknown" && !data.fixtures.locations.some((location) => location.locationId === device.assignedLocationId)))
       && statusMatches
       && versionMatches;
   });
  const sortDevices = (devices: Device[]) => [...devices].sort((left, right) => {
    const leftLocation = locationName(left.assignedLocationId);
    const rightLocation = locationName(right.assignedLocationId);
    if (sortOrder === "attention") {
      const score = (device: Device) => (device.isActive ? 0 : 4) + (isStale(device) ? 3 : 0) + (!device.reportedAppVersion ? 2 : 0);
      return score(right) - score(left) || leftLocation.localeCompare(rightLocation) || left.label.localeCompare(right.label);
    }
    if (sortOrder === "status") return Number(right.isActive) - Number(left.isActive) || leftLocation.localeCompare(rightLocation) || left.label.localeCompare(right.label);
    if (sortOrder === "location") return leftLocation.localeCompare(rightLocation) || left.label.localeCompare(right.label);
    if (sortOrder === "last_reported") {
      const leftReported = left.lastReportedAt ? Date.parse(left.lastReportedAt) : Number.NEGATIVE_INFINITY;
      const rightReported = right.lastReportedAt ? Date.parse(right.lastReportedAt) : Number.NEGATIVE_INFINITY;
      return rightReported - leftReported || left.label.localeCompare(right.label);
    }
    if (sortOrder === "scanner_id") return scannerNumber(left.deviceId).localeCompare(scannerNumber(right.deviceId), undefined, { numeric: true });
    if (sortOrder === "observations") return data.events.filter((event) => event.deviceId === right.deviceId).length - data.events.filter((event) => event.deviceId === left.deviceId).length || left.label.localeCompare(right.label);
    return left.label.localeCompare(right.label) || leftLocation.localeCompare(rightLocation);
  });
  const matchingDevices = sortDevices(filteredDevices);
  const staleCount = data.fixtures.devices.filter(isStale).length;
  const disabledCount = data.fixtures.devices.filter((device) => !device.isActive).length;
  const hasFilters = Boolean(searchTerm) || locationFilter !== "all" || statusFilter !== "all" || versionFilter !== "all" || sortOrder !== "attention";
  const clearFilters = () => { setQuery(""); setLocationFilter("all"); setStatusFilter("all"); setVersionFilter("all"); setSortOrder("attention"); };
  const save = async (device: Device, update: { label?: string; assignedLocationId?: string; isActive?: boolean; assignmentReason?: string }) => {
    if (!session) { onRequestSignIn(); return; }
    setBusyId(device.deviceId); setNotice(null);
    try {
      await updateDevice(device.deviceId, update, session);
      await refresh();
      const destination = update.assignedLocationId ? data.fixtures.locations.find((location) => location.locationId === update.assignedLocationId)?.name ?? "the selected location" : null;
      setNotice({ text: destination ? `${device.label} was moved to ${destination}. Use Refresh in the scanner app to apply the assignment immediately.` : update.label ? `${update.label} was saved as the scanner name.` : `${device.label} was ${update.isActive ? "enabled" : "disabled"}.`, tone: "success" });
    }
    catch (error) { setNotice({ text: error instanceof Error ? error.message : "Device update failed.", tone: "error" }); }
    finally { setBusyId(null); }
  };
  return <>
     {!session && <div className="access-lock"><ShieldCheck size={20}/><span><strong>Sign in to change scanners.</strong> You can inspect device records now; changes are locked until a verified Organization Owner or Operations Administrator signs in.</span><button className="secondary" onClick={onRequestSignIn}>Sign in</button></div>}
     {notice && <div className={`device-notice ${notice.tone === "error" ? "device-notice--error" : ""}`}>{notice.text}</div>}
     <section className="device-filter-panel" aria-label="Filter and sort scanners">
       <div className="device-filter-panel__header"><div><span className="eyebrow">Fleet view</span><h2>Find the right scanner</h2><p>The search box above checks scanner ID, name, current location, and previous assigned locations. Use these controls to narrow the fleet by operational state.</p></div><button className="secondary" onClick={clearFilters} disabled={!hasFilters}>Clear filters</button></div>
       <div className="device-filter-panel__grid">
         <label><span>Assigned location</span><select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}><option value="all">All locations</option>{allLocations.map((location) => <option key={location.locationId} value={location.locationId}>{location.name}{location.isActive === false ? " (inactive)" : ""}</option>)}<option value="unknown">Unknown location</option></select></label>
         <label><span>Scanner status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as DeviceStatusFilter)}><option value="all">All scanners</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option><option value="stale">No report in 24+ hours</option><option value="attention">Needs attention</option></select></label>
         <label><span>Installed version</span><select value={versionFilter} onChange={(event) => setVersionFilter(event.target.value)}><option value="all">All versions</option><option value="not_reported">Version not reported</option>{versions.map((version) => <option key={version} value={version}>{version}</option>)}</select></label>
         <label><span>Sort scanners by</span><select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as DeviceSort)}><option value="attention">Attention first</option><option value="status">Status (enabled first)</option><option value="location">Location A–Z</option><option value="last_reported">Last report (newest)</option><option value="scanner_id">Scanner ID</option><option value="name">Scanner name A–Z</option><option value="observations">Most observations</option></select></label>
       </div>
       <div className="device-filter-panel__summary"><strong>Showing {matchingDevices.length} of {data.fixtures.devices.length} scanners</strong><span>{data.fixtures.devices.length - disabledCount} enabled</span><span>{disabledCount} disabled</span><span>{staleCount} need a fresh report</span>{searchTerm && <span>Search: “{query.trim()}”</span>}</div>
     </section>
     {matchingDevices.length ? <div className="device-grid">{matchingDevices.map((device) => <DeviceCard key={device.deviceId} device={device} data={data} operatingLocations={operatingLocations} busy={busyId === device.deviceId} canManage={Boolean(session && ["organization_owner", "operations_administrator", "location_manager"].includes(session.principal.role))} canMoveAcrossLocations={session?.principal.role === "organization_owner"} onSave={save} onDetails={() => openDetail(deviceDetail(device, data))} />)}</div> : <EmptyState><span>No scanners match the current search and filters.</span><button className="secondary" onClick={clearFilters}>Clear filters</button></EmptyState>}
   </>;
}

function deviceDetail(device: Device, data: OperationsData): DetailView {
  const locationName = (id: string | null) => data.fixtures.locations.find((location) => location.locationId === id)?.name ?? "Unassigned";
  const events = data.events.filter((item) => item.deviceId === device.deviceId);
  const history = data.fixtures.deviceAssignments.filter((item) => item.deviceId === device.deviceId);
  const stale = !device.lastReportedAt || Date.now() - Date.parse(device.lastReportedAt) > 24 * 60 * 60 * 1000;
  return { eyebrow: "Shared scanner", title: device.label, icon: <Smartphone size={18} />, status: device.isActive ? { label: "Scanning enabled", tone: "good" } : { label: "Scanning disabled", tone: "warn" }, summary: "A shared field scanner with a server-assigned identity, location, and append-only control history.", recordId: device.deviceId, recordIdLabel: "Device UUID", body: <><DetailFacts items={[["Scanner ID", scannerNumber(device.deviceId)], ["Technical installation ID", device.installationId], ["Assigned location", locationName(device.assignedLocationId)], ["Scanning enabled", device.isActive ? "Yes" : "No"], ["Installed StackTrack version", device.reportedAppVersion ?? "Not reported by this device yet"], ["Last app report", relativeTime(device.lastReportedAt)]]}/>{stale && <div className="detail-callout detail-callout--warn"><AlertTriangle size={19}/><span><strong>Telemetry is stale.</strong> This scanner has not reported in over 24 hours. Confirm the device is powered on, connected, and still assigned to the right location.</span></div>}<h3 className="detail-section-title">Assignment history</h3>{history.length ? <div className="assignment-history">{history.map((entry: DeviceAssignment) => <article key={entry.assignmentHistoryId}><time>{new Date(entry.occurredAt).toLocaleString()}</time><strong>{locationName(entry.previousLocationId)} <ArrowRight size={14} /> {locationName(entry.assignedLocationId)}</strong><span>{entry.reason}</span><small>Preserved in the device audit history</small></article>)}</div> : <EmptyState>No location reassignment has been recorded yet.</EmptyState>}<h3 className="detail-section-title">Latest scanner activity</h3><EventEvidence events={events.slice(0, 12)} data={data}/></> };
}

function LegacyDeviceCard({ device, data, operatingLocations, busy, canManage, onSave, onDetails }: { device: Device; data: OperationsData; operatingLocations: Location[]; busy: boolean; canManage: boolean; onSave: (device: Device, update: { label?: string; assignedLocationId?: string; isActive?: boolean; requiredAppVersion?: string; assignmentReason?: string }) => Promise<void>; onDetails: () => void }) {
  const [label, setLabel] = useState(device.label);
  const [assignedLocationId, setAssignedLocationId] = useState(device.assignedLocationId);
  const [reason, setReason] = useState("");
  const requiredAppVersion = device.requiredAppVersion ?? "";
  const [requiredVersion, setRequiredVersion] = useState(requiredAppVersion);
  useEffect(() => { setLabel(device.label); setAssignedLocationId(device.assignedLocationId); setRequiredVersion(device.requiredAppVersion ?? ""); }, [device.label, device.assignedLocationId, device.requiredAppVersion]);
  const location = data.fixtures.locations.find((item) => item.locationId === device.assignedLocationId);
  const events = data.events.filter((item) => item.deviceId === device.deviceId);
  const assignmentChanged = assignedLocationId !== device.assignedLocationId;
  const labelChanged = label.trim() !== device.label;
  return <article className="device-card"><div className="phone-icon"><Smartphone /></div><div className={`device-card__status ${device.isActive ? "" : "device-card__status--disabled"}`}><i /> {device.isActive ? "SCANNING ENABLED" : "SCANNING DISABLED"}</div><h2>{device.label}</h2><p><MapPin size={15} /> Assigned to {location?.name ?? "Unassigned"}</p><label className="device-location-control"><span>Scanner name</span><div className="device-name-input"><input value={label} onChange={(event) => setLabel(event.target.value)} disabled={busy} placeholder="Example: Scanner 1" /><button className="secondary" disabled={busy || !labelChanged || label.trim().length < 2} onClick={() => void onSave(device, { label: label.trim() })}>{busy ? "Saving…" : "Save name"}</button></div></label><dl><div><dt>Scanner ID</dt><dd className="device-id">{scannerNumber(device.deviceId)}</dd></div><div><dt>Availability</dt><dd>{device.isActive ? "Enabled" : "Disabled"}</dd></div><div><dt>StackTrack version</dt><dd>{device.reportedAppVersion ?? "Not reported"}</dd></div><div><dt>Observations</dt><dd>{events.length}</dd></div><div><dt>Last app report</dt><dd>{relativeTime(device.lastReportedAt)}</dd></div></dl><label className="device-location-control"><span>Move scanner to</span><select value={assignedLocationId} disabled={busy} onChange={(event) => setAssignedLocationId(event.target.value)}>{operatingLocations.map((option) => <option value={option.locationId} key={option.locationId}>{option.name}</option>)}</select></label>{assignmentChanged && <label className="device-location-control"><span>Reason (optional)</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Example: Scanner moved with the Midtown store team." disabled={busy} /></label>}{assignmentChanged && <button className="primary device-save-assignment" disabled={busy} onClick={() => void onSave(device, { assignedLocationId, ...(reason.trim() ? { assignmentReason: reason.trim() } : {}) })}>{busy ? "Saving…" : "Record scanner move"}</button>}<div className="device-card__actions"><button className={device.isActive ? "secondary" : "primary"} disabled={busy} onClick={() => void onSave(device, { isActive: !device.isActive })}>{busy ? "Saving…" : device.isActive ? "Disable scanner" : "Enable scanner"}</button><button className="secondary" onClick={onDetails}>Details <ChevronRight size={16} /></button></div></article>;
}

type ReportsFilterDraft = {
  search: string;
  locationIds: string[];
  deviceIds: string[];
  actors: string[];
  eventTypes: StoredEvent["eventType"][];
  healthValues: Projection["health"][];
  from: string;
  to: string;
};

const emptyReportsFilters: ReportsFilterDraft = { search: "", locationIds: [], deviceIds: [], actors: [], eventTypes: [], healthValues: [], from: "", to: "" };

function ReportsPage({ data, openDetail }: { data: OperationsData; openDetail: OpenDetail }) {
  const [draft, setDraft] = useState<ReportsFilterDraft>(emptyReportsFilters);
  const [applied, setApplied] = useState<ReportsFilterDraft>(emptyReportsFilters);
  const locationName = (id: string | null | undefined) => data.fixtures.locations.find((location) => location.locationId === id)?.name ?? "Unknown location";
  const deviceName = (id: string | null | undefined) => data.fixtures.devices.find((device) => device.deviceId === id)?.label ?? "Unknown scanner";
  const containerLabel = (id: string | null | undefined) => data.fixtures.containers.find((container) => container.containerId === id)?.label ?? "Unknown container";
  const fromTimestamp = applied.from ? Date.parse(`${applied.from}T00:00:00`) : null;
  const toTimestamp = applied.to ? Date.parse(`${applied.to}T23:59:59.999`) : null;
  const inDateRange = (value: string | null | undefined) => {
    if (!value) return fromTimestamp === null && toTimestamp === null;
    const timestamp = Date.parse(value);
    return (fromTimestamp === null || timestamp >= fromTimestamp) && (toTimestamp === null || timestamp <= toTimestamp);
  };
  const searchTerm = applied.search.trim().toLowerCase();
  const eventMatches = (event: StoredEvent) => {
    const relatedLocationIds = [event.locationId, payloadLocationId(event, "sourceLocationId"), payloadLocationId(event, "destinationLocationId")].filter((value): value is string => Boolean(value));
    const searchable = [event.eventId, containerLabel(event.containerId), eventLabel(event.eventType), ...relatedLocationIds.map(locationName), deviceName(event.deviceId), ...event.accuracyFlags].join(" ").toLowerCase();
    return (!searchTerm || searchable.includes(searchTerm)) && (!applied.locationIds.length || applied.locationIds.some((locationId) => relatedLocationIds.includes(locationId))) && (!applied.deviceIds.length || applied.deviceIds.includes(event.deviceId)) && (!applied.eventTypes.length || applied.eventTypes.includes(event.eventType)) && inDateRange(event.eventAt);
  };
  const filteredEvents = data.events.filter(eventMatches).sort((left, right) => Date.parse(right.eventAt) - Date.parse(left.eventAt));
  const projectionMatches = (projection: Projection) => {
    const relatedEvents = data.events.filter((event) => event.containerId === projection.containerId);
    const relatedLocationIds = [projection.locationId, ...relatedEvents.flatMap((event) => [event.locationId, payloadLocationId(event, "sourceLocationId"), payloadLocationId(event, "destinationLocationId")])].filter((value): value is string => Boolean(value));
    const searchable = [containerLabel(projection.containerId), ...relatedLocationIds.map(locationName), ...relatedEvents.map((event) => `${event.eventId} ${deviceName(event.deviceId)}`)].join(" ").toLowerCase();
    const locationMatches = !applied.locationIds.length || applied.locationIds.some((locationId) => relatedLocationIds.includes(locationId));
    const deviceMatches = !applied.deviceIds.length || relatedEvents.some((event) => applied.deviceIds.includes(event.deviceId));
    const dateMatches = (!applied.from && !applied.to) || relatedEvents.some((event) => inDateRange(event.eventAt));
    const typeMatches = !applied.eventTypes.length || relatedEvents.some((event) => applied.eventTypes.includes(event.eventType) && inDateRange(event.eventAt));
    return (!searchTerm || searchable.includes(searchTerm)) && locationMatches && deviceMatches && dateMatches && typeMatches && (!applied.healthValues.length || applied.healthValues.includes(projection.health));
  };
  const filteredProjections = Object.values(data.projections).filter((projection): projection is Projection => {
    if (!projection) return false;
    return projectionMatches(projection);
  });
  const filteredCorrections = data.correctionRequests.filter((item) => {
    const searchable = [item.correctionRequestId, item.containerLabel, item.requestedByDisplayName, item.reason, item.latestActorDisplayName ?? ""].join(" ").toLowerCase();
    return (!searchTerm || searchable.includes(searchTerm)) && (!applied.locationIds.length || (item.proposedCorrection.locationId ? applied.locationIds.includes(item.proposedCorrection.locationId) : false)) && (!applied.actors.length || applied.actors.includes(item.requestedByDisplayName) || (item.latestActorDisplayName ? applied.actors.includes(item.latestActorDisplayName) : false)) && inDateRange(item.requestedAt);
  });
  const actorOptions = Array.from(new Set([...data.auditEntries.map((entry) => entry.actorDisplayName), ...data.correctionRequests.flatMap((item) => [item.requestedByDisplayName, item.latestActorDisplayName ?? ""]).filter(Boolean)])).sort((left, right) => left.localeCompare(right));
  const reportLocationOptions = data.fixtures.locations
    .map((location) => ({ value: location.locationId, label: `${location.name}${location.type === "in_transit" ? " · virtual transit" : ""}` }))
    .sort((left, right) => left.label.localeCompare(right.label));
  const reportDeviceOptions = data.fixtures.devices
    .map((device) => ({ value: device.deviceId, label: `${scannerNumber(device.deviceId)} · ${device.label}` }))
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));
  const filteredAuditEntries = data.auditEntries.filter((entry) => {
    const searchable = [entry.auditId, entry.action, entry.targetType, entry.targetLabel ?? "", entry.actorDisplayName, entry.locationName ?? "", humanizeDetailsText(entry.details, data)].join(" ").toLowerCase();
    const deviceMatches = !applied.deviceIds.length || applied.deviceIds.includes(entry.targetId ?? "") || (typeof entry.details.deviceId === "string" && applied.deviceIds.includes(entry.details.deviceId));
    const locationMatches = !applied.locationIds.length || applied.locationIds.includes(entry.locationId ?? "") || (typeof entry.details.locationId === "string" && applied.locationIds.includes(entry.details.locationId)) || (typeof entry.details.assignedLocationId === "string" && applied.locationIds.includes(entry.details.assignedLocationId));
    return (!searchTerm || searchable.includes(searchTerm)) && locationMatches && deviceMatches && (!applied.actors.length || applied.actors.includes(entry.actorDisplayName)) && inDateRange(entry.occurredAt);
  });
  const filteredDevices = data.fixtures.devices.filter((device) => {
    const searchable = [device.deviceId, scannerNumber(device.deviceId), device.label, locationName(device.assignedLocationId), device.reportedAppVersion ?? ""].join(" ").toLowerCase();
    return (!searchTerm || searchable.includes(searchTerm)) && (!applied.locationIds.length || (device.assignedLocationId ? applied.locationIds.includes(device.assignedLocationId) : false)) && (!applied.deviceIds.length || applied.deviceIds.includes(device.deviceId)) && inDateRange(device.lastReportedAt);
  });
  const locationRows = Array.from(new Map(filteredEvents.map((event) => [event.locationId, event.locationId]))).map(([, locationId]) => {
    const events = filteredEvents.filter((event) => event.locationId === locationId);
    const flagged = events.filter((event) => event.accuracyFlags.length > 0).length;
    const containers = new Set(events.map((event) => event.containerId)).size;
    return { locationId, name: locationName(locationId), events: events.length, containers, flagged };
  }).sort((left, right) => right.events - left.events);
  const flaggedEvents = filteredEvents.filter((event) => event.accuracyFlags.length > 0);
  const reviewCount = filteredProjections.filter((projection) => projection.health === "needs_review").length;
  const warningCount = filteredProjections.filter((projection) => projection.health === "warning").length;
  const transitLocationId = data.fixtures.locations.find((location) => location.type === "in_transit")?.locationId;
  const transitCount = filteredProjections.filter((projection) => projection.locationId === transitLocationId).length;
  const transitRows = filteredProjections
    .filter((projection) => projection.locationId === transitLocationId)
    .map((projection) => {
      const route = getContainerRouteContext(projection.containerId, data);
      const outbound = route.activeSegment ? data.events.find((event) => event.eventId === route.activeSegment?.departureEventId) : undefined;
      const originId = route.activeSegment?.origin?.locationId ?? null;
      const destinationId = route.activeSegment?.destination?.locationId ?? null;
      const ageHours = outbound ? Math.max(0, (Date.now() - Date.parse(outbound.effectiveAt)) / 3_600_000) : null;
      return { projection, outbound, originId, destinationId, ageHours };
    })
    .sort((left, right) => (right.ageHours ?? -1) - (left.ageHours ?? -1));
  const routeRows = data.fixtures.containers.flatMap((container) => {
    const projection = data.projections[container.containerId] ?? null;
    const route = getContainerRouteContext(container.containerId, data);
    return route.segments.map((segment) => {
      const departure = data.events.find((event) => event.eventId === segment.departureEventId);
      const receipt = segment.receiptEventId ? data.events.find((event) => event.eventId === segment.receiptEventId) : undefined;
       const locationMatches = !applied.locationIds.length || applied.locationIds.some((locationId) => segment.origin?.locationId === locationId || segment.destination?.locationId === locationId || departure?.locationId === locationId || receipt?.locationId === locationId);
       const deviceMatches = !applied.deviceIds.length || applied.deviceIds.includes(departure?.deviceId ?? "") || applied.deviceIds.includes(receipt?.deviceId ?? "");
       const typeMatches = !applied.eventTypes.length || applied.eventTypes.some((eventType) => eventType === "batch_out" || (eventType === "batch_in" && Boolean(receipt)));
      const dateMatches = inDateRange(departure?.eventAt) || Boolean(receipt && inDateRange(receipt.eventAt));
      const searchable = [container.label, segment.origin?.name ?? "", segment.destination?.name ?? "", departure?.eventId ?? "", receipt?.eventId ?? "", deviceName(departure?.deviceId), segment.status].join(" ").toLowerCase();
      return { container, projection, segment, departure, receipt, searchable, locationMatches, deviceMatches, typeMatches, dateMatches };
    });
   }).filter((row) => (!searchTerm || row.searchable.includes(searchTerm)) && row.locationMatches && row.deviceMatches && row.typeMatches && ((!applied.from && !applied.to) || row.dateMatches) && (!applied.healthValues.length || (row.projection ? applied.healthValues.includes(row.projection.health) : false)));
  const latencyRows = Array.from(new Map(filteredEvents.map((event) => [event.deviceId, event.deviceId]))).map(([, deviceId]) => {
    const events = filteredEvents.filter((event) => event.deviceId === deviceId);
    const latencies = events.map((event) => Math.max(0, (Date.parse(event.receivedAt) - Date.parse(event.eventAt)) / 1_000)).filter(Number.isFinite);
    return { deviceId, events: events.length, averageSeconds: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : 0, maxSeconds: latencies.length ? Math.round(Math.max(...latencies)) : 0, flagged: events.filter((event) => event.accuracyFlags.length).length };
  }).sort((left, right) => right.averageSeconds - left.averageSeconds);
  const latencySeconds = (event: StoredEvent) => {
    const value = (Date.parse(event.receivedAt) - Date.parse(event.eventAt)) / 1_000;
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : "";
  };
  const lateUploadCount = filteredEvents.filter((event) => latencySeconds(event) !== "" && Number(latencySeconds(event)) > 900).length;
  const staleDevices = filteredDevices.filter((device) => !device.lastReportedAt || Date.now() - Date.parse(device.lastReportedAt) > 24 * 60 * 60 * 1000);
   const registrationScopeAvailable = !applied.locationIds.length && !applied.deviceIds.length && !applied.eventTypes.length && !applied.healthValues.length && !applied.from && !applied.to;
  const unobservedContainers = registrationScopeAvailable ? data.fixtures.containers.filter((container) => !data.projections[container.containerId] && (!searchTerm || container.label.toLowerCase().includes(searchTerm))).length : null;
  const integrityPercent = filteredEvents.length ? Math.round(((filteredEvents.length - flaggedEvents.length) / filteredEvents.length) * 100) : 100;
  const deviceFreshnessPercent = filteredDevices.length ? Math.round(((filteredDevices.length - staleDevices.length) / filteredDevices.length) * 100) : 100;
  const activeFilterCount = [applied.search, applied.locationIds.length, applied.deviceIds.length, applied.actors.length, applied.eventTypes.length, applied.healthValues.length, applied.from, applied.to].filter(Boolean).length;
  const draftDateError = draft.from && draft.to && draft.from > draft.to ? "The start date must be on or before the end date." : null;
  useEffect(() => {
    if (!draftDateError) setApplied(draft);
  }, [draft, draftDateError]);
  const updateDraft = <K extends keyof ReportsFilterDraft>(key: K, value: ReportsFilterDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const clearFilters = () => { setDraft(emptyReportsFilters); setApplied(emptyReportsFilters); };
  const reportScopeParts = [
    applied.locationIds.length ? `${applied.locationIds.length} location${applied.locationIds.length === 1 ? "" : "s"}` : "",
    applied.deviceIds.length ? `${applied.deviceIds.length} scanner${applied.deviceIds.length === 1 ? "" : "s"}` : "",
    applied.actors.length ? `${applied.actors.length} user${applied.actors.length === 1 ? "" : "s"}` : "",
    applied.eventTypes.length ? `${applied.eventTypes.length} action${applied.eventTypes.length === 1 ? "" : "s"}` : "",
    applied.healthValues.length ? `${applied.healthValues.length} health state${applied.healthValues.length === 1 ? "" : "s"}` : "",
    applied.from || applied.to ? "date range" : "",
    applied.search ? "text search" : ""
  ].filter(Boolean);
  const reportScope = reportScopeParts.length ? reportScopeParts.join(" · ") : "All available operations data";
  const openHealthDetail = () => openDetail({
    eyebrow: "Data quality guide",
    title: "How to read data health",
    icon: <CircleHelp size={18} />,
    summary: "Data health describes evidence quality and operational follow-up. It is not a claim that every physical container is correct.",
    body: <div className="health-definition-list">
      <article><Pill tone={integrityPercent >= 98 ? "good" : "warn"}>{integrityPercent >= 98 ? "Strong" : "Review"}</Pill><div><strong>Observation integrity — {integrityPercent}%</strong><p>Share of scanner observations without timestamp or scanner-order issues. A flagged event is retained; it means an administrator should verify the circumstances before relying on it for a correction.</p><small>Use case: find late uploads, duplicate scans, or offline devices that may make movement appear out of order.</small></div></article>
      <article><Pill tone={reviewCount ? "warn" : "good"}>{reviewCount ? "Open" : "Clear"}</Pill><div><strong>Containers needing review — {reviewCount}</strong><p>Containers whose projection has conflicting evidence or an unresolved exception. The latest valid projection remains visible while the original events stay immutable.</p><small>Use case: decide whether a controlled correction is needed; never delete the conflicting scan.</small></div></article>
      <article><Pill tone={deviceFreshnessPercent >= 90 ? "good" : "warn"}>{deviceFreshnessPercent >= 90 ? "Fresh" : "Stale"}</Pill><div><strong>Scanner freshness — {deviceFreshnessPercent}%</strong><p>Share of matching scanners that have reported in the last 24 hours. A stale scanner may be powered off, offline, moved, or unable to send telemetry.</p><small>Use case: call a location before trusting a quiet period as proof that no containers moved.</small></div></article>
      <article><Pill tone={unobservedContainers === null ? "muted" : unobservedContainers ? "warn" : "good"}>{unobservedContainers === null ? "Broader scope" : unobservedContainers ? "Check" : "Complete"}</Pill><div><strong>Registration coverage — {unobservedContainers === null ? "—" : unobservedContainers}</strong><p>Registered containers without any accepted observation. This check is intentionally tenant-wide because an unobserved container has no event location or date to join to a filtered scope.</p><small>Use case: clear event filters, then verify labels and provisioning instead of inventing a location.</small></div></article>
      <article><Pill tone={lateUploadCount ? "warn" : "good"}>{lateUploadCount ? "Context" : "Normal"}</Pill><div><strong>Upload latency — {lateUploadCount}</strong><p>Observations received more than 15 minutes after they were recorded. This is expected during offline work, but it can explain why activity appears late in the console.</p><small>Use case: compare this count with scanner freshness and offline queue behavior before escalating a location.</small></div></article>
    </div>
  });
  const openObservation = (event: StoredEvent) => openDetail({
    eyebrow: "Filtered observation",
    title: containerLabel(event.containerId),
    icon: <Activity size={18} />,
    status: event.accuracyFlags.length ? { label: "Review flags", tone: "warn" } : { label: "No data-quality warnings", tone: "good" },
    summary: "A single immutable scanner observation from the report scope.",
    recordId: event.eventId,
    recordIdLabel: "Event ID",
      body: <><DetailFacts items={[["Observation", eventLabel(event.eventType)], ["Location", locationName(event.locationId)], ["Scanner", `${deviceName(event.deviceId)} (${scannerNumber(event.deviceId)})`], ["Observed at", new Date(event.eventAt).toLocaleString()], ["Received at", new Date(event.receivedAt).toLocaleString()], ["Latency", `${latencySeconds(event)} seconds`], ["Data flags", event.accuracyFlags.length ? event.accuracyFlags.map(accuracyFlagDetail).join(", ") : "None"]]}/><h3 className="detail-section-title">Evidence</h3><EventEvidence events={[event]} data={data}/></>
  });
  const reports = [
    { id: "movement", icon: Activity, title: "Movement ledger", text: "Every accepted container observation, with scanner, location, receipt latency, and data flags.", count: filteredEvents.length, tag: "Ready" },
    { id: "loads", icon: PackageCheck, title: "Load-code handoff", text: "Load codes created in the selected period, tied to their container, goods classification, and origin.", count: filteredEvents.filter((event) => event.eventType === "load_assigned").length, tag: "Ready" },
    { id: "exceptions", icon: AlertTriangle, title: "Data-quality exceptions", text: "Containers and observations that need review before an administrator treats the projection as settled.", count: reviewCount + flaggedEvents.length, tag: "Ready" },
    { id: "corrections", icon: FilePenLine, title: "Correction register", text: "Requests, decisions, reasons, and proposed official-state changes with evidence preserved.", count: filteredCorrections.length, tag: "Ready" },
    { id: "devices", icon: Smartphone, title: "Scanner coverage", text: "Location assignment, enablement, app version, last report, and stale-device follow-up.", count: filteredDevices.length, tag: "Ready" },
    { id: "locations", icon: MapPin, title: "Location throughput", text: "Event volume, distinct containers, and flagged observations by store, Donation Xpress, or warehouse.", count: locationRows.length, tag: "Ready" },
    { id: "transit", icon: Truck, title: "Transit aging", text: "Containers still in motion, their origin and destination, and how long a receipt has been outstanding.", count: transitRows.length, tag: "Ready" },
    { id: "routes", icon: GitBranch, title: "Multi-hop route ledger", text: "Every origin-to-destination handoff in sequence, including completed checkpoints, active transfers, and superseded or missing receipts.", count: routeRows.length, tag: "Ready" },
    { id: "latency", icon: Clock3, title: "Scan latency", text: "Average and maximum upload delay by scanner, so offline work is separated from service or device problems.", count: latencyRows.length, tag: "Ready" },
    { id: "governance", icon: ScrollText, title: "Governance actions", text: "Administrator sign-ins, scanner controls, review decisions, and corrections with actor and location context.", count: filteredAuditEntries.length, tag: "Ready" },
    { id: "lake", icon: Cloud, title: "Microsoft analytics export", text: "A future governed feed into Fabric or ADLS Gen2; scanner writes remain in PostgreSQL.", count: null, tag: "Planned" }
  ] as const;
  const openReport = (report: typeof reports[number]) => {
    if (report.id === "movement") {
      downloadCsv("stacktrack-movement-ledger.csv", [["Event ID", "Container", "Observation", "Location", "Scanner", "Observed at", "Received at", "Latency seconds", "Data flags"], ...filteredEvents.map((event) => [event.eventId, containerLabel(event.containerId), eventLabel(event.eventType), locationName(event.locationId), deviceName(event.deviceId), event.eventAt, event.receivedAt, latencySeconds(event), event.accuracyFlags.map(accuracyFlagDetail).join("; ")])]);
      return;
    }
    if (report.id === "loads") {
      downloadCsv("stacktrack-load-code-handoff.csv", [["Load code", "Container", "Origin", "Goods type", "Secondary value", "Created at", "Scanner"], ...filteredEvents.filter((event) => event.eventType === "load_assigned").map((event) => [String(event.payload.displayLoadCode ?? event.loadCodeId ?? ""), containerLabel(event.containerId), locationName(event.locationId), String(event.payload.goodsType ?? ""), String(event.payload.secondaryValue ?? ""), event.eventAt, deviceName(event.deviceId)])]);
      return;
    }
    if (report.id === "exceptions") {
      downloadCsv("stacktrack-data-quality-exceptions.csv", [["Container", "Health", "Current location", "Conflicts", "Projection warnings", "Flagged observations", "Last observed"], ...filteredProjections.map((projection) => [containerLabel(projection.containerId), projectionHealthLabel(projection.health), locationName(projection.locationId), projection.conflicts.map((item) => humanizeCode(item.reason)).join("; "), projection.warnings.map(accuracyFlagLabel).join("; "), filteredEvents.filter((event) => event.containerId === projection.containerId && event.accuracyFlags.length).length, projection.lastObservedAt ?? ""]) , ...flaggedEvents.filter((event) => !filteredProjections.some((projection) => projection.containerId === event.containerId)).map((event) => [containerLabel(event.containerId), "Observation flag", locationName(event.locationId), "", event.accuracyFlags.map(accuracyFlagDetail).join("; "), 1, event.eventAt])]);
      return;
    }
    if (report.id === "corrections") {
      downloadCsv("stacktrack-correction-register.csv", [["Request ID", "Container", "Impact", "Status", "Requested by", "Requested at", "Proposed location", "Proposed state", "Request reason", "Latest decision by", "Latest decision at", "Latest decision reason"], ...filteredCorrections.map((item) => [item.correctionRequestId, item.containerLabel, item.impactLevel, item.status, item.requestedByDisplayName, item.requestedAt, locationName(item.proposedCorrection.locationId), item.proposedCorrection.loadState ? loadStateLabel(item.proposedCorrection.loadState) : "", item.reason, item.latestActorDisplayName ?? "", item.latestActionAt ?? "", item.latestActionReason ?? ""])]);
      return;
    }
    if (report.id === "devices") {
      downloadCsv("stacktrack-scanner-coverage.csv", [["Scanner ID", "Scanner name", "Assigned location", "Enabled", "StackTrack version", "Observations in scope", "Last app report", "Freshness"], ...filteredDevices.map((device) => [scannerNumber(device.deviceId), device.label, locationName(device.assignedLocationId), device.isActive ? "Yes" : "No", device.reportedAppVersion ?? "Not reported", filteredEvents.filter((event) => event.deviceId === device.deviceId).length, device.lastReportedAt ?? "", staleDevices.includes(device) ? "Stale" : "Fresh"])]);
      return;
    }
    if (report.id === "locations") {
      downloadCsv("stacktrack-location-throughput.csv", [["Location", "Events in scope", "Distinct containers", "Flagged observations"], ...locationRows.map((row) => [row.name, row.events, row.containers, row.flagged])]);
      return;
    }
    if (report.id === "transit") {
      downloadCsv("stacktrack-transit-aging.csv", [["Container", "Origin", "Destination", "Sent at", "Age hours", "Health", "Receipt status"], ...transitRows.map((row) => [containerLabel(row.projection.containerId), locationName(row.originId), locationName(row.destinationId), row.outbound?.effectiveAt ?? "", row.ageHours === null ? "" : row.ageHours.toFixed(1), projectionHealthLabel(row.projection.health), row.outbound ? "Awaiting receipt" : "Missing outbound evidence"])]);
      return;
    }
    if (report.id === "routes") {
      downloadCsv("stacktrack-multi-hop-route-ledger.csv", [["Container", "Hop", "Origin", "Destination", "Departed", "Received", "Status", "Health"], ...routeRows.map((row) => [row.container.label, row.container.containerId, row.segment.origin?.name ?? "Origin not recorded", row.segment.destination?.name ?? "Destination not recorded", row.segment.departedAt, row.segment.receivedAt ?? "", row.segment.status === "received" ? "Received" : row.segment.status === "superseded" ? "Superseded by later departure" : "Awaiting receipt", projectionHealthLabel(row.projection?.health)]) ]);
      return;
    }
    if (report.id === "latency") {
      downloadCsv("stacktrack-scan-latency.csv", [["Scanner ID", "Scanner name", "Assigned location", "Events", "Average upload seconds", "Maximum upload seconds", "Flagged observations"], ...latencyRows.map((row) => [scannerNumber(row.deviceId), deviceName(row.deviceId), locationName(data.fixtures.devices.find((device) => device.deviceId === row.deviceId)?.assignedLocationId), row.events, row.averageSeconds, row.maxSeconds, row.flagged])]);
      return;
    }
    if (report.id === "governance") {
      downloadCsv("stacktrack-governance-actions.csv", [["Audit ID", "Action", "Actor", "Applies to", "Operating scope", "Occurred at", "Summary"], ...filteredAuditEntries.map((entry) => [entry.auditId, auditActionSentence(entry), entry.actorDisplayName, auditTargetLabel(entry), auditLocationLabel(entry), entry.occurredAt, humanizeDetailsText(entry.details, data)])]);
      return;
    }
    openDetail({ eyebrow: "Planned integration", title: "Microsoft analytics export", icon: <Cloud size={18} />, summary: "The reporting boundary keeps operational writes fast and auditable while making curated data available for corporate analytics.", body: <><p className="detail-lead">PostgreSQL remains the operational source of truth. A scheduled, incremental export can publish append-only event facts and daily aggregates to Microsoft Fabric or Azure Data Lake Storage Gen2 without allowing a lake pipeline to edit scanner state.</p><DetailFacts items={[["Source", "Azure Database for PostgreSQL"], ["Destination", "Microsoft Fabric Lakehouse or ADLS Gen2"], ["Recommended grain", "Immutable event facts plus daily location aggregates"], ["Security boundary", "Read-only export identity"], ["Status", "Awaiting Goodwill Microsoft architecture decisions"]]}/></> });
  };
  return <div className="reports-workspace">
    <section className="panel report-filter-panel">
      <div className="report-filter-panel__header"><div><span className="eyebrow">Reporting scope</span><h2>Choose exactly what to analyze</h2><p>Filters narrow the matching datasets and downloads; the source events are never changed. Choose several locations, scanners, or users when you need an exact combined scope; every choice updates immediately.</p></div><div><span className="report-filter-panel__scope">{reportScope}</span><button className="secondary" onClick={clearFilters} disabled={!activeFilterCount}>Clear filters</button><span className="filter-live-note">Live filters</span></div></div>
      <div className="report-filter-grid">
        <label className="report-filter--wide">Search<input value={draft.search} onChange={(event) => updateDraft("search", event.target.value)} placeholder="Container, scanner, event, or location" /></label>
        <AuditMultiSelect label="Locations" options={reportLocationOptions} selected={draft.locationIds} onToggle={(value) => setDraft((current) => ({ ...current, locationIds: current.locationIds.includes(value) ? current.locationIds.filter((item) => item !== value) : [...current.locationIds, value] }))} onClear={() => updateDraft("locationIds", [])} emptyLabel="All locations" />
        <AuditMultiSelect label="Scanners" options={reportDeviceOptions} selected={draft.deviceIds} onToggle={(value) => setDraft((current) => ({ ...current, deviceIds: current.deviceIds.includes(value) ? current.deviceIds.filter((item) => item !== value) : [...current.deviceIds, value] }))} onClear={() => updateDraft("deviceIds", [])} emptyLabel="All scanners" />
        <AuditMultiSelect label="Users" options={actorOptions.map((actor) => ({ value: actor, label: actor }))} selected={draft.actors} onToggle={(value) => setDraft((current) => ({ ...current, actors: current.actors.includes(value) ? current.actors.filter((item) => item !== value) : [...current.actors, value] }))} onClear={() => updateDraft("actors", [])} emptyLabel="All users" />
        <AuditMultiSelect label="Observation types" options={[{ value: "load_assigned", label: "Marked full" }, { value: "batch_out", label: "Departed / in transit" }, { value: "batch_in", label: "Arrived" }, { value: "emptied", label: "Marked empty" }]} selected={draft.eventTypes} onToggle={(value) => setDraft((current) => ({ ...current, eventTypes: current.eventTypes.includes(value as StoredEvent["eventType"]) ? current.eventTypes.filter((item) => item !== value) : [...current.eventTypes, value as StoredEvent["eventType"]] }))} onClear={() => updateDraft("eventTypes", [])} emptyLabel="All observations" />
        <AuditMultiSelect label="Data health" options={[{ value: "clean", label: "Clean projection" }, { value: "warning", label: "Warning" }, { value: "needs_review", label: "Needs review" }]} selected={draft.healthValues} onToggle={(value) => setDraft((current) => ({ ...current, healthValues: current.healthValues.includes(value as Projection["health"]) ? current.healthValues.filter((item) => item !== value) : [...current.healthValues, value as Projection["health"]] }))} onClear={() => updateDraft("healthValues", [])} emptyLabel="All projection health" />
        <label>From date<input type="date" value={draft.from} onChange={(event) => updateDraft("from", event.target.value)} /></label>
        <label>To date<input type="date" value={draft.to} onChange={(event) => updateDraft("to", event.target.value)} /></label>
      </div>
      {draftDateError && <p className="report-filter-error">{draftDateError}</p>}
    </section>
    <div className="report-signal-grid"><article><span><Activity size={17} /></span><div><small>Observations in scope</small><strong>{filteredEvents.length}</strong><em>{flaggedEvents.length ? `${flaggedEvents.length} with data flags` : "No data-quality flags"}</em></div></article><article><span><Truck size={17} /></span><div><small>Movement in scope</small><strong>{transitCount}</strong><em>{transitCount ? "Receipt still needed" : "No active transit"}</em></div></article><article><span><AlertTriangle size={17} /></span><div><small>Needs review</small><strong>{reviewCount + warningCount}</strong><em>{reviewCount ? `${reviewCount} require a decision` : "No open projection conflicts"}</em></div></article><article><span><Smartphone size={17} /></span><div><small>Scanner freshness</small><strong>{deviceFreshnessPercent}%</strong><em>{staleDevices.length ? `${staleDevices.length} stale over 24 hours` : "All scanners reported recently"}</em></div></article></div>
    <div className="report-grid">{reports.map((report) => <article className="report-card report-card--expanded" key={report.title}><div className="report-card__top"><span><report.icon /></span><Pill tone={report.tag === "Ready" ? "good" : "muted"}>{report.tag}</Pill></div><h2>{report.title}</h2><p>{report.text}</p><div className="report-card__count">{report.count === null ? "—" : report.count}<small>{report.id === "movement" ? "events" : report.id === "locations" ? "locations" : report.id === "devices" ? "scanners" : report.id === "transit" ? "containers" : report.id === "routes" ? "route segments" : report.id === "latency" ? "scanner groups" : report.id === "governance" ? "actions" : "rows"} in scope</small></div><button onClick={() => openReport(report)}>{report.tag === "Ready" ? "Download filtered CSV" : "View integration plan"} <ArrowRight size={16} /></button></article>)}</div>
    <section className="panel data-health">
      <PanelTitle title="Data health" subtitle="Evidence quality signals, separated from physical-state decisions." action="How to read this" onClick={openHealthDetail} />
      <div className="health-score"><div className="health-score__value">{integrityPercent}%</div><div><strong>Observation integrity</strong><p>{flaggedEvents.length ? `${flaggedEvents.length} observations carry data-quality flags.` : "Every observation in this scope is free of data-quality flags."}</p></div><button className="secondary" onClick={openHealthDetail}><CircleHelp size={14} /> Definitions</button></div>
      <div className="health-bar"><span style={{ width: `${Math.max(5, integrityPercent)}%` }} /></div>
       <div className="health-stats"><span><b>{filteredEvents.length}</b> events in scope</span><span><b>{flaggedEvents.length}</b> flagged observations</span><span><b>{reviewCount}</b> projection conflicts</span><span><b>{filteredCorrections.filter((item) => item.status === "pending").length}</b> pending corrections</span><span><b>{lateUploadCount}</b> uploads over 15 min</span></div>
       <div className="health-check-grid"><article><span><ShieldCheck size={16} /></span><div><strong>Integrity</strong><p>Are event timestamps and device order trustworthy?</p></div><Pill tone={integrityPercent >= 98 ? "good" : "warn"}>{integrityPercent >= 98 ? "Strong" : "Review"}</Pill></article><article><span><AlertTriangle size={16} /></span><div><strong>Projection decisions</strong><p>Are any containers waiting for a governed decision?</p></div><Pill tone={reviewCount ? "warn" : "good"}>{reviewCount ? `${reviewCount} open` : "Clear"}</Pill></article><article><span><Wifi size={16} /></span><div><strong>Scanner freshness</strong><p>Can quiet locations be trusted to have reported recently?</p></div><Pill tone={deviceFreshnessPercent >= 90 ? "good" : "warn"}>{deviceFreshnessPercent}% fresh</Pill></article><article><span><Boxes size={16} /></span><div><strong>Registration coverage</strong><p>Which tracked containers have never produced evidence?</p></div><Pill tone={unobservedContainers === null ? "muted" : unobservedContainers ? "warn" : "good"}>{unobservedContainers === null ? "Clear filters" : unobservedContainers ? `${unobservedContainers} unobserved` : "Complete"}</Pill></article><article><span><Clock3 size={16} /></span><div><strong>Upload latency</strong><p>Are delayed uploads explained by offline work?</p></div><Pill tone={lateUploadCount ? "warn" : "good"}>{lateUploadCount ? `${lateUploadCount} late` : "Normal"}</Pill></article></div>
    </section>
    <section className="panel report-preview"><PanelTitle title="Filtered event preview" subtitle={`${filteredEvents.length} immutable observations match the current scope. Select a row to inspect its evidence.`} action="Download movement ledger" onClick={() => openReport(reports[0]!)} />{filteredEvents.length ? <div className="table-wrap"><table><thead><tr><th>Observation</th><th>Container</th><th>Location</th><th>Scanner</th><th>Observed</th><th>Quality</th></tr></thead><tbody>{filteredEvents.slice(0, 12).map((event) => <tr className="clickable-row" key={event.eventId} onClick={() => openObservation(event)}><td><strong>{eventLabel(event.eventType)}</strong><small>{event.eventId.slice(0, 12)}…</small></td><td>{containerLabel(event.containerId)}</td><td>{locationName(event.locationId)}</td><td>{scannerNumber(event.deviceId)} · {deviceName(event.deviceId)}</td><td>{relativeTime(event.eventAt)}</td><td>{event.accuracyFlags.length ? <Pill tone="warn">Review flags</Pill> : <Pill tone="good">No warnings</Pill>}</td></tr>)}</tbody></table></div> : <EmptyState>No observations match this report scope. Clear a filter or widen the date range.</EmptyState>}{filteredEvents.length > 12 && <p className="report-preview__more">Showing the newest 12 here; the download contains all {filteredEvents.length} matching observations.</p>}</section>
  </div>;
}

type AuditDraft = {
  search: string;
  locationId: string;
  deviceId: string;
  actionPrefixes: string[];
  targetTypes: string[];
  from: string;
  to: string;
};

const emptyAuditFilters: AuditDraft = { search: "", locationId: "", deviceId: "", actionPrefixes: [], targetTypes: [], from: "", to: "" };

function auditLocalDateBoundary(value: string, exclusive = false) {
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || !parts.every(Number.isFinite)) return value;
  const year = parts[0]!;
  const month = parts[1]!;
  const day = parts[2]!;
  const date = new Date(year, month - 1, day + (exclusive ? 1 : 0), 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function auditRequestFilters(filters: AuditDraft) {
  return {
    ...filters,
    ...(filters.from ? { from: auditLocalDateBoundary(filters.from) } : {}),
    // The API treats this as an exclusive upper bound. With no To date we intentionally omit it,
    // which means the server returns everything from the local start of the From date through now.
    ...(filters.to ? { to: auditLocalDateBoundary(filters.to, true) } : {})
  };
}

type AuditFilterOption = { value: string; label: string };

/**
 * The default filter interaction across the console is a single, immediately
 * applied choice.  Keeping this as a small shared component makes it harder
 * for one page to drift into a different interaction model (or leave a stale
 * previous choice visible after a new one is selected).
 */
function SingleFilterSelect({ label, options, value, onChange, emptyLabel }: { label: string; options: readonly AuditFilterOption[]; value: string; onChange: (value: string) => void; emptyLabel: string }) {
  return <label className="single-filter-select"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">{emptyLabel}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function AuditMultiSelect({ label, options, selected, onToggle, onClear, emptyLabel }: { label: string; options: readonly AuditFilterOption[]; selected: readonly string[]; onToggle: (value: string) => void; onClear: () => void; emptyLabel: string }) {
  const selectionLabel = selected.length === 0
    ? emptyLabel
    : selected.length === 1
      ? options.find((option) => option.value === selected[0])?.label ?? "1 selected"
      : `${selected.length} selected`;
  return <details className="audit-multi-select">
    <summary><span>{label}</span><span className="audit-multi-select__summary">{selectionLabel}</span><ChevronDown size={15} /></summary>
    <div className="audit-multi-select__menu">
      <div className="audit-multi-select__menu-head"><small>{selected.length ? `${selected.length} selected · matches any selected option` : "No restriction applied"}</small><button type="button" onClick={onClear} disabled={!selected.length}>Clear</button></div>
      {options.map((option) => <label key={option.value}><input type="checkbox" checked={selected.includes(option.value)} onChange={() => onToggle(option.value)} /><span>{option.label}</span></label>)}
    </div>
  </details>;
}

function auditActionLabel(action: string) {
  return action
    .replace(/^admin\.|^device\.|^review\.|^correction\./, "")
    .replaceAll("_", " ")
    .replaceAll(".", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const auditActionVerbs: Record<string, string> = {
  "admin.signed_in": "signed in",
  "admin.signed_out": "signed out",
  "admin.password_changed": "changed their password",
  "admin.user_created": "added an administrator",
  "admin.user_updated": "updated an administrator",
  "admin.user_disabled": "disabled an administrator",
  "admin.user_enabled": "enabled an administrator",
  "admin.password_reset": "reset an administrator password",
  "device.renamed": "renamed a scanner",
  "device.reassigned": "reassigned a scanner",
  "device.enabled": "enabled a scanner",
  "device.disabled": "disabled a scanner",
  "device.updated": "updated scanner settings",
  "device.required_version_changed": "changed the scanner version policy",
  "device.renamed_and_reassigned": "renamed and reassigned a scanner",
  "device.reassigned_and_availability_changed": "reassigned a scanner and changed its availability",
  "device.renamed_and_availability_changed": "renamed a scanner and changed its availability",
  "review.assigned": "assigned a review",
  "review.approved": "approved a review",
  "review.rejected": "rejected a review",
  "review.reopened": "reopened a review",
  "review.resolved": "resolved a review",
  "correction.requested": "requested a correction",
  "correction.approved": "approved a correction",
  "correction.rejected": "rejected a correction",
  "correction.reopened": "reopened a correction"
};

const auditTargetTypeLabels: Record<string, string> = {
  admin_user: "Administrator account",
  device: "Scanner",
  container: "Container",
  review_case: "Review case",
  correction_request: "Correction request",
  location: "Location"
};

const auditTechnicalIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function auditActionSentence(entry: AuditEntry) {
  const actor = entry.actorDisplayName || (entry.actorType === "device" ? "Scanner device" : entry.actorType === "system" ? "StackTrack system" : "An administrator");
  const verb = auditActionVerbs[entry.action] ?? `performed ${auditActionLabel(entry.action).toLowerCase()}`;
  return `${actor} ${verb}`;
}

function auditTargetLabel(entry: AuditEntry) {
  if (entry.targetLabel && !auditTechnicalIdPattern.test(entry.targetLabel)) {
    if ((entry.targetType === "review_case" || entry.targetType === "correction_request") && entry.targetLabel !== auditTargetTypeLabels[entry.targetType]) return `Container ${entry.targetLabel}`;
    return entry.targetLabel;
  }
  return auditTargetTypeLabels[entry.targetType] ?? entry.targetType.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function auditLocationLabel(entry: AuditEntry) {
  return entry.locationName ?? "Goodwill Corporate";
}

function auditLocationDescription(entry: AuditEntry) {
  return entry.locationName ? "Location-associated action" : "Corporate administrator action";
}

function auditDetailSummary(details: Record<string, unknown>) {
  const reason = typeof details.reason === "string" ? details.reason : typeof details.assignmentReason === "string" ? details.assignmentReason : null;
  const source = typeof details.source === "string" ? details.source.replaceAll("_", " ") : null;
  const changed = details.before && details.after ? "State changed" : null;
  return [changed, reason ? `Reason: ${reason}` : null, source ? `Source: ${source}` : null].filter(Boolean).join(" · ");
}

function auditEntryDetail(entry: AuditEntry, data: OperationsData): DetailView {
  const targetContainer = entry.targetType === "container"
    ? data.fixtures.containers.find((container) => container.containerId === entry.targetId)
    : undefined;
  const targetDevice = entry.targetType === "device"
    ? data.fixtures.devices.find((device) => device.deviceId === entry.targetId)
    : undefined;
  const evidenceEvents = targetContainer
    ? data.events.filter((event) => event.containerId === targetContainer.containerId).slice(0, 12)
    : targetDevice
      ? data.events.filter((event) => event.deviceId === targetDevice.deviceId).slice(0, 12)
      : [];
  const tone: PillTone = entry.action.startsWith("review.") || entry.action.startsWith("correction.")
    ? "warn"
    : entry.actorType === "device"
      ? "good"
      : "blue";
  return {
    eyebrow: "Governance event",
    title: auditActionSentence(entry),
    icon: entry.actorType === "user" ? <UserRound size={18} /> : entry.actorType === "device" ? <Smartphone size={18} /> : <ShieldCheck size={18} />,
    status: { label: entry.actorType === "device" ? "Scanner reported" : "Recorded" , tone },
    summary: auditDetailSummary(entry.details) || "An append-only administrative or system action recorded by StackTrack.",
    recordId: entry.auditId,
    recordIdLabel: "Audit event UUID",
    body: <>
      <DetailFacts items={[
        ["Action", auditActionSentence(entry)],
        ["Occurred", new Date(entry.occurredAt).toLocaleString()],
        ["Actor", `${entry.actorDisplayName}${entry.actorUsername ? ` · @${entry.actorUsername}` : ""}`],
        ["Applies to", auditTargetLabel(entry)],
        ["Operating scope", auditLocationLabel(entry)]
      ]} />
      {entry.details.reason && typeof entry.details.reason === "string" && <div className="detail-callout"><ShieldCheck size={19} /><span><strong>Recorded reason:</strong> {entry.details.reason}</span></div>}
      <h3 className="detail-section-title">What changed</h3>
      <ReadableDetails details={entry.details} data={data} />
      {entry.targetId && <details className="audit-technical-details"><summary>Record identifiers</summary><DetailFacts items={[["Technical target ID", <code className="audit-technical-id">{entry.targetId}</code>]]} /></details>}
      {evidenceEvents.length > 0 && <><h3 className="detail-section-title">Related operational evidence</h3><EventEvidence events={evidenceEvents} data={data} /></>}
    </>
  };
}

function AuditTrailPage({ data, session, openDetail }: { data: OperationsData; session: AdminSession; openDetail: OpenDetail }) {
  const [draft, setDraft] = useState<AuditDraft>(emptyAuditFilters);
  const [applied, setApplied] = useState<AuditDraft>(emptyAuditFilters);
  const [pageIndex, setPageIndex] = useState(0);
  const [result, setResult] = useState<AuditPage>({ items: [], total: 0, limit: 50, offset: 0 });
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const requestNumber = ++latestRequest.current;
    setLoading(true);
    try {
      const next = await searchAuditEntries(session, { ...auditRequestFilters(applied), limit: pageSize, offset: pageIndex * pageSize });
      if (requestNumber !== latestRequest.current) return;
      setResult(next); setError(null);
    } catch (caught) {
      if (requestNumber !== latestRequest.current) return;
      setError(caught instanceof Error ? caught.message : "The audit trail could not be loaded.");
    } finally { if (requestNumber === latestRequest.current) setLoading(false); }
  }, [applied, pageIndex, pageSize, session]);
  useEffect(() => { void load(); }, [load]);

  const updateFilter = (field: Exclude<keyof AuditDraft, "actionPrefixes" | "targetTypes">, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  useEffect(() => {
    if (!draft.from || !draft.to || draft.from <= draft.to) {
      setApplied(draft);
      setPageIndex(0);
    }
  }, [draft]);
  const setSingleAuditFilter = (field: "actionPrefixes" | "targetTypes", value: string) => setDraft((current) => ({ ...current, [field]: value ? [value] : [] }));
  const clearFilters = () => { setDraft(emptyAuditFilters); setPageIndex(0); setApplied(emptyAuditFilters); };
  const activeCount = Object.values(applied).filter((value) => Array.isArray(value) ? value.length > 0 : Boolean(value)).length;
  const pageCount = Math.max(1, Math.ceil(result.total / Math.max(1, pageSize)));
  const currentPage = Math.min(pageCount, pageIndex + 1);
  const exportResults = async () => {
    setExporting(true);
    try {
      const exported = await searchAuditEntries(session, { ...auditRequestFilters(applied), limit: 250, offset: 0 });
      downloadCsv("stacktrack-audit-trail.csv", [
        ["Occurred at", "Actor", "Username", "Action", "Applies to", "Operating scope", "Summary", "Audit ID"],
        ...exported.items.map((entry) => [
          new Date(entry.occurredAt).toISOString(), entry.actorDisplayName, entry.actorUsername ?? "",
          auditActionSentence(entry), auditTargetLabel(entry), auditLocationLabel(entry), auditDetailSummary(entry.details), entry.auditId
        ])
      ]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The audit export could not be created."); }
    finally { setExporting(false); }
  };
  return <section className="audit-page">
    <div className="audit-page__intro"><div><h2>Searchable evidence history</h2><p>Every event is append-only. Filters narrow the server-side audit log without hiding the original observation.</p></div><div className="audit-page__actions"><button className="secondary" onClick={() => void exportResults()} disabled={exporting || !result.total}><Download size={16} />{exporting ? "Preparing…" : "Export up to 250"}</button><span className="audit-page__count">{result.total.toLocaleString()} matching events</span></div></div>
    <div className="audit-purpose"><span className="audit-purpose__icon"><ScrollText size={18} /></span><div><strong>Governance and accountability</strong><p>Audit trail records administrator sign-ins, scanner controls, role changes, review decisions, and corrections. It answers who changed the system; Activity answers what scanners observed in the field. Rows use plain-language actions, while technical IDs stay inside the detail view.</p></div></div>
    <section className="audit-filter-panel">
      <div className="audit-filter-panel__header"><div><strong>Filter the trail</strong><span>{activeCount ? `${activeCount} active filter${activeCount === 1 ? "" : "s"}` : "All audit events"}</span></div><div><button className="secondary" type="button" onClick={clearFilters} disabled={!activeCount}>Clear</button><span className="filter-live-note">Live filters</span></div></div>
      <div className="audit-filter-grid">
        <label className="audit-filter--wide">Search text<input value={draft.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Actor, scanner, container, reason, or action" /></label>
        <label>Operating location<select value={draft.locationId} onChange={(event) => updateFilter("locationId", event.target.value)}><option value="">All locations</option>{data.fixtures.locations.map((location) => <option key={location.locationId} value={location.locationId}>{location.name}</option>)}</select></label>
        <label>Scanner<select value={draft.deviceId} onChange={(event) => updateFilter("deviceId", event.target.value)}><option value="">All scanners</option>{data.fixtures.devices.map((device) => <option key={device.deviceId} value={device.deviceId}>{scannerNumber(device.deviceId)} · {device.label}</option>)}</select></label>
        <SingleFilterSelect label="Action groups" options={[{ value: "admin", label: "Administrator access" }, { value: "device", label: "Scanner administration" }, { value: "review", label: "Review decisions" }, { value: "correction", label: "Corrections" }]} value={draft.actionPrefixes[0] ?? ""} onChange={(value) => setSingleAuditFilter("actionPrefixes", value)} emptyLabel="All action groups" />
        <SingleFilterSelect label="Action applies to" options={[{ value: "device", label: "Scanner" }, { value: "container", label: "Container" }, { value: "review_case", label: "Review case" }, { value: "correction_request", label: "Correction request" }, { value: "admin_user", label: "Administrator account" }]} value={draft.targetTypes[0] ?? ""} onChange={(value) => setSingleAuditFilter("targetTypes", value)} emptyLabel="All subjects" />
        <label>From date<input type="date" value={draft.from} onChange={(event) => updateFilter("from", event.target.value)} /></label>
        <label>To date<input type="date" value={draft.to} onChange={(event) => updateFilter("to", event.target.value)} /></label>
      </div>
      {draft.from && !draft.to && <p className="audit-filter-panel__date-note">No To date means from the selected local date through now.</p>}
    </section>
    {error && <div className="api-error"><AlertTriangle size={20} /><span>{error}</span><button onClick={() => void load()}>Retry</button></div>}
    <div className="audit-page__results"><div className="audit-page__results-heading"><div><span className="eyebrow">Append-only record</span><h3>{loading ? "Loading audit events…" : result.total ? `Events ${result.offset + 1}–${Math.min(result.offset + result.items.length, result.total)}` : "No matching events"}</h3></div><span>Page {currentPage} of {pageCount}</span></div>
      {!loading && !result.items.length && <EmptyState>No audit events match these filters. Try clearing one filter or widening the date range.</EmptyState>}
      <div className="audit-results">{result.items.map((entry) => { const showDetails = () => openDetail(auditEntryDetail(entry, data)); return <article className="audit-entry audit-entry--interactive" key={entry.auditId} role="button" tabIndex={0} onClick={showDetails} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); showDetails(); } }}>
        <div className="audit-entry__header"><div className="audit-entry__headline"><span className={`governance-timeline__actor governance-timeline__actor--${entry.actorType}`}>{entry.actorType === "user" ? <UserRound size={16} /> : entry.actorType === "device" ? <Smartphone size={16} /> : <ShieldCheck size={16} />}</span><div><strong>{auditActionSentence(entry)}</strong><span className="audit-entry__action">Select for the full record</span></div></div><div className="audit-entry__time"><strong>{relativeTime(entry.occurredAt)}</strong><time>{new Date(entry.occurredAt).toLocaleString()}</time></div></div>
        <div className="audit-entry__grid"><div><small>Actor</small><strong>{entry.actorDisplayName}</strong><span>{entry.actorUsername ? `@${entry.actorUsername}` : `${entry.actorType} event`}</span></div><div><small>Applies to</small><strong>{auditTargetLabel(entry)}</strong><span>Open details for evidence</span></div><div><small>Operating scope</small><strong>{auditLocationLabel(entry)}</strong><span>{auditLocationDescription(entry)}</span></div></div>
        {auditDetailSummary(entry.details) && <p className="audit-entry__summary">{auditDetailSummary(entry.details)}</p>}
      </article>; })}</div>
      <PaginationControls className="audit-page__pagination" pageIndex={pageIndex} pageCount={pageCount} pageSize={pageSize} total={result.total} loading={loading} ariaLabel="Audit trail pagination" onPageChange={setPageIndex} onPageSizeChange={(nextSize) => { setPageSize(nextSize); setPageIndex(0); }} />
    </div>
  </section>;
}

function SettingsPage({ data, setPage, refresh, session, onRequestSignIn, onPasswordChanged, onSignOut }: { data: OperationsData; setPage: (page: Page) => void; refresh: () => Promise<void>; session: AdminSession | null; onRequestSignIn: () => void; onPasswordChanged: () => void; onSignOut: () => Promise<void> }) {
  const settings = [
    { icon: UserRound, title: "Roles & approvals", text: "Operations Administrators can request corrections; Organization Owners approve them with dual control for material changes." },
    { icon: Smartphone, title: "Device provisioning", text: "Shared Android scanners receive their assigned operating location and availability from the administration service." },
    { icon: Cloud, title: "Integrations", text: "Production-system, Entra ID, and analytics connections are managed separately from scanner operations." }
  ];
  const actions = [
    { icon: Smartphone, title: "Manage scanner fleet", text: "Rename scanners, move assignments, review versions, and enable or disable access.", page: "devices" as Page },
    { icon: MapPin, title: "Manage locations", text: "Rare, high-impact configuration: add sites or retire or restore a site after checking assignments and history.", page: "settings" as Page, anchor: "location-admin-panel" },
    { icon: AlertTriangle, title: "Review exceptions", text: "Work through containers with missing, conflicting, or late observations.", page: "exceptions" as Page },
    { icon: FilePenLine, title: "Review corrections", text: "Approve, reject, and document requests to change the official state.", page: "corrections" as Page },
    { icon: Activity, title: "Follow scanner activity", text: "Trace the physical observations that moved containers through the network.", page: "activity" as Page },
    { icon: ScrollText, title: "Investigate audit trail", text: "Search administrator actions, device controls, approvals, and sign-ins.", page: "audit" as Page },
    { icon: BarChart3, title: "Open reports & data", text: "Export operational evidence and monitor data quality across the network.", page: "reports" as Page }
  ];
  const openAdminDirectory = () => {
    if (!session) { onRequestSignIn(); return; }
    if (session.principal.role !== "organization_owner") return;
    document.querySelector(".admin-directory")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return <>
    <section className="settings-actions panel">
      <PanelTitle title="Administrator workspace" subtitle="Direct controls for the work administrators perform every day." />
      <div className="settings-action-grid">
        <button className="settings-action-card settings-action-card--access" onClick={openAdminDirectory} disabled={Boolean(session && session.principal.role !== "organization_owner")}><span className="settings-action-card__icon"><UserRound size={19} /></span><span><strong>Manage administrators</strong><small>{session?.principal.role === "organization_owner" ? "Add users, change roles, disable access, or reset passwords." : session ? "Only Organization Owners can manage administrator accounts." : "Sign in to manage administrator accounts."}</small></span><span className="settings-action-card__go">{session?.principal.role === "organization_owner" ? "Manage" : session ? "Owner only" : "Sign in"}<ChevronRight size={15} /></span></button>
         {actions.map((action) => <button className="settings-action-card" key={action.title} onClick={() => { if (action.anchor) { document.querySelector(`.${action.anchor}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); return; } setPage(action.page); }}><span className="settings-action-card__icon"><action.icon size={19} /></span><span><strong>{action.title}</strong><small>{action.text}</small></span><span className="settings-action-card__go">Open<ChevronRight size={15} /></span></button>)}
      </div>
    </section>
    <section className="location-governance panel">
      <PanelTitle title="Location access model" subtitle="A practical boundary between local operations and corporate governance." action="Open corrections" onClick={() => setPage("corrections")} />
      <div className="location-governance__intro"><span><ShieldCheck size={20} /></span><div><strong>Access levels are enforced by the API.</strong><p>Location Managers keep work moving at assigned sites while Organization Owners retain full governance. Every scope change and password reset is recorded without exposing a stored password.</p></div><Pill tone="good">Available now</Pill></div>
      <div className="location-governance__roles"><article><span className="location-governance__role-icon"><MapPin size={17} /></span><div><h3>Location Manager</h3><p>Scoped to assigned locations. Can manage local scanners and request a container correction with a reason.</p><small>Cannot add admins, change policy, approve corrections, or edit another location.</small></div><Pill tone="good">Location-scoped</Pill></article><article><span className="location-governance__role-icon location-governance__role-icon--admin"><UserRound size={17} /></span><div><h3>Operations Administrator</h3><p>Network-wide operational control. Can manage scanners, triage exceptions, and request corrections across locations.</p><small>Approval and account governance remain with an Organization Owner.</small></div><Pill tone="good">Network operations</Pill></article><article><span className="location-governance__role-icon location-governance__role-icon--owner"><ShieldCheck size={17} /></span><div><h3>Organization Owner</h3><p>Full control across Goodwill: administrator access, locations, devices, corrections, approvals, and settings.</p><small>Keep at least two active owners for continuity and dual control.</small></div><Pill tone="blue">Full control</Pill></article></div>
      <div className="location-governance__workflow"><span className="eyebrow">Accountable change path</span><div><span><b>1</b><strong>Local manager records what happened</strong><small>Location, scanner, container, and reason.</small></span><ArrowRight size={15} /><span><b>2</b><strong>Corporate queue receives the request</strong><small>Original scan evidence remains unchanged.</small></span><ArrowRight size={15} /><span><b>3</b><strong>Owner approves or rejects</strong><small>A separate decision and reason are audited.</small></span></div></div>
    </section>
    <LocationAdministrationPanel data={data} session={session} refresh={refresh} setPage={setPage} />
    <section className="settings-reference panel">
      <PanelTitle title="Operating policies" subtitle="Reference only — these policies are enforced by the service and are not interactive settings." />
      <div className="settings-reference__grid">{settings.map((setting) => <article className="settings-reference__item" key={setting.title}><span className="settings-reference__icon"><setting.icon size={18} /></span><div><h3>{setting.title}</h3><p>{setting.text}</p></div><Pill tone="muted">Reference</Pill></article>)}</div>
    </section>
    {session && <AccountSecurity session={session} onPasswordChanged={onPasswordChanged} onSignOut={onSignOut} />}{session?.principal.role === "organization_owner" && <AdminDirectory session={session} locations={data.fixtures.locations} />}</>;
}

function AccountSecurity({ session, required = false, onPasswordChanged, onSignOut }: { session: AdminSession; required?: boolean; onPasswordChanged: () => void; onSignOut: () => Promise<void> }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(null); setNotice(null);
    if (newPassword !== confirmPassword) { setError("New-password entries do not match."); return; }
    setBusy(true);
    try {
      await changeOwnPassword(session, currentPassword, newPassword);
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      onPasswordChanged(); setNotice("Password updated. Other browser sessions were revoked.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Password could not be changed."); }
    finally { setBusy(false); }
  };
  return <section className={`account-security ${required ? "account-security--required" : ""}`}><PanelTitle title={required ? "Choose your private password" : "Your account security"} subtitle={required ? "This is the first sign-in for this account. Replace the administrator-issued temporary password before StackTrack shows any operational data." : "Password changes are recorded and revoke your other active browser sessions."} />{required && <div className="account-security__required-note"><ShieldCheck size={20}/><span>This keeps a shared temporary password from becoming ongoing access. Your new password needs at least 12 characters.</span></div>}<div className="account-security__status"><span className="avatar">{initials(session.principal.displayName)}</span><div><strong>{session.principal.displayName}</strong><small>@{session.principal.username} · {roleLabel(session.principal.role)}</small></div><Pill tone={session.principal.mustChangePassword ? "warn" : "good"}>{session.principal.mustChangePassword ? "Password change required" : "Password current"}</Pill></div><form className="account-security__form" onSubmit={(event) => void submit(event)}><label>Current password<input required type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label><label>New password<input required minLength={12} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label><label>Confirm new password<input required minLength={12} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label><button className="primary" disabled={busy}>{busy ? "Updating…" : required ? "Continue to StackTrack" : "Update password"}</button></form>{error && <div className="sign-in-error">{error}</div>}{notice && <div className="device-notice">{notice}</div>}<button className="account-security__signout" onClick={() => void onSignOut()}>Sign out of this browser</button></section>;
}

function LegacyAdminDirectory({ session }: { session: AdminSession }) {
  const [users, setUsers] = useState<AdminPrincipal[] | null>(null); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState(""); const [username, setUsername] = useState(""); const [temporaryPassword, setTemporaryPassword] = useState(""); const [role, setRole] = useState<"organization_owner" | "operations_administrator" | "read_only_reviewer">("operations_administrator");
  const refreshUsers = useCallback(async () => { try { setUsers(await listAdminUsers(session)); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load accounts."); } }, [session]);
  useEffect(() => { void refreshUsers(); }, [refreshUsers]);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); try { await createAdminUser(session, { displayName, username, temporaryPassword, role }); setDisplayName(""); setUsername(""); setTemporaryPassword(""); await refreshUsers(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create account."); } finally { setBusy(false); } };
  return <section className="admin-directory"><PanelTitle title="Administrator directory" subtitle="Organization Owners control who can manage operations." /><div className="admin-directory__users">{users?.map((user) => <article key={user.userId}><span className="avatar">{initials(user.displayName)}</span><div><strong>{user.displayName}</strong><small>@{user.username}</small></div><Pill tone={user.role === "organization_owner" ? "blue" : user.role === "operations_administrator" ? "good" : "muted"}>{roleLabel(user.role)}</Pill></article>) ?? <div className="skeleton"/>}</div><form className="admin-user-form" onSubmit={(event) => void submit(event)}><h3>Add administrator</h3><p>New accounts must change their temporary password before receiving access.</p><div><label>Display name<input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><label>Username<input required pattern="[a-z0-9._-]{3,64}" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} /></label></div><div><label>Role<select value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="operations_administrator">Operations Administrator</option><option value="read_only_reviewer">Read-only Reviewer</option></select></label><label>Temporary password<input required minLength={12} type="password" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} /></label></div>{error && <div className="sign-in-error">{error}</div>}<button className="primary" disabled={busy}>{busy ? "Creating…" : "Add administrator"}</button></form></section>;
}

function LegacyAdminDirectoryV2({ session }: { session: AdminSession }) {
  const [users, setUsers] = useState<AdminPrincipal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [role, setRole] = useState<"organization_owner" | "operations_administrator" | "read_only_reviewer">("operations_administrator");
  const refreshUsers = useCallback(async () => {
    try { setUsers(await listAdminUsers(session)); setError(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load accounts."); }
  }, [session]);
  useEffect(() => { void refreshUsers(); }, [refreshUsers]);
  const addUser = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      await createAdminUser(session, { displayName, username, temporaryPassword, role });
      setDisplayName(""); setUsername(""); setTemporaryPassword("");
      await refreshUsers();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create account."); }
    finally { setBusy(false); }
  };
  const save = async (userId: string, update: { displayName?: string; role?: "organization_owner" | "operations_administrator" | "read_only_reviewer"; isActive?: boolean }) => {
    setBusy(true); setError(null);
    try { await updateAdminUser(session, userId, update); await refreshUsers(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update account."); }
    finally { setBusy(false); }
  };
  const resetPassword = async (userId: string, temporaryPassword: string) => {
    setBusy(true); setError(null);
    try { await resetAdminPassword(session, userId, temporaryPassword); await refreshUsers(); }
    catch (caught) { throw caught instanceof Error ? caught : new Error("Could not reset account password."); }
    finally { setBusy(false); }
  };
  return <section className="admin-directory"><PanelTitle title="Administrator directory" subtitle="Organization Owners govern access. Role changes and disabled accounts immediately invalidate the affected person’s active browser sessions." />
    <div className="admin-directory__users">{users?.map((user) => <LegacyManagedAccountRow key={user.userId} user={user} currentUserId={session.principal.userId} busy={busy} onSave={save} onReset={resetPassword} />) ?? <div className="skeleton"/>}</div>
    {error && <div className="sign-in-error">{error}</div>}
    <form className="admin-user-form" onSubmit={(event) => void addUser(event)}><h3>Add administrator</h3><p>Use an Operations Administrator for normal data and scanner work. Only nominate another Organization Owner when they need full access governance.</p><div><label>Display name<input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><label>Username<input required pattern="[a-z0-9._-]{3,64}" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} /></label></div><div><label>Role<select value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="operations_administrator">Operations Administrator</option><option value="read_only_reviewer">Read-only Reviewer</option><option value="organization_owner">Organization Owner (full control)</option></select></label><label>Temporary password<input required minLength={12} type="password" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} /></label></div><button className="primary" disabled={busy}>{busy ? "Creating…" : "Add administrator"}</button></form>
  </section>;
}

function LegacyManagedAccountRow({ user, currentUserId, busy, onSave, onReset }: { user: AdminPrincipal; currentUserId: string; busy: boolean; onSave: (userId: string, update: { displayName?: string; role?: "organization_owner" | "operations_administrator" | "read_only_reviewer"; isActive?: boolean }) => Promise<void>; onReset: (userId: string, temporaryPassword: string) => Promise<void> }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState(user.role);
  const [resetOpen, setResetOpen] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  useEffect(() => { setDisplayName(user.displayName); setRole(user.role); }, [user.displayName, user.role]);
  const self = user.userId === currentUserId;
  const changed = displayName.trim() !== user.displayName || role !== user.role;
  const submitReset = async () => {
    if (temporaryPassword.length < 12) { setResetError("Use at least 12 characters."); return; }
    setResetError(null);
    try { await onReset(user.userId, temporaryPassword); setTemporaryPassword(""); setResetOpen(false); }
    catch (caught) { setResetError(caught instanceof Error ? caught.message : "Could not reset this password."); }
  };
  return <article className={!user.isActive ? "admin-account admin-account--disabled" : "admin-account"}><span className="avatar">{initials(user.displayName)}</span><div className="admin-account__identity"><strong>{user.displayName}</strong><small>@{user.username}{self ? " · You" : ""}</small><div><Pill tone={user.role === "organization_owner" ? "blue" : user.role === "operations_administrator" ? "good" : "muted"}>{roleLabel(user.role)}</Pill>{!user.isActive && <Pill tone="warn">Disabled</Pill>}{user.mustChangePassword && <Pill tone="warn">Password change pending</Pill>}</div></div>{self ? <small className="admin-account__self">Use another Organization Owner to change your role or disable this account.</small> : <div className="admin-account__controls"><input aria-label={`${user.username} display name`} value={displayName} disabled={busy} onChange={(event) => setDisplayName(event.target.value)} /><select aria-label={`${user.username} role`} value={role} disabled={busy} onChange={(event) => setRole(event.target.value as typeof role)}><option value="operations_administrator">Operations Administrator</option><option value="read_only_reviewer">Read-only Reviewer</option><option value="organization_owner">Organization Owner</option></select><button className="secondary" disabled={busy || !changed || displayName.trim().length < 2} onClick={() => void onSave(user.userId, { ...(displayName.trim() !== user.displayName ? { displayName: displayName.trim() } : {}), ...(role !== user.role ? { role: role as "organization_owner" | "operations_administrator" | "read_only_reviewer" } : {}) })}>Save</button><button className={user.isActive ? "secondary" : "primary"} disabled={busy} onClick={() => void onSave(user.userId, { isActive: !user.isActive })}>{user.isActive ? "Disable" : "Enable"}</button><button className="secondary" disabled={busy || !user.isActive} onClick={() => { setResetError(null); setResetOpen((value) => !value); }}>{resetOpen ? "Cancel reset" : "Reset password"}</button>{resetOpen && <div className="admin-account__reset"><input aria-label={`Temporary password for ${user.username}`} type="password" minLength={12} value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} placeholder="12+ character temporary password" /><button className="primary" disabled={busy || temporaryPassword.length < 12} onClick={() => void submitReset()}>Issue temporary password</button>{resetError && <small>{resetError}</small>}</div>}</div>}</article>;
}

type EditableAdminRole = Exclude<ManagedAdminRole, "support">;
type AdminDirectoryUpdate = { displayName?: string; role?: EditableAdminRole; isActive?: boolean; locationIds?: string[] };

function adminRoleTone(role: AdminPrincipal["role"]): PillTone {
  return role === "organization_owner" ? "blue" : role === "operations_administrator" ? "good" : role === "location_manager" ? "blue" : "muted";
}

function AdminDirectory({ session, locations }: { session: AdminSession; locations: Location[] }) {
  const [users, setUsers] = useState<AdminPrincipal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [role, setRole] = useState<EditableAdminRole>("operations_administrator");
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const activeLocations = locations.filter((location) => location.isActive !== false && location.type !== "in_transit");
  const refreshUsers = useCallback(async () => {
    try { setUsers(await listAdminUsers(session)); setError(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load administrator accounts."); }
  }, [session]);
  useEffect(() => { void refreshUsers(); }, [refreshUsers]);
  const addUser = async (event: React.FormEvent) => {
    event.preventDefault();
    if (role === "location_manager" && locationIds.length === 0) {
      setError("Choose at least one location for a Location Manager.");
      return;
    }
    setBusy(true); setError(null);
    try {
      await createAdminUser(session, { displayName, username, temporaryPassword, role, ...(["location_manager", "read_only_reviewer"].includes(role) && locationIds.length ? { locationIds } : {}) });
      setDisplayName(""); setUsername(""); setTemporaryPassword(""); setRole("operations_administrator"); setLocationIds([]);
      await refreshUsers();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create account."); }
    finally { setBusy(false); }
  };
  const save = async (userId: string, update: AdminDirectoryUpdate) => {
    setBusy(true); setError(null);
    try { await updateAdminUser(session, userId, update); await refreshUsers(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update account."); }
    finally { setBusy(false); }
  };
  const resetPassword = async (userId: string, password: string, reason: string) => {
    setBusy(true); setError(null);
    try { await resetAdminPassword(session, userId, password, reason); await refreshUsers(); }
    catch (caught) { throw caught instanceof Error ? caught : new Error("Could not reset account password."); }
    finally { setBusy(false); }
  };
  return <section className="admin-directory">
    <PanelTitle title="Administrator directory" subtitle="Organization Owners have full control. Every other account is explicit about its operating scope, and no administrator can view another person’s stored password." />
    <div className="admin-directory__owner-callout"><ShieldCheck size={20} /><div><strong>Signed in as Organization Owner</strong><span>You can add, scope, disable, and reset administrator accounts. Passwords are stored only as one-way hashes; a reset issues a one-time temporary password that the user must replace.</span></div></div>
    <div className="admin-role-legend">
      <article><Pill tone="blue">Full control</Pill><strong>Organization Owner</strong><span>Users, locations, devices, corrections, approvals, and settings across Goodwill.</span></article>
      <article><Pill tone="good">Network operations</Pill><strong>Operations Administrator</strong><span>Daily scanner, exception, correction-request, and data workflows across locations.</span></article>
      <article><Pill tone="blue">Location-scoped</Pill><strong>Location Manager</strong><span>Only assigned stores, Donation Xpress sites, or warehouses; changes remain reasoned and reviewable.</span></article>
      <article><Pill tone="muted">View only</Pill><strong>Read-only Reviewer</strong><span>Can investigate evidence and reports without changing operational state.</span></article>
    </div>
    <div className="admin-directory__users">{users?.map((user) => <ManagedAccountRow key={user.userId} user={user} currentUserId={session.principal.userId} locations={activeLocations} busy={busy} onSave={save} onReset={resetPassword} />) ?? <div className="skeleton" />}</div>
    {error && <div className="sign-in-error">{error}</div>}
    <form className="admin-user-form admin-user-form--owner" onSubmit={(event) => void addUser(event)}>
      <div><span className="eyebrow">Create access</span><h3>Add an administrator</h3><p>Give each person the least access needed. The temporary password is never retrievable after this form is cleared; the user replaces it privately on first sign-in.</p></div>
      <div className="admin-user-form__grid"><label>Display name<input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><label>Username<input required pattern="[a-z0-9._-]{3,64}" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} /></label><label>Role<select value={role} onChange={(event) => { const next = event.target.value as EditableAdminRole; setRole(next); if (next !== "location_manager" && next !== "read_only_reviewer") setLocationIds([]); }}><option value="operations_administrator">Operations Administrator</option><option value="location_manager">Location Manager</option><option value="read_only_reviewer">Read-only Reviewer</option><option value="organization_owner">Organization Owner (full control)</option></select></label><label>One-time temporary password<input required minLength={12} type="password" autoComplete="new-password" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} /><small>12+ characters. It is hashed immediately and cannot be viewed later.</small></label></div>
      {(role === "location_manager" || role === "read_only_reviewer") && <LocationScopePicker locations={activeLocations} value={locationIds} onChange={setLocationIds} optional={role === "read_only_reviewer"} />}
      <button className="primary" disabled={busy}>{busy ? "Creating…" : "Create administrator"}</button>
    </form>
  </section>;
}

function LocationScopePicker({ locations, value, onChange, optional = false }: { locations: Location[]; value: string[]; onChange: (value: string[]) => void; optional?: boolean }) {
  const toggle = (locationId: string) => onChange(value.includes(locationId) ? value.filter((id) => id !== locationId) : [...value, locationId]);
  return <fieldset className="admin-scope-picker"><legend>{optional ? "Optional location scope" : "Assigned locations"} <small>{optional ? "Leave empty for a network-wide read-only reviewer, or select only the sites they should see." : "Select every site this manager is responsible for."}</small></legend><div>{locations.map((location) => <label key={location.locationId} className={value.includes(location.locationId) ? "admin-scope-picker__option admin-scope-picker__option--selected" : "admin-scope-picker__option"}><input type="checkbox" checked={value.includes(location.locationId)} onChange={() => toggle(location.locationId)} /><span><strong>{location.name}</strong><small>{location.type === "donation_express" ? "Donation Xpress" : location.type === "warehouse" ? "Warehouse" : "Store"}</small></span></label>)}</div>{value.length === 0 && <small className="admin-scope-picker__empty">{optional ? "No scope selected — network-wide read-only access." : "No locations selected yet."}</small>}</fieldset>;
}

function ManagedAccountRow({ user, currentUserId, locations, busy, onSave, onReset }: { user: AdminPrincipal; currentUserId: string; locations: Location[]; busy: boolean; onSave: (userId: string, update: AdminDirectoryUpdate) => Promise<void>; onReset: (userId: string, temporaryPassword: string, reason: string) => Promise<void> }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState<EditableAdminRole>(user.role === "support" ? "read_only_reviewer" : user.role);
  const [locationIds, setLocationIds] = useState<string[]>(user.locationIds ?? []);
  const [resetOpen, setResetOpen] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [resetReason, setResetReason] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  useEffect(() => { setDisplayName(user.displayName); setRole(user.role === "support" ? "read_only_reviewer" : user.role); setLocationIds(user.locationIds ?? []); }, [user.displayName, user.role, (user.locationIds ?? []).join(",")]);
  const self = user.userId === currentUserId;
  const changed = displayName.trim() !== user.displayName || role !== user.role || ((role === "location_manager" || role === "read_only_reviewer") ? locationIds.join(",") !== (user.locationIds ?? []).join(",") : (user.locationIds ?? []).length > 0);
  const assignedLocationNames = locationIds.map((locationId) => locations.find((location) => location.locationId === locationId)?.name).filter((name): name is string => Boolean(name));
  const submitReset = async () => {
    if (temporaryPassword.length < 12) { setResetError("Use at least 12 characters."); return; }
    setResetError(null);
    if (resetReason.trim().length < 8) { setResetError("Add a clear reason (at least 8 characters) for the audit trail."); return; }
    try { await onReset(user.userId, temporaryPassword, resetReason.trim()); setTemporaryPassword(""); setResetReason(""); setResetOpen(false); }
    catch (caught) { setResetError(caught instanceof Error ? caught.message : "Could not reset this password."); }
  };
  return <article className={!user.isActive ? "admin-account admin-account--disabled" : "admin-account"}>
    <span className="avatar">{initials(user.displayName)}</span>
    <div className="admin-account__identity"><strong>{user.displayName}</strong><small>@{user.username}{self ? " · You" : ""}</small><div><Pill tone={adminRoleTone(user.role)}>{roleLabel(user.role)}</Pill>{!user.isActive && <Pill tone="warn">Disabled</Pill>}{user.mustChangePassword && <Pill tone="warn">First password change pending</Pill>}</div><small className="admin-account__scope">{user.role === "location_manager" ? (user.locationIds?.length ? "Assigned to " + user.locationIds.length + " location" + (user.locationIds.length === 1 ? "" : "s") : "No locations assigned") : user.role === "read_only_reviewer" ? (user.locationIds?.length ? "Read-only at " + user.locationIds.length + " assigned location" + (user.locationIds.length === 1 ? "" : "s") : "Network-wide read-only") : "Network-wide access"}</small></div>
    {self ? <small className="admin-account__self">Your owner account has full control. Use another Organization Owner to change or disable it.</small> : <div className="admin-account__controls"><input aria-label={"Display name for " + user.username} value={displayName} disabled={busy} onChange={(event) => setDisplayName(event.target.value)} /><select aria-label={"Role for " + user.username} value={role} disabled={busy} onChange={(event) => { const next = event.target.value as EditableAdminRole; setRole(next); if (next !== "location_manager" && next !== "read_only_reviewer") setLocationIds([]); }}><option value="operations_administrator">Operations Administrator</option><option value="location_manager">Location Manager</option><option value="read_only_reviewer">Read-only Reviewer</option><option value="organization_owner">Organization Owner</option></select>{(role === "location_manager" || role === "read_only_reviewer") && <LocationScopePicker locations={locations} value={locationIds} onChange={setLocationIds} optional={role === "read_only_reviewer"} />}<div className="admin-account__control-actions"><button className="secondary" disabled={busy || !changed || displayName.trim().length < 2 || (role === "location_manager" && locationIds.length === 0)} onClick={() => void onSave(user.userId, { ...(displayName.trim() !== user.displayName ? { displayName: displayName.trim() } : {}), ...(role !== user.role ? { role } : {}), ...((role === "location_manager" || role === "read_only_reviewer") || (user.locationIds ?? []).length > 0 ? { locationIds: role === "location_manager" || role === "read_only_reviewer" ? locationIds : [] } : {}) })}>Save access</button><button className={user.isActive ? "secondary" : "primary"} disabled={busy} onClick={() => void onSave(user.userId, { isActive: !user.isActive })}>{user.isActive ? "Disable account" : "Enable account"}</button><button className="secondary" disabled={busy || !user.isActive} onClick={() => { setResetError(null); setResetOpen((value) => !value); }}>{resetOpen ? "Cancel reset" : "Issue reset"}</button></div>{resetOpen && <div className="admin-account__reset"><p>Issue a one-time temporary password. The user must choose their private password; you will not be able to view it.</p><label>Reason for reset<textarea required minLength={8} maxLength={500} value={resetReason} onChange={(event) => setResetReason(event.target.value)} placeholder="Example: User lost access to their private password after device replacement." /></label><input aria-label={"Temporary password for " + user.username} type="password" minLength={12} value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} placeholder="12+ character temporary password" /><button className="primary" disabled={busy || temporaryPassword.length < 12 || resetReason.trim().length < 8} onClick={() => void submitReset()}>Issue temporary password</button>{resetError && <small>{resetError}</small>}</div>}</div>}
  </article>;
}

function DeviceCard({ device, data, operatingLocations, busy, canManage, canMoveAcrossLocations, onSave, onDetails }: { device: Device; data: OperationsData; operatingLocations: Location[]; busy: boolean; canManage: boolean; canMoveAcrossLocations: boolean; onSave: (device: Device, update: { label?: string; assignedLocationId?: string; isActive?: boolean; assignmentReason?: string }) => Promise<void>; onDetails: () => void }) {
  const [label, setLabel] = useState(device.label);
  const [assignedLocationId, setAssignedLocationId] = useState(device.assignedLocationId);
  const [reason, setReason] = useState("");
  useEffect(() => { setLabel(device.label); setAssignedLocationId(device.assignedLocationId); setReason(""); }, [device.label, device.assignedLocationId]);
  const location = data.fixtures.locations.find((item) => item.locationId === device.assignedLocationId);
  const events = data.events.filter((item) => item.deviceId === device.deviceId);
  const assignmentChanged = assignedLocationId !== device.assignedLocationId;
  const labelChanged = label.trim() !== device.label;
  const locked = busy || !canManage;
  const destinationOptions = canMoveAcrossLocations ? operatingLocations : operatingLocations.filter((option) => option.locationId === device.assignedLocationId);
  return <article className="device-card"><div className="phone-icon"><Smartphone /></div><div className={`device-card__status ${device.isActive ? "" : "device-card__status--disabled"}`}><i /> {device.isActive ? "SCANNING ENABLED" : "SCANNING DISABLED"}</div><h2>{device.label}</h2><p><MapPin size={15} /> Assigned to {location?.name ?? "Unassigned"}</p>{!canManage && <div className="device-read-only">Read-only access: scanner controls are unavailable.</div>}{canManage && !canMoveAcrossLocations && <div className="device-read-only"><ShieldCheck size={14} /> Cross-location moves require Organization Owner approval.</div>}<label className="device-location-control"><span>Scanner name</span><div className="device-name-input"><input value={label} onChange={(event) => setLabel(event.target.value)} disabled={locked} placeholder="Example: Scanner 1" /><button className="secondary" disabled={locked || !labelChanged || label.trim().length < 2} onClick={() => void onSave(device, { label: label.trim() })}>{busy ? "Saving…" : "Save name"}</button></div></label><dl><div className="device-id-row"><dt>Scanner ID</dt><dd className="device-id">{scannerNumber(device.deviceId)}</dd></div><div><dt>Availability</dt><dd>{device.isActive ? "Enabled" : "Disabled"}</dd></div><div><dt>StackTrack version</dt><dd>{device.reportedAppVersion ?? "Not reported"}</dd></div><div><dt>Observations</dt><dd>{events.length}</dd></div><div><dt>Last app report</dt><dd>{relativeTime(device.lastReportedAt)}</dd></div></dl><label className="device-location-control"><span>Move scanner to</span><select value={assignedLocationId} disabled={locked || !canMoveAcrossLocations} onChange={(event) => setAssignedLocationId(event.target.value)}>{destinationOptions.map((option) => <option value={option.locationId} key={option.locationId}>{option.name}</option>)}</select></label>{assignmentChanged && <label className="device-location-control"><span>Reason (optional)</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Example: Scanner moved with the Midtown store team." disabled={locked} /></label>}{assignmentChanged && <button className="primary device-save-assignment" disabled={locked} onClick={() => void onSave(device, { assignedLocationId, ...(reason.trim() ? { assignmentReason: reason.trim() } : {}) })}>{busy ? "Saving…" : "Record scanner move"}</button>}<div className="device-card__actions"><button className={device.isActive ? "secondary" : "primary"} disabled={locked} onClick={() => void onSave(device, { isActive: !device.isActive })}>{busy ? "Saving…" : device.isActive ? "Disable scanner" : "Enable scanner"}</button><button className="secondary" onClick={onDetails}>Details <ChevronRight size={16} /></button></div></article>;
}

function BrokenExceptionsPage({ data, openDetail, session, refresh }: { data: OperationsData; openDetail: OpenDetail; session: AdminSession; refresh: () => Promise<void> }) {
  /* Superseded by the structured review component below.
  const cases = data.reviewCases;
  const activeCases = cases.filter((item) => !["resolved", "approved", "rejected"].includes(item.status));
  return <section className="panel exceptions-panel"><div className="accuracy-summary"><span><ShieldCheck size={25} /></span><div><strong>Evidence is preserved; disposition is append-only.</strong><p>Every review decision is tied to the signed-in administrator, has a required reason, and never rewrites the scanner observations that caused the case.</p></div></div><div className="review-summary"><span><b>{activeCases.length}</b> active cases</span><span><b>{cases.length - activeCases.length}</b> completed history</span><span>Organization Owners can resolve material cases.</span></div>{cases.length === 0 ? <EmptyState>No review cases have been created from the current scan history.</EmptyState> : cases.map((item) => <ReviewCaseCard key={item.reviewCaseId} reviewCase={item} data={data} session={session} onAction={async (action, reason) => { await reviewCaseAction(session, item.reviewCaseId, action, reason); await refresh(); }} onEvidence={() => openDetail({ eyebrow: "Preserved evidence", title: `${item.containerLabel} review evidence`, body: <><DetailFacts items={[["Case ID", item.reviewCaseId], ["Reason code", item.reasonCode], ["Current status", reviewStatusLabel(item.status)], ["Evidence events", String(item.evidenceEventIds.length)], ["Last decision", item.lastActionAt ? `${reviewStatusLabel(item.status)} · ${new Date(item.lastActionAt).toLocaleString()}` : "Not yet acted on"]}/>{item.lastActionReason && <div className="detail-callout"><ShieldCheck size={20}/><span><strong>Latest decision reason:</strong> {item.lastActionReason}</span></div>}<h3 className="detail-section-title">Immutable event evidence</h3><EventEvidence events={data.events.filter((event) => item.evidenceEventIds.includes(event.eventId) || event.containerId === item.containerId)} data={data}/></> })} />)}</section>;
}

  */
}

function reviewStatusLabel(status: ReviewCase["status"]) { return { opened: "Open", assigned: "Assigned", approved: "Approved", rejected: "Rejected", resolved: "Resolved", reopened: "Reopened" }[status]; }

function ReviewCaseCard({ reviewCase, data, session, onAction, onEvidence }: { reviewCase: ReviewCase; data: OperationsData; session: AdminSession; onAction: (action: ReviewAction, reason: string) => Promise<void>; onEvidence: () => void }) {
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const manages = session.principal.role === "organization_owner" || session.principal.role === "operations_administrator";
  const canResolve = session.principal.role === "organization_owner";
  const isClosed = ["approved", "rejected", "resolved"].includes(reviewCase.status);
  const act = async (action: ReviewAction) => { setError(null); setBusy(true); try { await onAction(action, reason); setReason(""); } catch (caught) { setError(caught instanceof Error ? caught.message : "Review decision could not be recorded."); } finally { setBusy(false); } };
  const projection = data.projections[reviewCase.containerId];
  const route = getContainerRouteContext(reviewCase.containerId, data);
  return <article className={`exception-card ${isClosed ? "exception-card--closed" : ""}`}><div className="exception-card__icon"><AlertTriangle size={22} /></div><div className="exception-card__body"><div><Pill tone={isClosed ? "muted" : "warn"}>{reviewStatusLabel(reviewCase.status)}</Pill><span>{relativeTime(reviewCase.lastActionAt ?? reviewCase.openedAt)}</span></div><h2>{reviewCase.containerLabel} needs a review decision</h2><p>{humanizeCode(reviewCase.reasonCode)} · {projection?.conflicts.length ?? 0} current projection conflicts · {reviewCase.evidenceEventIds.length} preserved evidence event{reviewCase.evidenceEventIds.length === 1 ? "" : "s"}. {route.inTransit ? `Currently in transit from ${route.origin?.name ?? "an unconfirmed origin"} to ${route.destination?.name ?? "an unconfirmed destination"}.` : route.currentLocation ? `Last confirmed at ${route.currentLocation.name}.` : "Current location is not confirmed."}</p><div className="evidence"><span><strong>{reviewCase.actionCount}</strong> recorded actions</span><span><strong>{projection?.appliedEventIds.length ?? 0}</strong> applied events</span><span><strong>{projection?.warnings.length ?? 0}</strong> data-quality warnings</span></div>{reviewCase.lastActionReason && <div className="review-last-action"><strong>Latest reason:</strong> {reviewCase.lastActionReason}</div>}{manages && <label className="review-reason"><span>Decision reason</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} placeholder="State what was verified and who should act next." /></label>}{error && <div className="sign-in-error">{error}</div>}</div><div className="exception-card__actions"><button className="secondary" onClick={onEvidence}>View evidence</button>{manages && !isClosed && <button className="secondary" disabled={busy || reason.trim().length < 8} onClick={() => void act("assigned")}>{busy ? "Recording…" : "Assign review"}</button>}{canResolve && !isClosed && <button className="primary" disabled={busy || reason.trim().length < 8} onClick={() => void act("resolved")}>{busy ? "Recording…" : "Resolve case"}</button>}{canResolve && isClosed && <button className="secondary" disabled={busy || reason.trim().length < 8} onClick={() => void act("reopened")}>{busy ? "Recording…" : "Reopen case"}</button>}</div></article>;
}

function ExceptionsPage({ data, openDetail, session, refresh }: { data: OperationsData; openDetail: OpenDetail; session: AdminSession; refresh: () => Promise<void> }) {
  const activeCases = data.reviewCases.filter((item) => !["resolved", "approved", "rejected"].includes(item.status));
  return <section className="panel exceptions-panel">
    <div className="review-summary"><span><b>{activeCases.length}</b> active cases</span><span><b>{data.reviewCases.length - activeCases.length}</b> completed history</span><span>Organization Owners can resolve material cases.</span></div>
    {data.reviewCases.length === 0 ? <EmptyState>No review cases have been created from the current scan history.</EmptyState> : data.reviewCases.map((item) => <ReviewCaseCard key={item.reviewCaseId} reviewCase={item} data={data} session={session} onAction={async (action, reason) => { await reviewCaseAction(session, item.reviewCaseId, action, reason); await refresh(); }} onEvidence={() => openDetail({
      eyebrow: "Preserved evidence",
      title: `${item.containerLabel} review evidence`,
      icon: <AlertTriangle size={18} />,
      status: { label: reviewStatusLabel(item.status), tone: ["resolved", "approved", "rejected"].includes(item.status) ? "muted" : "warn" },
      summary: "Review evidence keeps conflicting observations visible while a governed administrator decision is recorded.",
      recordId: item.reviewCaseId,
      recordIdLabel: "Review case UUID",
      body: <><DetailFacts items={[
        ["Case ID", item.reviewCaseId],
        ["Review reason", humanizeCode(item.reasonCode)],
        ["Current status", reviewStatusLabel(item.status)],
        ["Recorded journey", routeLocationNames(getContainerRouteContext(item.containerId, data)).join(" → ") || "No handoffs recorded"],
        ["Evidence events", String(item.evidenceEventIds.length)],
        ["Last decision", item.lastActionAt ? `${reviewStatusLabel(item.status)} · ${new Date(item.lastActionAt).toLocaleString()}` : "Not yet acted on"]
      ]}/>{item.lastActionReason && <div className="detail-callout"><ShieldCheck size={20}/><span><strong>Latest decision reason:</strong> {item.lastActionReason}</span></div>}<h3 className="detail-section-title">Immutable event evidence</h3><EventEvidence events={data.events.filter((event) => item.evidenceEventIds.includes(event.eventId) || event.containerId === item.containerId)} data={data}/></>
    })} />)}
  </section>;
}
