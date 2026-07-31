import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Boxes,
  Building2,
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
  HandHeart,
  LayoutDashboard,
  MapPin,
  Menu,
  MonitorSmartphone,
  PackageCheck,
  RefreshCw,
  Search,
  ScrollText,
  Settings,
  ShieldCheck,
  Smartphone,
  Truck,
  UserRound,
  Store,
  Warehouse,
  Wifi,
  X
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  API_URL,
  ApiRequestError,
  changeOwnPassword,
  correctionRequestAction,
  createCorrectionRequest,
  createAdminUser,
  listAdminUsers,
  loadOperationsData,
  resetAdminPassword,
  reviewCaseAction,
  revokeAdminSession,
  searchAuditEntries,
  signIn,
  updateAdminUser,
  updateDevice,
  type AdminPrincipal,
  type AdminSession,
  type AuditEntry,
  type AuditPage,
  type Container,
  type CorrectionAction,
  type CorrectionRequest,
  type Device,
  type DeviceAssignment,
  type Fixtures,
  type Location,
  type OperationsWarning,
  type Projection,
  type ReviewCase,
  type ReviewAction,
  type StoredEvent
} from "./api";
import stacktrackLogo from "./assets/stacktrack-logo-tight.png";

type Page =
  | "dashboard"
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

const pageTitles: Record<Page, { eyebrow: string; title: string; description: string }> = {
  dashboard: {
    eyebrow: "Operations overview",
    title: "Know where every container is.",
    description: "A live operational picture built from the immutable scan history."
  },
  containers: {
    eyebrow: "Reusable assets",
    title: "Containers",
    description: "Search every tracked bin, cart, and gaylord by its unique label."
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

function pageFromHash(): Page {
  const value = window.location.hash.replace("#/", "") as Page;
  return [...nav.map((item) => item.page), "settings"].includes(value)
    ? value
    : "dashboard";
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
    batch_out: "Sent in transit",
    batch_in: "Received",
    emptied: "Marked empty"
  }[type];
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
    destinationLocationId: "Destination"
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

function EventEvidence({ events, data }: { events: StoredEvent[]; data: OperationsData }) {
  const locationName = (id: string) => data.fixtures.locations.find((item) => item.locationId === id)?.name ?? "Unknown";
  return <div className="detail-events">{events.length ? events.map((event) => <article key={event.eventId}>
    <div><span className="detail-event__label"><Pill tone={event.accuracyFlags.length ? "warn" : "blue"}>{eventLabel(event.eventType)}</Pill>{event.accuracyFlags.length ? <span className="detail-event__warning-count">{event.accuracyFlags.length} warning{event.accuracyFlags.length === 1 ? "" : "s"}</span> : <span className="detail-event__verified"><CheckCircle2 size={12} /> verified</span>}</span><time>{new Date(event.eventAt).toLocaleString()}</time></div>
    <strong>{locationName(event.locationId)}</strong>
    <span className="detail-event__id">{event.eventId} <CopyValueButton value={event.eventId} label="Copy" /></span>
    <small>{event.accuracyFlags.length ? event.accuracyFlags.join(" · ") : "Timing and device order verified"}</small>
    <details className="detail-event__more"><summary>View scan details</summary><DetailFacts items={[["Device", `${scannerNumber(event.deviceId)} · ${data.fixtures.devices.find((device) => device.deviceId === event.deviceId)?.label ?? "Unknown scanner"}`], ["Device sequence", String(event.deviceSequence)], ["Observed", new Date(event.eventAt).toLocaleString()], ["Received", new Date(event.receivedAt).toLocaleString()], ["Effective", new Date(event.effectiveAt).toLocaleString()]]}/>{eventPayloadFacts(event, data).length > 0 ? <><span className="readable-details__label">Scan information</span><DetailFacts items={eventPayloadFacts(event, data)} /></> : <p className="detail-empty-note">No additional scan information was recorded.</p>}</details>
  </article>) : <EmptyState>No observations have been recorded for this item.</EmptyState>}</div>;
}

export function App() {
  const [page, setPageState] = useState<Page>(pageFromHash);
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
    const onHash = () => setPageState(pageFromHash());
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
    setPageState(next);
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

  const selected = pageTitles[page];
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
            body: <><p className="detail-lead">This session is verified by the StackTrack API and expires automatically. Every administrative change is attributed to this account.</p><h3 className="detail-section-title">Account access</h3><DetailFacts items={[["Username", session.principal.username], ["Role", roleLabel(session.principal.role)], ["Scope", "Goodwill operations"]]}/><h3 className="detail-section-title">Session security</h3><div className="profile-security-card"><CheckCircle2 size={18}/><div><strong>Server-verified session</strong><span>Expires {new Date(session.expiresAt).toLocaleString()}</span><small>Signing out revokes this browser session on the server.</small></div></div><div className="detail-danger-zone"><div><strong>End this session</strong><p>Sign out when you leave this workstation. You can sign back in with your administrator account.</p></div><button className="danger-button" onClick={() => void signOut()}>Sign out</button></div></>
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
            <button className="icon-button" aria-label="Help" onClick={() => setDetail({
              eyebrow: "StackTrack help",
              title: "Using the operations console",
              body: <><p className="detail-lead">Search for a container or load code, use the left navigation for operational views, and open any record for its immutable evidence history.</p><div className="help-steps"><span><b>1</b> Scan in the mobile app</span><span><b>2</b> Refresh the console</span><span><b>3</b> Review state and evidence</span><span><b>4</b> Request a governed correction when evidence is wrong</span></div><div className="detail-callout"><ShieldCheck size={20}/><span>Approved corrections never delete the original scan. Material changes require a second Organization Owner, and a newer physical scan automatically becomes authoritative.</span></div></>
            })}><CircleHelp size={18} /></button>
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
                  placeholder={page === "audit" ? "Use the audit filters below" : page === "activity" ? "Search container, event, scanner, or location" : page === "loads" ? "Search load code, container, goods, or location" : page === "devices" ? "Search scanner ID or location" : page === "corrections" ? "Search container or requester" : "Search label or code"}
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
            <PageContent page={page} data={data} query={query} setPage={setPage} openDetail={setDetail} refresh={refresh} session={session} onRequestSignIn={() => setSignInOpen(true)} onPasswordChanged={markPasswordChanged} onSignOut={signOut} />
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
function roleLabel(role: AdminPrincipal["role"]) { return { organization_owner: "Organization Owner", operations_administrator: "Operations Administrator", read_only_reviewer: "Read-only Reviewer", support: "Time-limited Support" }[role]; }

function SignInDialog({ onClose: _onClose, onSuccess }: { onClose: () => void; onSuccess: (session: AdminSession) => void }) {
  const [username, setUsername] = useState("root"); const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(null); try { onSuccess(await signIn(username, password)); } catch (caught) { setError(caught instanceof Error ? caught.message : "Sign-in failed."); } finally { setBusy(false); } };
  return <section className="sign-in-dialog" role="dialog" aria-modal="true" aria-label="Administrator sign in"><div className="sign-in-dialog__brand"><Mark /></div><div className="sign-in-dialog__icon"><ShieldCheck size={25}/></div><span className="eyebrow">SECURE ADMIN ACCESS</span><h2>Sign in to view operations.</h2><p>Container, route, device, and report data stays unavailable until the StackTrack API verifies an approved account.</p><div className="sign-in-dialog__trust"><span><CheckCircle2 size={14}/> Server-verified access</span><span><ShieldCheck size={14}/> Audit-ready changes</span></div><form onSubmit={(event) => void submit(event)}><label>Username<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <div className="sign-in-error">{error}</div>}<button className="primary" disabled={busy || !username.trim() || !password} type="submit">{busy ? "Signing in…" : "Sign in"}</button></form><small>Use your approved Goodwill administrator account. Access is recorded and expires automatically.</small></section>;
}

function PageContent({
  page,
  data,
  query,
  setPage,
  openDetail,
  refresh,
  session,
  onRequestSignIn,
  onPasswordChanged,
  onSignOut
}: {
  page: Page;
  data: OperationsData;
  query: string;
  setPage: (page: Page) => void;
  openDetail: OpenDetail;
  refresh: () => Promise<void>;
  session: AdminSession | null;
  onRequestSignIn: () => void;
  onPasswordChanged: () => void;
  onSignOut: () => Promise<void>;
}) {
  if (page === "dashboard") return <Dashboard data={data} setPage={setPage} />;
  if (page === "containers") return <ContainersPage data={data} query={query} openDetail={openDetail} setPage={setPage} />;
  if (page === "loads") return <LoadsPage data={data} query={query} openDetail={openDetail} />;
  if (page === "locations") return <LocationsPage data={data} openDetail={openDetail} setPage={setPage} />;
  if (page === "exceptions") return <ExceptionsPage data={data} openDetail={openDetail} session={session!} refresh={refresh} />;
  if (page === "corrections") return <CorrectionsPage data={data} query={query} session={session!} refresh={refresh} />;
  if (page === "activity") return <ActivityPage data={data} query={query} openDetail={openDetail} setPage={setPage} />;
  if (page === "audit") return <AuditTrailPage data={data} session={session!} openDetail={openDetail} />;
  if (page === "devices") return <DevicesPage data={data} query={query} openDetail={openDetail} refresh={refresh} session={session} onRequestSignIn={onRequestSignIn} />;
  if (page === "reports") return <ReportsPage data={data} openDetail={openDetail} />;
  return <SettingsPage data={data} setPage={setPage} session={session} onRequestSignIn={onRequestSignIn} onPasswordChanged={onPasswordChanged} onSignOut={onSignOut} />;
}

function Dashboard({ data, setPage }: { data: OperationsData; setPage: (page: Page) => void }) {
  const projections = Object.values(data.projections).filter(Boolean) as Projection[];
  const loaded = projections.filter((item) => item.loadState === "loaded").length;
  const transitId = data.fixtures.locations.find((item) => item.type === "in_transit")?.locationId;
  const inTransit = projections.filter((item) => item.locationId === transitId).length;
  const review = projections.filter((item) => item.health === "needs_review").length;
  const pendingCorrections = data.correctionRequests.filter(
    (item) => item.status === "pending" || item.status === "reopened"
  );
  const recent = data.events.slice(0, 5);
  const locName = (id: string) => data.fixtures.locations.find((item) => item.locationId === id)?.name ?? "Unknown";
  const container = (id: string) => data.fixtures.containers.find((item) => item.containerId === id);
  const physicalLocations = [
    data.fixtures.locations.find((item) => item.name === "Midtown Store"),
    data.fixtures.locations.find((item) => item.type === "warehouse"),
    data.fixtures.locations.find((item) => item.type === "donation_express")
  ].filter((item): item is Location => Boolean(item));
  const transitItems = projections
    .filter((item) => item.locationId === transitId)
    .map((projection) => {
      const outbound = data.events
        .filter((event) => event.containerId === projection.containerId && event.eventType === "batch_out")
        .sort((left, right) => Date.parse(right.effectiveAt) - Date.parse(left.effectiveAt))[0];
      const source = outbound
        ? data.events
            .filter(
              (event) =>
                event.containerId === projection.containerId &&
                event.locationId !== transitId &&
                Date.parse(event.effectiveAt) < Date.parse(outbound.effectiveAt)
            )
            .sort((left, right) => Date.parse(right.effectiveAt) - Date.parse(left.effectiveAt))[0]
        : undefined;
      const destinationLocationId =
        typeof outbound?.payload.destinationLocationId === "string"
          ? outbound.payload.destinationLocationId
          : null;

      return {
        containerId: projection.containerId,
        label: container(projection.containerId)?.label ?? "Container",
        sourceLocationId: source?.locationId ?? null,
        destinationLocationId
      };
    });
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

  return (
    <>
      <div className="metric-grid">
        <Metric icon={<ContainerIcon />} label="Tracked containers" value={data.fixtures.containers.length} detail="Across 4 location types" tone="blue" />
        <Metric icon={<PackageCheck />} label="Currently loaded" value={loaded} detail={`${Math.round((loaded / data.fixtures.containers.length) * 100)}% of tracked assets`} tone="cyan" />
        <Metric icon={<Truck />} label="In transit" value={inTransit} detail="Latest valid observation" tone="navy" />
        <Metric icon={<AlertTriangle />} label="Needs attention" value={review + pendingCorrections.length} detail={review + pendingCorrections.length ? "Review or approval required" : "No open exceptions"} tone={review + pendingCorrections.length ? "orange" : "green"} />
      </div>

      <section className="panel operations-pulse">
        <PanelTitle title="Operations pulse" subtitle="Signals that help administrators prioritize today’s work" />
        <div className="pulse-grid">
          <button className="pulse-card pulse-card--blue" onClick={() => setPage("devices")}><span className="pulse-card__icon"><Wifi size={18} /></span><span><small>Scanner coverage</small><strong>{activeDevices.length} of {data.fixtures.devices.length} enabled</strong><em>{staleDevices.length ? `${staleDevices.length} need a check-in` : "All enabled scanners reported recently"}</em></span><ChevronRight size={16} /></button>
          <button className="pulse-card pulse-card--cyan" onClick={() => setPage("activity")}><span className="pulse-card__icon"><Activity size={18} /></span><span><small>Recent observations</small><strong>{observationsLastDay} in the last 24 hours</strong><em>Open Activity to trace movement and scanner timing</em></span><ChevronRight size={16} /></button>
          <button className="pulse-card pulse-card--navy" onClick={() => setPage("loads")}><span className="pulse-card__icon"><PackageCheck size={18} /></span><span><small>Load codes ready</small><strong>{availableLoadCodes} available for handoff</strong><em>{availableLoadCodes ? "Open Load codes to select a validated handoff." : "No validated handoff codes are ready."}</em></span><ChevronRight size={16} /></button>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel network-panel">
          <PanelTitle title="Route flow" subtitle="Live movement on a representative store-to-warehouse route" action="View all locations" onClick={() => setPage("locations")} />
          <div className="flow">
            {physicalLocations.map((location, index) => {
              const count = projections.filter((item) => item.locationId === location.locationId).length;
              const Icon = location.type === "warehouse" ? Building2 : Boxes;
              const nextLocation = physicalLocations[index + 1];
              const laneItems = nextLocation
                ? transitItems.filter(
                    (item) =>
                      item.sourceLocationId === location.locationId &&
                      item.destinationLocationId === nextLocation.locationId
                  )
                : [];
              return (
                <Fragment key={location.locationId}>
                  <div className="flow-node">
                    <span className="flow-node__icon"><Icon size={20} /></span>
                    <strong>{shortLocationName(location)}</strong>
                    <small>{count} at location</small>
                  </div>
                  {nextLocation && (
                    <TransitLane
                      from={location}
                      to={nextLocation}
                      items={laneItems}
                    />
                  )}
                </Fragment>
              );
            })}
          </div>
          <div className={`transit-summary ${inTransit ? "transit-summary--active" : ""}`}>
            <span className="transit-summary__icon"><Truck size={19} /></span>
            <div>
              <strong>{inTransit ? `${inTransit} container${inTransit === 1 ? "" : "s"} currently between locations` : "No containers currently between locations"}</strong>
              <span>{inTransit ? `${transitPreview} remain in transit until a destination receipt is scanned.` : "All tracked containers have a confirmed physical location."}</span>
            </div>
            <Pill tone={inTransit ? "blue" : "good"}>{inTransit ? "Moving" : "Clear"}</Pill>
          </div>
        </section>

        <section className="panel review-panel">
          <PanelTitle title="Attention center" subtitle="Items that could change the official state" action="Open queue" onClick={() => setPage("exceptions")} />
          {review === 0 && pendingCorrections.length === 0 ? <EmptyState>All container histories are internally consistent.</EmptyState> : (
            <>
            {projections.filter((item) => item.health === "needs_review").map((item) => {
              const c = container(item.containerId);
              return (
                <button className="review-item" key={item.containerId} onClick={() => setPage("exceptions")}>
                  <span className="review-item__icon"><AlertTriangle size={19} /></span>
                  <span><strong>{c?.label}</strong><small>{item.conflicts[0]?.reason.replace(/([A-Z])/g, " $1").trim()}</small></span>
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
            </>
          )}
        </section>
      </div>

      <section className="panel">
        <PanelTitle title="Recent activity" subtitle="Newest device observations" action="View full ledger" onClick={() => setPage("activity")} />
        <div className="table-wrap">
          <table>
            <thead><tr><th>Container</th><th>Observation</th><th>Location</th><th>Device time</th><th>Accuracy</th></tr></thead>
            <tbody>
              {recent.map((event) => (
                <tr key={event.eventId}>
                  <td><strong>{container(event.containerId)?.label}</strong><small>{container(event.containerId)?.type}</small></td>
                  <td>{eventLabel(event.eventType)}</td>
                  <td>{locName(event.locationId)}</td>
                  <td>{relativeTime(event.eventAt)}</td>
                  <td>{event.accuracyFlags.length ? <Pill tone="warn">Check</Pill> : <Pill tone="good">Verified</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function shortLocationName(location: Location) {
  return location.name
    .replace("South Sacramento ", "")
    .replace("Auburn Boulevard ", "");
}

function TransitLane({
  from,
  to,
  items
}: {
  from: Location;
  to: Location;
  items: { containerId: string; label: string }[];
}) {
  const active = items.length > 0;
  const labels = items.map((item) => item.label).join(", ");
  const routeLabel = active
    ? `${labels} in transit from ${shortLocationName(from)} to ${shortLocationName(to)}`
    : `No containers in transit from ${shortLocationName(from)} to ${shortLocationName(to)}`;

  return (
    <div className={`flow-lane ${active ? "flow-lane--active" : ""}`} aria-label={routeLabel}>
      <span className="flow-lane__status">{active ? `${items.length} MOVING` : "ROUTE CLEAR"}</span>
      <div className="flow-lane__track" aria-hidden="true">
        <span className="flow-lane__line" />
        {active && <span className="flow-lane__vehicle"><ContainerIcon size={14} /></span>}
        <span className="flow-lane__arrow" />
      </div>
      <span className="flow-lane__caption">{active ? `${labels} in transit` : "No active loads"}</span>
    </div>
  );
}

function Metric({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: number; detail: string; tone: string }) {
  return (
    <div className="metric">
      <div className={`metric__icon metric__icon--${tone}`}>{icon}</div>
      <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
    </div>
  );
}

function PanelTitle({ title, subtitle, action, onClick }: { title: string; subtitle: string; action?: string; onClick?: () => void }) {
  return (
    <div className="panel-title">
      <div><h2>{title}</h2><p>{subtitle}</p></div>
      {action && <button onClick={onClick}>{action}<ChevronRight size={16} /></button>}
    </div>
  );
}

interface ContainerRouteContext {
  inTransit: boolean;
  currentLocation: Location | null;
  origin: Location | null;
  destination: Location | null;
  departedAt: string | null;
}

function getContainerRouteContext(containerId: string, data: OperationsData): ContainerRouteContext {
  const transitId = data.fixtures.locations.find((location) => location.type === "in_transit")?.locationId;
  const locationFor = (locationId: string | null | undefined) => data.fixtures.locations.find((location) => location.locationId === locationId) ?? null;
  const projection = data.projections[containerId];
  const events = data.events
    .filter((event) => event.containerId === containerId)
    .sort((left, right) => Date.parse(left.effectiveAt) - Date.parse(right.effectiveAt));
  const departure = [...events].reverse().find((event) => event.eventType === "batch_out");
  const destinationId = typeof departure?.payload.destinationLocationId === "string" ? departure.payload.destinationLocationId : null;
  const originEvent = departure
    ? events.filter((event) => event.eventId !== departure.eventId && event.locationId !== transitId && Date.parse(event.effectiveAt) < Date.parse(departure.effectiveAt)).at(-1)
    : events.filter((event) => event.locationId !== transitId).at(-1);
  const latestEvent = events.at(-1);
  return {
    inTransit: projection?.locationId === transitId,
    currentLocation: locationFor(projection?.locationId),
    origin: locationFor(originEvent?.locationId),
    destination: locationFor(destinationId),
    departedAt: departure?.eventAt ?? latestEvent?.eventAt ?? null
  };
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
        <small>Departed {relativeTime(route.departedAt)} · destination receipt pending</small>
      </div>
    );
  }

  return (
    <div className="container-location-cell">
      <span className="container-location-cell__icon">{route.currentLocation ? <LocationTypeIcon location={route.currentLocation} size={15} /> : <MapPin size={15} />}</span>
      <div>
        <strong>{route.currentLocation?.name ?? "Not yet observed"}</strong>
        <small>{route.currentLocation ? route.currentLocation.type === "donation_express" ? "Donation Xpress" : route.currentLocation.type === "warehouse" ? "Warehouse" : route.currentLocation.type === "store_backroom" ? "Store" : "In transit" : "No location confirmed"}</small>
      </div>
    </div>
  );
}

function ContainerRouteSummary({ containerId, data }: { containerId: string; data: OperationsData }) {
  const route = getContainerRouteContext(containerId, data);
  const current = data.events.filter((event) => event.containerId === containerId).sort((left, right) => Date.parse(left.effectiveAt) - Date.parse(right.effectiveAt)).at(-1);
  const currentName = route.currentLocation?.name ?? "Not confirmed";
  return <div className={`detail-route-summary ${route.inTransit ? "detail-route-summary--active" : ""}`}>
    <div className="detail-route-summary__heading"><span><Truck size={15} /> Route context</span><Pill tone={route.inTransit ? "blue" : "good"}>{route.inTransit ? "In transit" : "Physical location confirmed"}</Pill></div>
    <div className="detail-route-summary__path">
      <div><small>Origin</small><strong>{route.origin?.name ?? "Origin not confirmed"}</strong></div>
      <span className="detail-route-summary__connector" aria-hidden="true"><i /><ArrowRight size={16} /></span>
      <div><small>Destination</small><strong>{route.destination?.name ?? "Destination pending"}</strong></div>
    </div>
    <small className="detail-route-summary__note">{route.inTransit ? `Movement is active from ${route.origin?.name ?? "the last confirmed location"} to ${route.destination?.name ?? "the destination"}. A destination receipt will close the route.` : current ? `Last authoritative observation: ${eventLabel(current.eventType)} at ${currentName}.` : "No route observations are recorded yet."}</small>
  </div>;
}

function ContainersPage({ data, query, openDetail, setPage }: { data: OperationsData; query: string; openDetail: OpenDetail; setPage: (page: Page) => void }) {
  const [filter, setFilter] = useState<"all" | "loaded" | "empty" | "unknown">("all");
  const [pageIndex, setPageIndex] = useState(0);
  const pageSize = 25;
  useEffect(() => setPageIndex(0), [query]);
  const locationName = (id: string | null) => data.fixtures.locations.find((item) => item.locationId === id)?.name ?? "Not yet observed";
  const rows = data.fixtures.containers
    .filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
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
        ["Current state", projection?.loadState ?? "Not observed"],
        ["Movement status", route.inTransit ? "In transit" : "Stationary / location confirmed"],
        ["Route", route.inTransit ? `${route.origin?.name ?? "Origin pending"} → ${route.destination?.name ?? "Destination pending"}` : "No active movement"],
        ["Last known location", route.inTransit ? "In transit" : locationName(projection?.locationId ?? null)],
        ["History health", projection?.health ?? "No history"],
        ["Official correction", projection?.administrativeCorrection ? `Approved ${new Date(projection.administrativeCorrection.approvedAt).toLocaleString()}` : "None applied"],
        ["Container UUID", container.containerId]
      ]}/><ContainerRouteSummary containerId={container.containerId} data={data}/>{projection?.administrativeCorrection && <div className="detail-callout"><FilePenLine size={20}/><span><strong>Approved correction by {projection.administrativeCorrection.approvedByDisplayName}:</strong> {projection.administrativeCorrection.reason}. A newer physical scan will automatically supersede this official-state override.</span></div>}<h3 className="detail-section-title">Immutable observation history</h3><EventEvidence events={data.events.filter((event) => event.containerId === container.containerId)} data={data}/></>
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
        projection?.loadState ?? "not observed",
        locationName(projection?.locationId ?? null),
        projection?.lastObservedAt ?? "",
        projection?.health ?? "no history"
      ];
    })
  ]);
  return (
    <section className="panel">
      <div className="toolbar"><div className="filter-tabs">{(["all", "loaded", "empty", "unknown"] as const).map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => { setFilter(value); setPageIndex(0); }}>{value[0]!.toUpperCase() + value.slice(1)} <b>{filterCount(value)}</b></button>)}</div><button className="secondary" onClick={exportRows}><Download size={16} /> Export CSV</button></div>
      {movementRows.length > 0 && <div className="container-movement-summary">
        <div className="container-movement-summary__intro"><span className="container-movement-summary__icon"><Truck size={20} /></span><div><span className="eyebrow">Movement monitor</span><strong>{movementRows.length} container{movementRows.length === 1 ? "" : "s"} currently in transit</strong><p>Each route shows the last confirmed origin and planned destination. The movement closes when the destination receipt is scanned.</p></div></div>
        <div className="container-movement-summary__routes">{movementGroups.slice(0, 3).map((group) => <button className="container-movement-summary__route" key={group.key} onClick={() => showContainer(group.first)}><span className="container-movement-summary__route-icon"><i /><Truck size={14} /></span><span><strong title={`${group.origin?.name ?? "Origin pending"} to ${group.destination?.name ?? "Destination pending"}`}>{group.origin?.name ?? "Origin pending"} <ArrowRight size={12} /> {group.destination?.name ?? "Destination pending"}</strong><small>{group.count} moving · {group.labels.join(", ")}{group.count > group.labels.length ? ` +${group.count - group.labels.length} more` : ""}</small></span><ChevronRight size={15} /></button>)}{movementGroups.length > 3 && <small className="container-movement-summary__more">+ {movementGroups.length - 3} additional route{movementGroups.length - 3 === 1 ? "" : "s"} in the table below</small>}</div>
      </div>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Asset label</th><th>Container type</th><th>Current state</th><th>Position / movement</th><th>Last observed</th><th>History health</th></tr></thead>
          <tbody>{visibleRows.map((container) => {
            const projection = data.projections[container.containerId];
            const route = getContainerRouteContext(container.containerId, data);
            return <tr className="clickable-row" key={container.containerId} onClick={() => showContainer(container)}>
              <td><strong className="asset-label">{container.label}</strong><small>{container.containerId.slice(0, 13)}…</small></td>
              <td className="capitalize">{container.type}</td>
              <td><Pill tone={projection?.loadState === "loaded" ? "blue" : "muted"}>{projection?.loadState ?? "Not observed"}</Pill></td>
              <td><ContainerRouteCell route={route} /></td>
              <td>{relativeTime(projection?.lastObservedAt)}</td>
              <td>{projection?.health === "needs_review" ? <Pill tone="warn">Needs review</Pill> : projection?.administrativeCorrection ? <Pill tone="blue">Corrected</Pill> : projection ? <Pill tone="good">Clean</Pill> : <Pill tone="muted">No history</Pill>}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <div className="pagination"><span>Showing {rows.length ? pageIndex * pageSize + 1 : 0}–{Math.min(rows.length, (pageIndex + 1) * pageSize)} of {rows.length}</span><div><button disabled={pageIndex === 0} onClick={() => setPageIndex((current) => current - 1)}>Previous</button><b>Page {pageIndex + 1} of {pageCount}</b><button disabled={pageIndex + 1 >= pageCount} onClick={() => setPageIndex((current) => current + 1)}>Next</button></div></div>
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
  const pageSize = 12;
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
  const hasLoadFilterValues = (value: LoadFilters) => Boolean(value.locationId || value.goodsType || value.timeWindow !== "all" || value.from || value.to || value.sort !== "newest");
  const draftHasFilters = Boolean(filter !== "available" || hasLoadFilterValues(draft) || hasLoadFilterValues(applied));
  const updateFilter = (field: keyof LoadFilters, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const applyFilters = (event: React.FormEvent) => { event.preventDefault(); if (invalidRange) return; setPageIndex(0); setApplied({ ...draft }); };
  const clearFilters = () => { setDraft(emptyLoadFilters); setApplied(emptyLoadFilters); setFilter("available"); setPageIndex(0); };
  const exportLoads = () => downloadCsv("stacktrack-load-codes.csv", [
    ["Load code", "Container", "Location", "Goods type", "Classification", "Created at"],
    ...loads.map((event) => [
      codeFor(event),
      containerName(event.containerId) ?? "",
      locationName(event.locationId) ?? "",
      String(event.payload.goodsType ?? ""),
      String(event.payload.secondaryValue ?? ""),
      event.eventAt
    ])
  ]);
  return (
    <>
      <div className="notice-banner"><CheckCircle2 size={22} /><div><strong>Validated load-code register</strong><span>Managers can use these codes in the production system. Filter or sort the accepted mark-full observations before exporting.</span></div><button className="primary" onClick={exportLoads}><Download size={16} /> Download list</button></div>
      <section className="panel">
        <form className="load-filter-panel" onSubmit={applyFilters}>
          <div className="load-filter-panel__header"><div><strong>Filter and sort load codes</strong><span>{statusLabel}{activeCount ? ` · ${activeCount} active filter${activeCount === 1 ? "" : "s"}` : ""} · {loads.length.toLocaleString()} matching</span></div><div><button className="secondary" type="button" onClick={clearFilters} disabled={!draftHasFilters}>Clear filters</button><button className="primary" type="submit" disabled={invalidRange}>Apply filters</button></div></div>
          <div className="load-filter-grid">
            <label className="load-filter--wide">Location<select value={draft.locationId} onChange={(event) => updateFilter("locationId", event.target.value)}><option value="">All locations</option>{data.fixtures.locations.map((location) => <option value={location.locationId} key={location.locationId}>{location.name}</option>)}</select></label>
            <label>Time window<select value={draft.timeWindow} onChange={(event) => updateFilter("timeWindow", event.target.value as LoadTimeWindow)}><option value="all">All available</option><option value="today">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label>
            <label>Goods type<select value={draft.goodsType} onChange={(event) => updateFilter("goodsType", event.target.value)}><option value="">All goods types</option>{goodsOptions.map((goodsType) => <option value={goodsType} key={goodsType}>{goodsType}</option>)}</select></label>
            <label>From date<input type="date" value={draft.from} onChange={(event) => updateFilter("from", event.target.value)} /></label>
            <label>To date<input type="date" value={draft.to} onChange={(event) => updateFilter("to", event.target.value)} /></label>
            <label>Sort by<select value={draft.sort} onChange={(event) => updateFilter("sort", event.target.value as LoadSort)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="location">Location A–Z</option><option value="code">Load code A–Z</option></select></label>
          </div>
          {invalidRange && <p className="load-filter-error">The from date must be on or before the to date.</p>}
        </form>
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
                ["Goods", `${String(event.payload.goodsType ?? "Not set")} · ${String(event.payload.secondaryValue ?? "Not set")}`]
              ]}/><h3 className="detail-section-title">Container evidence</h3><EventEvidence events={data.events.filter((item) => item.containerId === event.containerId)} data={data}/></>
            })}>View history <ChevronRight size={15} /></button></div>
          </article>
        ))}</div>
        <div className="pagination"><span>Showing {loads.length ? pageIndex * pageSize + 1 : 0}–{Math.min(loads.length, (pageIndex + 1) * pageSize)} of {loads.length}</span><div><button disabled={pageIndex === 0} onClick={() => setPageIndex((current) => current - 1)}>Previous</button><b>Page {pageIndex + 1} of {pageCount}</b><button disabled={pageIndex + 1 >= pageCount} onClick={() => setPageIndex((current) => current + 1)}>Next</button></div></div>
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

function LocationNetworkOverview({ metrics, movingCount, movingReviewCount, onSelect }: { metrics: LocationMetric[]; movingCount: number; movingReviewCount: number; onSelect: (locationId: string) => void }) {
  const collection = metrics.filter(({ location }) => location.type === "store_backroom" || location.type === "donation_express");
  const warehouses = metrics.filter(({ location }) => location.type === "warehouse");
  const sortByWork = (left: LocationMetric, right: LocationMetric) => (right.current.length + right.arriving.length + right.leaving.length + right.needsReview) - (left.current.length + left.arriving.length + left.leaving.length + left.needsReview);
  const collectionPreview = [...collection].sort(sortByWork).slice(0, 6);
  const warehousePreview = [...warehouses].sort(sortByWork).slice(0, 6);
  const currentCount = metrics.reduce((total, metric) => total + metric.current.length, 0);
  const attentionCount = metrics.reduce((total, metric) => total + metric.needsReview, movingReviewCount);
  const activeScanners = metrics.reduce((total, metric) => total + metric.scanners.filter((device) => device.isActive).length, 0);
  const renderLocationNode = (metric: LocationMetric) => <button className="location-flow-node" key={metric.location.locationId} onClick={() => onSelect(metric.location.locationId)}>
    <span className={`location-flow-node__icon location-flow-node__icon--${metric.location.type}`}><LocationTypeIcon location={metric.location} size={16} /></span>
    <span className="location-flow-node__body"><strong>{metric.location.name}</strong><small>{metric.current.length} here · {metric.arriving.length} inbound</small></span>
    <span className="location-flow-node__stats"><b>{metric.eventsLastDay}</b><small>24h scans</small></span>
    {metric.needsReview > 0 && <Pill tone="warn">{metric.needsReview} review</Pill>}
    <ChevronRight size={15} />
  </button>;
  return <section className="location-network panel">
    <div className="location-network__header"><PanelTitle title="Network flow" subtitle="A top-to-bottom view of where work is concentrated, moving, and waiting for attention." /><span className="location-network__hint">Select any location node to focus the workspace below.</span></div>
    <div className="location-network__summary"><span><b>{metrics.length}</b><small>operating locations</small></span><span><b>{currentCount}</b><small>containers at sites</small></span><span><b>{movingCount}</b><small>in transit</small></span><span><b>{activeScanners}</b><small>enabled scanners</small></span><span className={attentionCount ? "location-network__summary--warn" : ""}><b>{attentionCount}</b><small>needs review</small></span></div>
    <div className="location-flow-stack">
      <div className="location-flow-stage location-flow-stage--collection"><header><div><span className="eyebrow">Stage 1</span><h3>Collection sites</h3><p>Stores and Donation Xpress locations where containers enter the network.</p></div><strong>{collection.length}<small>locations</small></strong></header><div className="location-flow-stage__nodes">{collectionPreview.map(renderLocationNode)}{collection.length > collectionPreview.length && <span className="location-flow-stage__more">+ {collection.length - collectionPreview.length} more in the directory below</span>}</div></div>
      <div className="location-flow-connector"><ArrowRight size={18} /><span>{movingCount ? `${movingCount} containers currently moving between locations` : "No active transfers recorded"}</span><ArrowRight size={18} /></div>
      <div className="location-flow-stage location-flow-stage--transit"><header><div><span className="eyebrow">Stage 2</span><h3>In transit</h3><p>The handoff boundary between origin and destination.</p></div><strong>{movingCount}<small>containers</small></strong></header><div className="location-flow-transit-card"><span className="location-flow-transit-card__icon"><Truck size={20} /></span><div><strong>{movingCount ? "Routes are active" : "Network is quiet"}</strong><p>{movingCount ? "Each active route remains linked to its origin, destination, and receipt scan." : "A sent-in-transit scan will appear here when a route begins."}</p></div>{movingReviewCount > 0 && <Pill tone="warn">{movingReviewCount} review</Pill>}</div></div>
      <div className="location-flow-connector"><ArrowRight size={18} /><span>Receiving confirms the container’s next official location</span><ArrowRight size={18} /></div>
      <div className="location-flow-stage location-flow-stage--warehouse"><header><div><span className="eyebrow">Stage 3</span><h3>Processing sites</h3><p>Warehouses where loads are received, sorted, and prepared for the next handoff.</p></div><strong>{warehouses.length}<small>locations</small></strong></header><div className="location-flow-stage__nodes">{warehousePreview.map(renderLocationNode)}{warehouses.length > warehousePreview.length && <span className="location-flow-stage__more">+ {warehouses.length - warehousePreview.length} more in the directory below</span>}</div></div>
    </div>
  </section>;
}

function LocationsPage({ data, openDetail, setPage }: { data: OperationsData; openDetail: OpenDetail; setPage: (page: Page) => void }) {
  const physicalLocations = data.fixtures.locations.filter((location) => location.type !== "in_transit");
  const [selectedLocationId, setSelectedLocationId] = useState(physicalLocations[0]?.locationId ?? "");
  const [locationQuery, setLocationQuery] = useState("");
  const [locationTypeFilter, setLocationTypeFilter] = useState<"all" | Location["type"]>("all");
  const [locationHealthFilter, setLocationHealthFilter] = useState<"all" | "attention">("all");
  const [locationSort, setLocationSort] = useState<"work" | "containers" | "activity" | "alphabetical">("work");
  const selected = physicalLocations.find((location) => location.locationId === selectedLocationId) ?? physicalLocations[0];
  if (!selected) return <EmptyState>No operating locations are available.</EmptyState>;

  const transitId = data.fixtures.locations.find((location) => location.type === "in_transit")?.locationId;
  const container = (id: string) => data.fixtures.containers.find((item) => item.containerId === id);
  const eventsFor = (containerId: string) => data.events
    .filter((event) => event.containerId === containerId)
    .sort((left, right) => Date.parse(right.effectiveAt) - Date.parse(left.effectiveAt));
  const routeFor = (projection: Projection) => {
    const events = eventsFor(projection.containerId);
    const departure = events.find((event) => event.eventType === "batch_out");
    const destinationId = departure?.payload.destinationLocationId;
    const destination = typeof destinationId === "string" ? data.fixtures.locations.find((item) => item.locationId === destinationId) : undefined;
    const originEvent = departure
      ? events.find((event) => event.eventId !== departure.eventId && event.locationId !== transitId && Date.parse(event.effectiveAt) < Date.parse(departure.effectiveAt))
      : undefined;
    const origin = originEvent ? data.fixtures.locations.find((item) => item.locationId === originEvent.locationId) : undefined;
    return { destination, origin, departure };
  };
  const projections = Object.values(data.projections).filter(Boolean) as Projection[];
  const metricsFor = (location: Location): LocationMetric => {
    const current = projections.filter((projection) => projection.locationId === location.locationId);
    const moving = projections.filter((projection) => projection.locationId === transitId);
    const arriving = moving.filter((projection) => routeFor(projection).destination?.locationId === location.locationId);
    const leaving = moving.filter((projection) => routeFor(projection).origin?.locationId === location.locationId);
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
  const arriving = moving.filter((projection) => routeFor(projection).destination?.locationId === selected.locationId);
  const leaving = moving.filter((projection) => routeFor(projection).origin?.locationId === selected.locationId);
  const openContainer = (projection: Projection) => openDetail({
    eyebrow: "Route container",
    title: container(projection.containerId)?.label ?? "Tracked container",
    body: <><DetailFacts items={[
      ["Current state", projection.loadState],
      ["Official location", data.fixtures.locations.find((item) => item.locationId === projection.locationId)?.name ?? "Not observed"],
      ["History health", projection.health],
      ["Last observed", relativeTime(projection.lastObservedAt)]
    ]}/><h3 className="detail-section-title">Immutable observation history</h3><EventEvidence events={eventsFor(projection.containerId)} data={data}/></>
  });

  return <>
    <LocationNetworkOverview metrics={locationMetrics} movingCount={moving.length} movingReviewCount={movingReviewCount} onSelect={setSelectedLocationId} />
    <section className="location-selector panel">
      <div className="location-selector__heading"><PanelTitle title="Location directory" subtitle="Search, sort, and filter every physical location before opening its operating picture." /><div className="location-directory-tools"><label className="location-search"><Search size={17} /><input value={locationQuery} onChange={(event) => setLocationQuery(event.target.value)} placeholder="Search locations" aria-label="Search locations" /></label><select value={locationTypeFilter} onChange={(event) => setLocationTypeFilter(event.target.value as typeof locationTypeFilter)} aria-label="Filter by location type"><option value="all">All location types</option><option value="store_backroom">Stores</option><option value="donation_express">Donation Xpress</option><option value="warehouse">Warehouses</option></select><select value={locationHealthFilter} onChange={(event) => setLocationHealthFilter(event.target.value as typeof locationHealthFilter)} aria-label="Filter locations needing attention"><option value="all">All locations</option><option value="attention">Needs attention</option></select><select value={locationSort} onChange={(event) => setLocationSort(event.target.value as typeof locationSort)} aria-label="Sort locations"><option value="work">Sort by active work</option><option value="containers">Sort by containers here</option><option value="activity">Sort by 24h activity</option><option value="alphabetical">Sort A–Z</option></select></div></div>
      <div className="location-directory-summary"><span>Showing <b>{matchingMetrics.length}</b> of {physicalLocations.length} locations</span><span>{matchingMetrics.reduce((total, metric) => total + metric.current.length, 0)} containers in the filtered view</span><span>{matchingMetrics.reduce((total, metric) => total + metric.needsReview, 0)} need review</span></div>
      <div className="location-selector__list">{matchingMetrics.map((metric) => {
        const location = metric.location;
        return <button key={location.locationId} className={`location-directory-card ${location.locationId === selected.locationId ? "active" : ""}`} onClick={() => setSelectedLocationId(location.locationId)}><span className={`location-type-icon location-type-icon--${location.type}`}><LocationTypeIcon location={location} /></span><span className="location-directory-card__body"><b>{location.name}</b><small>{locationTypeLabel(location.type)} · {metric.scanners.length} scanner{metric.scanners.length === 1 ? "" : "s"}</small><span className="location-directory-card__stats"><span><strong>{metric.current.length}</strong> here</span><span><strong>{metric.arriving.length}</strong> in</span><span><strong>{metric.leaving.length}</strong> out</span><span><strong>{metric.eventsLastDay}</strong> scans</span></span></span><span className="location-directory-card__status">{metric.needsReview > 0 ? <Pill tone="warn">{metric.needsReview} review</Pill> : metric.staleScanners > 0 ? <Pill tone="warn">{metric.staleScanners} stale</Pill> : <Pill tone="good">Operating</Pill>}<ChevronRight size={17} /></span></button>;
      })}{matchingMetrics.length === 0 && <div className="location-selector__empty">No locations match the current search and filters.</div>}</div>
    </section>

    <section className="location-workspace panel">
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
    </section>
  </>;
}

function LocationWorkflowLane({ title, subtitle, tone, items, data, onOpen }: { title: string; subtitle: string; tone: "here" | "arriving" | "leaving"; items: Projection[]; data: OperationsData; onOpen: (projection: Projection) => void }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, 8);
  const locationName = (id: string | null) => data.fixtures.locations.find((location) => location.locationId === id)?.name ?? "Unconfirmed";
  return <section className={`workflow-lane workflow-lane--${tone}`}>
    <header><span>{tone === "here" ? <Boxes size={18} /> : tone === "arriving" ? <ArrowRight size={18} /> : <Truck size={18} />}</span><div><h3>{title}</h3><p>{subtitle}</p></div><b>{items.length}</b></header>
    <div className="workflow-lane__items">{visible.length ? visible.map((projection) => {
      const record = data.fixtures.containers.find((container) => container.containerId === projection.containerId);
      return <button key={projection.containerId} onClick={() => onOpen(projection)}><span><strong>{record?.label ?? "Unknown"}</strong><small>{record?.type} · {projection.loadState} · {locationName(projection.locationId)}</small></span><Pill tone={projection.health === "needs_review" ? "warn" : projection.loadState === "loaded" ? "blue" : "good"}>{projection.health === "needs_review" ? "Review" : projection.loadState}</Pill><ChevronRight size={16} /></button>;
    }) : <div className="workflow-lane__empty">No containers in this workflow lane.</div>}</div>
    {items.length > 8 && <button className="workflow-lane__more" onClick={() => setExpanded((value) => !value)}>{expanded ? "Show fewer" : `Show all ${items.length}`}</button>}
  </section>;
}

function locationDetail(location: Location, data: OperationsData, setPage?: (page: Page) => void, openDetail?: OpenDetail): DetailView {
  const projections = Object.values(data.projections).filter(Boolean) as Projection[];
  const containersHere = projections.filter((projection) => projection.locationId === location.locationId);
  const assignedDevices = data.fixtures.devices.filter((device) => device.assignedLocationId === location.locationId);
  const recentEvents = data.events.filter((event) => event.locationId === location.locationId).slice(0, 10);
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
          <div className="evidence"><span><strong>{projection.conflicts.length}</strong> conflict</span><span><strong>{projection.appliedEventIds?.length ?? 0}</strong> applied events</span><span><strong>{projection.warnings.length}</strong> timing warnings</span></div>
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
    session.principal.role === "operations_administrator";
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
            <strong>{projection?.loadState ?? "Unknown"} · {currentLocation?.name ?? "No confirmed location"}</strong>
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
          {item.proposedCorrection.loadState && <span><ContainerIcon size={15} /><small>Correct state</small><strong>{item.proposedCorrection.loadState}</strong></span>}
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

function ActivityPage({ data, query, openDetail, setPage }: { data: OperationsData; query: string; openDetail: OpenDetail; setPage: (page: Page) => void }) {
  const [eventFilter, setEventFilter] = useState<"all" | StoredEvent["eventType"]>("all");
  const [locationFilter, setLocationFilter] = useState("");
  const [deviceFilter, setDeviceFilter] = useState("");
  const [windowFilter, setWindowFilter] = useState<ActivityWindow>("all");
  const containerName = (id: string) => data.fixtures.containers.find((item) => item.containerId === id)?.label ?? "Unknown container";
  const locationName = (id: string) => data.fixtures.locations.find((item) => item.locationId === id)?.name ?? "Unknown location";
  const deviceFor = (id: string) => data.fixtures.devices.find((item) => item.deviceId === id);
  const searchTerm = query.trim().toLowerCase();
  const cutoff = windowFilter === "today" ? Date.now() - 24 * 60 * 60 * 1000 : windowFilter === "7d" ? Date.now() - 7 * 24 * 60 * 60 * 1000 : windowFilter === "30d" ? Date.now() - 30 * 24 * 60 * 60 * 1000 : null;
  const events = data.events.filter((event) => {
    const device = deviceFor(event.deviceId);
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
      device?.label ?? "",
      scannerNumber(event.deviceId),
      event.accuracyFlags.join(" ")
    ].join(" ").toLowerCase();
    return (eventFilter === "all" || event.eventType === eventFilter) &&
      (!searchTerm || searchable.includes(searchTerm)) &&
      (!locationFilter || event.locationId === locationFilter) &&
      (!deviceFilter || event.deviceId === deviceFilter) &&
      (cutoff === null || Date.parse(event.eventAt) >= cutoff);
  });
  const clearFilters = () => { setEventFilter("all"); setLocationFilter(""); setDeviceFilter(""); setWindowFilter("all"); };
  const hasFilters = Boolean(searchTerm || locationFilter || deviceFilter || windowFilter !== "all" || eventFilter !== "all");
  return <section className="panel activity-page">
    <div className="activity-purpose"><div><span className="eyebrow">Operational feed</span><strong>Physical observations from scanners</strong><p>Use Activity to trace where a container was scanned and how the movement unfolded. For administrator changes, sign-ins, device controls, and approvals, use Audit trail.</p></div><button className="secondary" onClick={() => setPage("audit")}><ScrollText size={15} /> Open audit trail</button></div>
    <div className="toolbar"><div className="filter-tabs">{(["all", "load_assigned", "batch_out", "batch_in", "emptied"] as const).map((value) => <button key={value} className={eventFilter === value ? "active" : ""} onClick={() => setEventFilter(value)}>{value === "all" ? "All events" : eventLabel(value)}</button>)}</div><span className="date-chip">{events.length} shown</span></div>
    <div className="activity-filters"><label>Location<select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}><option value="">All locations</option>{data.fixtures.locations.map((location) => <option value={location.locationId} key={location.locationId}>{location.name}</option>)}</select></label><label>Scanner<select value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)}><option value="">All scanners</option>{data.fixtures.devices.map((device) => <option value={device.deviceId} key={device.deviceId}>{scannerNumber(device.deviceId)} · {device.label}</option>)}</select></label><label>Time window<select value={windowFilter} onChange={(event) => setWindowFilter(event.target.value as ActivityWindow)}><option value="all">All available</option><option value="today">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label>{hasFilters && <button className="secondary activity-filters__clear" onClick={clearFilters}>Clear filters</button>}</div>
    {searchTerm && <p className="activity-search-summary">Searching event IDs, load codes, goods, containers, scanners, locations, and warning text for <strong>“{query.trim()}”</strong>.</p>}
    {events.length ? <div className="timeline">{events.slice(0, 100).map((event, index) => {
      const container = data.fixtures.containers.find((item) => item.containerId === event.containerId);
      const location = locationName(event.locationId);
      return <article className="clickable-timeline" key={event.eventId} onClick={() => openDetail({
        eyebrow: "Scanner observation",
        icon: <FileClock size={18} />,
        status: event.accuracyFlags.length ? { label: "Review evidence", tone: "warn" } : { label: "Timing verified", tone: "good" },
        summary: "A physical observation received from a shared scanner. Use this feed for movement history; use Audit trail for administrator actions.",
        recordId: event.eventId,
        recordIdLabel: "Event UUID",
        title: `${container?.label ?? "Unknown container"} · ${eventLabel(event.eventType)}`,
        body: <><DetailFacts items={[["Observed at", new Date(event.eventAt).toLocaleString()], ["Received at", new Date(event.receivedAt).toLocaleString()], ["Location", location], ["Scanner", `${scannerNumber(event.deviceId)} · ${deviceFor(event.deviceId)?.label ?? "Unknown"}`], ["Load code", String(event.payload.displayLoadCode ?? event.loadCodeId ?? "Not assigned")]]}/><h3 className="detail-section-title">Observation evidence</h3><EventEvidence events={[event]} data={data}/></>
      })}><div className="timeline__rail"><span>{index + 1}</span><i /></div><div className="timeline__card"><div><Pill tone={event.accuracyFlags.length ? "warn" : "blue"}>{eventLabel(event.eventType)}</Pill><time>{new Date(event.eventAt).toLocaleString()}</time></div><h3>{container?.label ?? "Unknown container"} · {location}</h3><p>{deviceFor(event.deviceId)?.label ?? `Scanner ${scannerNumber(event.deviceId)}`} · received {relativeTime(event.receivedAt)} · {event.accuracyFlags.length ? `${event.accuracyFlags.length} warning` : "timing verified"}</p></div></article>;
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
      status: event.accuracyFlags.length ? { label: "Review evidence", tone: "warn" } : { label: "Timing verified", tone: "good" },
      summary: "The original scanner observation is preserved exactly as received by StackTrack.",
      recordId: event.eventId,
      recordIdLabel: "Event UUID",
      title: `${c(event.containerId)?.label} · ${eventLabel(event.eventType)}`,
      body: <><DetailFacts items={[
        ["Observed at", new Date(event.eventAt).toLocaleString()],
        ["Received at", new Date(event.receivedAt).toLocaleString()],
        ["Location", l(event.locationId) ?? "Unknown"],
        ["Event UUID", event.eventId]
      ]}/><h3 className="detail-section-title">Accuracy evidence</h3><p className="detail-lead">{event.accuracyFlags.length ? event.accuracyFlags.join(" · ") : "No timing, ordering, or reference-data warnings were recorded."}</p><EventEvidence events={[event]} data={data}/></>
    })}><div className="timeline__rail"><span>{index + 1}</span><i /></div><div className="timeline__card">
      <div><Pill tone="blue">{eventLabel(event.eventType)}</Pill><time>{new Date(event.eventAt).toLocaleString()}</time></div>
      <h3>{c(event.containerId)?.label} · {l(event.locationId)}</h3>
      <p>Event {event.eventId.slice(0, 8)} · received {relativeTime(event.receivedAt)} · {event.accuracyFlags.length ? `${event.accuracyFlags.length} warning` : "timing verified"}</p>
    </div></article>
  ))}</div></section>;
}

function DevicesPage({ data, query, openDetail, refresh, session, onRequestSignIn }: { data: OperationsData; query: string; openDetail: OpenDetail; refresh: () => Promise<void>; session: AdminSession | null; onRequestSignIn: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const operatingLocations = data.fixtures.locations.filter((location) => location.type !== "in_transit");
  const matchingDevices = data.fixtures.devices.filter((device) => {
    const assignedLocation = data.fixtures.locations.find((location) => location.locationId === device.assignedLocationId)?.name ?? "";
    const previousLocations = data.fixtures.deviceAssignments
      .filter((entry) => entry.deviceId === device.deviceId)
      .flatMap((entry) => [entry.previousLocationId, entry.assignedLocationId])
      .map((locationId) => data.fixtures.locations.find((location) => location.locationId === locationId)?.name ?? "")
      .join(" ");
    const searchText = `${device.label} ${scannerNumber(device.deviceId)} ${assignedLocation} ${previousLocations}`.toLowerCase();
    return searchText.includes(query.trim().toLowerCase());
  });
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
    <div className="device-guidance"><ShieldCheck size={20} /><span><strong>Scanner control is an accountable action.</strong> The app reports its installed version; assignments and scanner-name changes become permanent history, with an optional move note. Offline scans remain on the scanner until it reconnects, so this console shows the last confirmed report—not a live offline queue.</span></div>
    {!session && <div className="access-lock"><ShieldCheck size={20}/><span><strong>Sign in to change scanners.</strong> You can inspect device records now; changes are locked until a verified Organization Owner or Operations Administrator signs in.</span><button className="secondary" onClick={onRequestSignIn}>Sign in</button></div>}
    {notice && <div className={`device-notice ${notice.tone === "error" ? "device-notice--error" : ""}`}>{notice.text}</div>}
    {query.trim() && <p className="device-search-summary">Showing {matchingDevices.length} of {data.fixtures.devices.length} scanners matching “{query.trim()}”. Searches include the current and previous assigned locations.</p>}
    {matchingDevices.length ? <div className="device-grid">{matchingDevices.map((device) => <DeviceCard key={device.deviceId} device={device} data={data} operatingLocations={operatingLocations} busy={busyId === device.deviceId} canManage={Boolean(session && ["organization_owner", "operations_administrator"].includes(session.principal.role))} onSave={save} onDetails={() => openDetail(deviceDetail(device, data))} />)}</div> : <EmptyState>No scanners match that device, scanner ID, or location search.</EmptyState>}
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
  locationId: string;
  deviceId: string;
  actor: string;
  eventType: "" | StoredEvent["eventType"];
  health: "" | Projection["health"];
  from: string;
  to: string;
};

const emptyReportsFilters: ReportsFilterDraft = { search: "", locationId: "", deviceId: "", actor: "", eventType: "", health: "", from: "", to: "" };

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
    const searchable = [event.eventId, containerLabel(event.containerId), eventLabel(event.eventType), locationName(event.locationId), deviceName(event.deviceId), ...event.accuracyFlags].join(" ").toLowerCase();
    return (!searchTerm || searchable.includes(searchTerm)) && (!applied.locationId || event.locationId === applied.locationId) && (!applied.deviceId || event.deviceId === applied.deviceId) && (!applied.eventType || event.eventType === applied.eventType) && inDateRange(event.eventAt);
  };
  const filteredEvents = data.events.filter(eventMatches).sort((left, right) => Date.parse(right.eventAt) - Date.parse(left.eventAt));
  const projectionMatches = (projection: Projection) => {
    const relatedEvents = data.events.filter((event) => event.containerId === projection.containerId);
    const searchable = [containerLabel(projection.containerId), locationName(projection.locationId), ...relatedEvents.map((event) => `${event.eventId} ${deviceName(event.deviceId)} ${locationName(event.locationId)}`)].join(" ").toLowerCase();
    const locationMatches = !applied.locationId || projection.locationId === applied.locationId || relatedEvents.some((event) => event.locationId === applied.locationId);
    const deviceMatches = !applied.deviceId || relatedEvents.some((event) => event.deviceId === applied.deviceId);
    const dateMatches = (!applied.from && !applied.to) || relatedEvents.some((event) => inDateRange(event.eventAt));
    const typeMatches = !applied.eventType || relatedEvents.some((event) => event.eventType === applied.eventType && inDateRange(event.eventAt));
    return (!searchTerm || searchable.includes(searchTerm)) && locationMatches && deviceMatches && dateMatches && typeMatches && (!applied.health || projection.health === applied.health);
  };
  const filteredProjections = Object.values(data.projections).filter((projection): projection is Projection => {
    if (!projection) return false;
    return projectionMatches(projection);
  });
  const filteredCorrections = data.correctionRequests.filter((item) => {
    const searchable = [item.correctionRequestId, item.containerLabel, item.requestedByDisplayName, item.reason, item.latestActorDisplayName ?? ""].join(" ").toLowerCase();
    return (!searchTerm || searchable.includes(searchTerm)) && (!applied.locationId || item.proposedCorrection.locationId === applied.locationId) && (!applied.actor || item.requestedByDisplayName === applied.actor || item.latestActorDisplayName === applied.actor) && inDateRange(item.requestedAt);
  });
  const actorOptions = Array.from(new Set([...data.auditEntries.map((entry) => entry.actorDisplayName), ...data.correctionRequests.flatMap((item) => [item.requestedByDisplayName, item.latestActorDisplayName ?? ""]).filter(Boolean)])).sort((left, right) => left.localeCompare(right));
  const filteredAuditEntries = data.auditEntries.filter((entry) => {
    const searchable = [entry.auditId, entry.action, entry.targetType, entry.targetLabel ?? "", entry.actorDisplayName, entry.locationName ?? "", humanizeDetailsText(entry.details, data)].join(" ").toLowerCase();
    const deviceMatches = !applied.deviceId || entry.targetId === applied.deviceId || entry.details.deviceId === applied.deviceId;
    return (!searchTerm || searchable.includes(searchTerm)) && (!applied.locationId || entry.locationId === applied.locationId || entry.details.locationId === applied.locationId || entry.details.assignedLocationId === applied.locationId) && deviceMatches && (!applied.actor || entry.actorDisplayName === applied.actor) && inDateRange(entry.occurredAt);
  });
  const filteredDevices = data.fixtures.devices.filter((device) => {
    const searchable = [device.deviceId, scannerNumber(device.deviceId), device.label, locationName(device.assignedLocationId), device.reportedAppVersion ?? ""].join(" ").toLowerCase();
    return (!searchTerm || searchable.includes(searchTerm)) && (!applied.locationId || device.assignedLocationId === applied.locationId) && (!applied.deviceId || device.deviceId === applied.deviceId) && inDateRange(device.lastReportedAt);
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
      const outbound = data.events
        .filter((event) => event.containerId === projection.containerId && event.eventType === "batch_out")
        .sort((left, right) => Date.parse(right.effectiveAt) - Date.parse(left.effectiveAt))[0];
      const destinationId = typeof outbound?.payload.destinationLocationId === "string" ? outbound.payload.destinationLocationId : null;
      const ageHours = outbound ? Math.max(0, (Date.now() - Date.parse(outbound.effectiveAt)) / 3_600_000) : null;
      return { projection, outbound, destinationId, ageHours };
    })
    .sort((left, right) => (right.ageHours ?? -1) - (left.ageHours ?? -1));
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
  const registrationScopeAvailable = !applied.locationId && !applied.deviceId && !applied.eventType && !applied.health && !applied.from && !applied.to;
  const unobservedContainers = registrationScopeAvailable ? data.fixtures.containers.filter((container) => !data.projections[container.containerId] && (!searchTerm || container.label.toLowerCase().includes(searchTerm))).length : null;
  const integrityPercent = filteredEvents.length ? Math.round(((filteredEvents.length - flaggedEvents.length) / filteredEvents.length) * 100) : 100;
  const deviceFreshnessPercent = filteredDevices.length ? Math.round(((filteredDevices.length - staleDevices.length) / filteredDevices.length) * 100) : 100;
  const activeFilterCount = [applied.search, applied.locationId, applied.deviceId, applied.actor, applied.eventType, applied.health, applied.from, applied.to].filter(Boolean).length;
  const draftDateError = draft.from && draft.to && draft.from > draft.to ? "The start date must be on or before the end date." : null;
  const updateDraft = <K extends keyof ReportsFilterDraft>(key: K, value: ReportsFilterDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const applyFilters = () => { if (!draftDateError) setApplied(draft); };
  const clearFilters = () => { setDraft(emptyReportsFilters); setApplied(emptyReportsFilters); };
  const reportScope = activeFilterCount ? `${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} applied` : "All available operations data";
  const openHealthDetail = () => openDetail({
    eyebrow: "Data quality guide",
    title: "How to read data health",
    icon: <CircleHelp size={18} />,
    summary: "Data health describes evidence quality and operational follow-up. It is not a claim that every physical container is correct.",
    body: <div className="health-definition-list">
      <article><Pill tone={integrityPercent >= 98 ? "good" : "warn"}>{integrityPercent >= 98 ? "Strong" : "Review"}</Pill><div><strong>Observation integrity — {integrityPercent}%</strong><p>Share of scanner observations with no timing, sequence, or device-order flags. A flagged event is retained; it means an administrator should verify context before relying on it for a correction.</p><small>Use case: find late uploads, duplicate scans, or offline devices that may make movement appear out of order.</small></div></article>
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
    status: event.accuracyFlags.length ? { label: "Review flags", tone: "warn" } : { label: "Verified timing", tone: "good" },
    summary: "A single immutable scanner observation from the report scope.",
    recordId: event.eventId,
    recordIdLabel: "Event ID",
    body: <><DetailFacts items={[["Observation", eventLabel(event.eventType)], ["Location", locationName(event.locationId)], ["Scanner", `${deviceName(event.deviceId)} (${scannerNumber(event.deviceId)})`], ["Observed at", new Date(event.eventAt).toLocaleString()], ["Received at", new Date(event.receivedAt).toLocaleString()], ["Latency", `${latencySeconds(event)} seconds`], ["Data flags", event.accuracyFlags.length ? event.accuracyFlags.join(", ") : "None"]]}/><h3 className="detail-section-title">Evidence</h3><EventEvidence events={[event]} data={data}/></>
  });
  const reports = [
    { id: "movement", icon: Activity, title: "Movement ledger", text: "Every accepted container observation, with scanner, location, receipt latency, and data flags.", count: filteredEvents.length, tag: "Ready" },
    { id: "loads", icon: PackageCheck, title: "Load-code handoff", text: "Load codes created in the selected period, tied to their container, goods classification, and origin.", count: filteredEvents.filter((event) => event.eventType === "load_assigned").length, tag: "Ready" },
    { id: "exceptions", icon: AlertTriangle, title: "Data-quality exceptions", text: "Containers and observations that need review before an administrator treats the projection as settled.", count: reviewCount + flaggedEvents.length, tag: "Ready" },
    { id: "corrections", icon: FilePenLine, title: "Correction register", text: "Requests, decisions, reasons, and proposed official-state changes with evidence preserved.", count: filteredCorrections.length, tag: "Ready" },
    { id: "devices", icon: Smartphone, title: "Scanner coverage", text: "Location assignment, enablement, app version, last report, and stale-device follow-up.", count: filteredDevices.length, tag: "Ready" },
    { id: "locations", icon: MapPin, title: "Location throughput", text: "Event volume, distinct containers, and flagged observations by store, Donation Xpress, or warehouse.", count: locationRows.length, tag: "Ready" },
    { id: "transit", icon: Truck, title: "Transit aging", text: "Containers still in motion, their origin and destination, and how long a receipt has been outstanding.", count: transitRows.length, tag: "Ready" },
    { id: "latency", icon: Clock3, title: "Scan latency", text: "Average and maximum upload delay by scanner, so offline work is separated from service or device problems.", count: latencyRows.length, tag: "Ready" },
    { id: "governance", icon: ScrollText, title: "Governance actions", text: "Administrator sign-ins, scanner controls, review decisions, and corrections with actor and location context.", count: filteredAuditEntries.length, tag: "Ready" },
    { id: "lake", icon: Cloud, title: "Microsoft analytics export", text: "A future governed feed into Fabric or ADLS Gen2; scanner writes remain in PostgreSQL.", count: null, tag: "Planned" }
  ] as const;
  const openReport = (report: typeof reports[number]) => {
    if (report.id === "movement") {
      downloadCsv("stacktrack-movement-ledger.csv", [["Event ID", "Container", "Observation", "Location", "Scanner", "Observed at", "Received at", "Latency seconds", "Data flags"], ...filteredEvents.map((event) => [event.eventId, containerLabel(event.containerId), eventLabel(event.eventType), locationName(event.locationId), deviceName(event.deviceId), event.eventAt, event.receivedAt, latencySeconds(event), event.accuracyFlags.join("; ")])]);
      return;
    }
    if (report.id === "loads") {
      downloadCsv("stacktrack-load-code-handoff.csv", [["Load code", "Container", "Origin", "Goods type", "Secondary value", "Created at", "Scanner"], ...filteredEvents.filter((event) => event.eventType === "load_assigned").map((event) => [String(event.payload.displayLoadCode ?? event.loadCodeId ?? ""), containerLabel(event.containerId), locationName(event.locationId), String(event.payload.goodsType ?? ""), String(event.payload.secondaryValue ?? ""), event.eventAt, deviceName(event.deviceId)])]);
      return;
    }
    if (report.id === "exceptions") {
      downloadCsv("stacktrack-data-quality-exceptions.csv", [["Container", "Health", "Current location", "Conflicts", "Projection warnings", "Flagged observations", "Last observed"], ...filteredProjections.map((projection) => [containerLabel(projection.containerId), projection.health, locationName(projection.locationId), projection.conflicts.map((item) => item.reason).join("; "), projection.warnings.join("; "), filteredEvents.filter((event) => event.containerId === projection.containerId && event.accuracyFlags.length).length, projection.lastObservedAt ?? ""]) , ...flaggedEvents.filter((event) => !filteredProjections.some((projection) => projection.containerId === event.containerId)).map((event) => [containerLabel(event.containerId), "observation_flag", locationName(event.locationId), "", event.accuracyFlags.join("; "), 1, event.eventAt])]);
      return;
    }
    if (report.id === "corrections") {
      downloadCsv("stacktrack-correction-register.csv", [["Request ID", "Container", "Impact", "Status", "Requested by", "Requested at", "Proposed location", "Proposed state", "Request reason", "Latest decision by", "Latest decision at", "Latest decision reason"], ...filteredCorrections.map((item) => [item.correctionRequestId, item.containerLabel, item.impactLevel, item.status, item.requestedByDisplayName, item.requestedAt, locationName(item.proposedCorrection.locationId), item.proposedCorrection.loadState ?? "", item.reason, item.latestActorDisplayName ?? "", item.latestActionAt ?? "", item.latestActionReason ?? ""])]);
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
      downloadCsv("stacktrack-transit-aging.csv", [["Container", "Origin", "Destination", "Sent at", "Age hours", "Health", "Receipt status"], ...transitRows.map((row) => [containerLabel(row.projection.containerId), row.outbound ? locationName(row.outbound.locationId) : "Unknown origin", locationName(row.destinationId), row.outbound?.effectiveAt ?? "", row.ageHours === null ? "" : row.ageHours.toFixed(1), row.projection.health, row.outbound ? "Awaiting receipt" : "Missing outbound evidence"])]);
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
      <div className="report-filter-panel__header"><div><span className="eyebrow">Reporting scope</span><h2>Choose exactly what to analyze</h2><p>Filters narrow the matching datasets and downloads; the source events are never changed. Actor filtering applies to governance and correction reports.</p></div><div><span className="report-filter-panel__scope">{reportScope}</span><button className="secondary" onClick={clearFilters} disabled={!activeFilterCount}>Clear filters</button></div></div>
      <div className="report-filter-grid">
        <label className="report-filter--wide">Search<input value={draft.search} onChange={(event) => updateDraft("search", event.target.value)} placeholder="Container, scanner, event, or location" /></label>
         <label>Location<select value={draft.locationId} onChange={(event) => updateDraft("locationId", event.target.value)}><option value="">All locations</option>{data.fixtures.locations.map((location) => <option value={location.locationId} key={location.locationId}>{location.name}{location.type === "in_transit" ? " · virtual transit" : ""}</option>)}</select></label>
        <label>Scanner<select value={draft.deviceId} onChange={(event) => updateDraft("deviceId", event.target.value)}><option value="">All scanners</option>{data.fixtures.devices.map((device) => <option value={device.deviceId} key={device.deviceId}>{scannerNumber(device.deviceId)} · {device.label}</option>)}</select></label>
        <label>Admin / requester<select value={draft.actor} onChange={(event) => updateDraft("actor", event.target.value)}><option value="">All users</option>{actorOptions.map((actor) => <option value={actor} key={actor}>{actor}</option>)}</select></label>
        <label>Observation type<select value={draft.eventType} onChange={(event) => updateDraft("eventType", event.target.value as ReportsFilterDraft["eventType"])}><option value="">All observations</option><option value="load_assigned">Marked full / load assigned</option><option value="batch_out">Sent in transit</option><option value="batch_in">Received</option><option value="emptied">Marked empty</option></select></label>
        <label>Data health<select value={draft.health} onChange={(event) => updateDraft("health", event.target.value as ReportsFilterDraft["health"])}><option value="">All projection health</option><option value="clean">Clean projection</option><option value="warning">Warning</option><option value="needs_review">Needs review</option></select></label>
        <label>From date<input type="date" value={draft.from} onChange={(event) => updateDraft("from", event.target.value)} /></label>
        <label>To date<input type="date" value={draft.to} onChange={(event) => updateDraft("to", event.target.value)} /></label>
        <button className="primary report-filter-panel__apply" onClick={applyFilters} disabled={Boolean(draftDateError)}>Apply report scope</button>
      </div>
      {draftDateError && <p className="report-filter-error">{draftDateError}</p>}
    </section>
    <div className="report-signal-grid"><article><span><Activity size={17} /></span><div><small>Observations in scope</small><strong>{filteredEvents.length}</strong><em>{flaggedEvents.length ? `${flaggedEvents.length} with data flags` : "No timing or order flags"}</em></div></article><article><span><Truck size={17} /></span><div><small>Movement in scope</small><strong>{transitCount}</strong><em>{transitCount ? "Receipt still needed" : "No active transit"}</em></div></article><article><span><AlertTriangle size={17} /></span><div><small>Needs review</small><strong>{reviewCount + warningCount}</strong><em>{reviewCount ? `${reviewCount} require a decision` : "No open projection conflicts"}</em></div></article><article><span><Smartphone size={17} /></span><div><small>Scanner freshness</small><strong>{deviceFreshnessPercent}%</strong><em>{staleDevices.length ? `${staleDevices.length} stale over 24 hours` : "All scanners reported recently"}</em></div></article></div>
     <div className="report-grid">{reports.map((report) => <article className="report-card report-card--expanded" key={report.title}><div className="report-card__top"><span><report.icon /></span><Pill tone={report.tag === "Ready" ? "good" : "muted"}>{report.tag}</Pill></div><h2>{report.title}</h2><p>{report.text}</p><div className="report-card__count">{report.count === null ? "—" : report.count}<small>{report.id === "movement" ? "events" : report.id === "locations" ? "locations" : report.id === "devices" ? "scanners" : report.id === "transit" ? "containers" : report.id === "latency" ? "scanner groups" : report.id === "governance" ? "actions" : "rows"} in scope</small></div><button onClick={() => openReport(report)}>{report.tag === "Ready" ? "Download filtered CSV" : "View integration plan"} <ArrowRight size={16} /></button></article>)}</div>
    <section className="panel data-health">
      <PanelTitle title="Data health" subtitle="Evidence quality signals, separated from physical-state decisions." action="How to read this" onClick={openHealthDetail} />
      <div className="health-score"><div className="health-score__value">{integrityPercent}%</div><div><strong>Observation integrity</strong><p>{flaggedEvents.length ? `${flaggedEvents.length} observations carry timing, sequence, or device-order flags.` : "Every observation in this scope is free of timing and order flags."}</p></div><button className="secondary" onClick={openHealthDetail}><CircleHelp size={14} /> Definitions</button></div>
      <div className="health-bar"><span style={{ width: `${Math.max(5, integrityPercent)}%` }} /></div>
       <div className="health-stats"><span><b>{filteredEvents.length}</b> events in scope</span><span><b>{flaggedEvents.length}</b> flagged observations</span><span><b>{reviewCount}</b> projection conflicts</span><span><b>{filteredCorrections.filter((item) => item.status === "pending").length}</b> pending corrections</span><span><b>{lateUploadCount}</b> uploads over 15 min</span></div>
       <div className="health-check-grid"><article><span><ShieldCheck size={16} /></span><div><strong>Integrity</strong><p>Are event timestamps and device order trustworthy?</p></div><Pill tone={integrityPercent >= 98 ? "good" : "warn"}>{integrityPercent >= 98 ? "Strong" : "Review"}</Pill></article><article><span><AlertTriangle size={16} /></span><div><strong>Projection decisions</strong><p>Are any containers waiting for a governed decision?</p></div><Pill tone={reviewCount ? "warn" : "good"}>{reviewCount ? `${reviewCount} open` : "Clear"}</Pill></article><article><span><Wifi size={16} /></span><div><strong>Scanner freshness</strong><p>Can quiet locations be trusted to have reported recently?</p></div><Pill tone={deviceFreshnessPercent >= 90 ? "good" : "warn"}>{deviceFreshnessPercent}% fresh</Pill></article><article><span><Boxes size={16} /></span><div><strong>Registration coverage</strong><p>Which tracked containers have never produced evidence?</p></div><Pill tone={unobservedContainers === null ? "muted" : unobservedContainers ? "warn" : "good"}>{unobservedContainers === null ? "Clear filters" : unobservedContainers ? `${unobservedContainers} unobserved` : "Complete"}</Pill></article><article><span><Clock3 size={16} /></span><div><strong>Upload latency</strong><p>Are delayed uploads explained by offline work?</p></div><Pill tone={lateUploadCount ? "warn" : "good"}>{lateUploadCount ? `${lateUploadCount} late` : "Normal"}</Pill></article></div>
    </section>
    <section className="panel report-preview"><PanelTitle title="Filtered event preview" subtitle={`${filteredEvents.length} immutable observations match the current scope. Select a row to inspect its evidence.`} action="Download movement ledger" onClick={() => openReport(reports[0]!)} />{filteredEvents.length ? <div className="table-wrap"><table><thead><tr><th>Observation</th><th>Container</th><th>Location</th><th>Scanner</th><th>Observed</th><th>Quality</th></tr></thead><tbody>{filteredEvents.slice(0, 12).map((event) => <tr className="clickable-row" key={event.eventId} onClick={() => openObservation(event)}><td><strong>{eventLabel(event.eventType)}</strong><small>{event.eventId.slice(0, 12)}…</small></td><td>{containerLabel(event.containerId)}</td><td>{locationName(event.locationId)}</td><td>{scannerNumber(event.deviceId)} · {deviceName(event.deviceId)}</td><td>{relativeTime(event.eventAt)}</td><td>{event.accuracyFlags.length ? <Pill tone="warn">Review flags</Pill> : <Pill tone="good">Verified</Pill>}</td></tr>)}</tbody></table></div> : <EmptyState>No observations match this report scope. Clear a filter or widen the date range.</EmptyState>}{filteredEvents.length > 12 && <p className="report-preview__more">Showing the newest 12 here; the download contains all {filteredEvents.length} matching observations.</p>}</section>
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
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await searchAuditEntries(session, { ...auditRequestFilters(applied), limit: pageSize, offset: pageIndex * pageSize });
      setResult(next); setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The audit trail could not be loaded.");
    } finally { setLoading(false); }
  }, [applied, pageIndex, session]);
  useEffect(() => { void load(); }, [load]);

  const updateFilter = (field: Exclude<keyof AuditDraft, "actionPrefixes" | "targetTypes">, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const toggleMultiFilter = (field: "actionPrefixes" | "targetTypes", value: string) => setDraft((current) => ({ ...current, [field]: current[field].includes(value) ? current[field].filter((item) => item !== value) : [...current[field], value] }));
  const clearMultiFilter = (field: "actionPrefixes" | "targetTypes") => setDraft((current) => ({ ...current, [field]: [] }));
  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault(); setPageIndex(0); setApplied({ ...draft });
  };
  const clearFilters = () => { setDraft(emptyAuditFilters); setPageIndex(0); setApplied(emptyAuditFilters); };
  const activeCount = Object.values(applied).filter((value) => Array.isArray(value) ? value.length > 0 : Boolean(value)).length;
  const pageCount = Math.max(1, Math.ceil(result.total / Math.max(1, result.limit)));
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
    <form className="audit-filter-panel" onSubmit={applyFilters}>
      <div className="audit-filter-panel__header"><div><strong>Filter the trail</strong><span>{activeCount ? `${activeCount} active filter${activeCount === 1 ? "" : "s"}` : "All audit events"}</span></div><div><button className="secondary" type="button" onClick={clearFilters} disabled={!activeCount}>Clear</button><button className="primary" type="submit"><Search size={16} /> Apply filters</button></div></div>
      <div className="audit-filter-grid">
        <label className="audit-filter--wide">Search text<input value={draft.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Actor, scanner, container, reason, or action" /></label>
        <label>Operating location<select value={draft.locationId} onChange={(event) => updateFilter("locationId", event.target.value)}><option value="">All locations</option>{data.fixtures.locations.map((location) => <option key={location.locationId} value={location.locationId}>{location.name}</option>)}</select></label>
        <label>Scanner<select value={draft.deviceId} onChange={(event) => updateFilter("deviceId", event.target.value)}><option value="">All scanners</option>{data.fixtures.devices.map((device) => <option key={device.deviceId} value={device.deviceId}>{scannerNumber(device.deviceId)} · {device.label}</option>)}</select></label>
        <AuditMultiSelect label="Action groups" options={[{ value: "admin", label: "Administrator access" }, { value: "device", label: "Scanner administration" }, { value: "review", label: "Review decisions" }, { value: "correction", label: "Corrections" }]} selected={draft.actionPrefixes} onToggle={(value) => toggleMultiFilter("actionPrefixes", value)} onClear={() => clearMultiFilter("actionPrefixes")} emptyLabel="All action groups" />
        <AuditMultiSelect label="Action applies to" options={[{ value: "device", label: "Scanner" }, { value: "container", label: "Container" }, { value: "review_case", label: "Review case" }, { value: "correction_request", label: "Correction request" }, { value: "admin_user", label: "Administrator account" }]} selected={draft.targetTypes} onToggle={(value) => toggleMultiFilter("targetTypes", value)} onClear={() => clearMultiFilter("targetTypes")} emptyLabel="All subjects" />
        <label>From date<input type="date" value={draft.from} onChange={(event) => updateFilter("from", event.target.value)} /></label>
        <label>To date<input type="date" value={draft.to} onChange={(event) => updateFilter("to", event.target.value)} /></label>
      </div>
      {draft.from && !draft.to && <p className="audit-filter-panel__date-note">No To date means from the selected local date through now.</p>}
    </form>
    {error && <div className="api-error"><AlertTriangle size={20} /><span>{error}</span><button onClick={() => void load()}>Retry</button></div>}
    <div className="audit-page__results"><div className="audit-page__results-heading"><div><span className="eyebrow">Append-only record</span><h3>{loading ? "Loading audit events…" : result.total ? `Events ${result.offset + 1}–${Math.min(result.offset + result.items.length, result.total)}` : "No matching events"}</h3></div><span>Page {currentPage} of {pageCount}</span></div>
      {!loading && !result.items.length && <EmptyState>No audit events match these filters. Try clearing one filter or widening the date range.</EmptyState>}
      <div className="audit-results">{result.items.map((entry) => { const showDetails = () => openDetail(auditEntryDetail(entry, data)); return <article className="audit-entry audit-entry--interactive" key={entry.auditId} role="button" tabIndex={0} onClick={showDetails} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); showDetails(); } }}>
        <div className="audit-entry__header"><div className="audit-entry__headline"><span className={`governance-timeline__actor governance-timeline__actor--${entry.actorType}`}>{entry.actorType === "user" ? <UserRound size={16} /> : entry.actorType === "device" ? <Smartphone size={16} /> : <ShieldCheck size={16} />}</span><div><strong>{auditActionSentence(entry)}</strong><span className="audit-entry__action">Select for the full record</span></div></div><div className="audit-entry__time"><strong>{relativeTime(entry.occurredAt)}</strong><time>{new Date(entry.occurredAt).toLocaleString()}</time></div></div>
        <div className="audit-entry__grid"><div><small>Actor</small><strong>{entry.actorDisplayName}</strong><span>{entry.actorUsername ? `@${entry.actorUsername}` : `${entry.actorType} event`}</span></div><div><small>Applies to</small><strong>{auditTargetLabel(entry)}</strong><span>Open details for evidence</span></div><div><small>Operating scope</small><strong>{auditLocationLabel(entry)}</strong><span>{auditLocationDescription(entry)}</span></div></div>
        {auditDetailSummary(entry.details) && <p className="audit-entry__summary">{auditDetailSummary(entry.details)}</p>}
      </article>; })}</div>
      <div className="audit-page__pagination"><button className="secondary" disabled={pageIndex === 0 || loading} onClick={() => setPageIndex((current) => Math.max(0, current - 1))}>Previous</button><span>{result.total ? `${result.offset + 1}–${Math.min(result.offset + result.items.length, result.total)} of ${result.total}` : "0 events"}</span><button className="secondary" disabled={loading || (pageIndex + 1) * result.limit >= result.total} onClick={() => setPageIndex((current) => current + 1)}>Next</button></div>
    </div>
  </section>;
}

function SettingsPage({ data, setPage, session, onRequestSignIn, onPasswordChanged, onSignOut }: { data: OperationsData; setPage: (page: Page) => void; session: AdminSession | null; onRequestSignIn: () => void; onPasswordChanged: () => void; onSignOut: () => Promise<void> }) {
  const settings = [
    { icon: UserRound, title: "Roles & approvals", text: "Operations Administrators can request corrections; Organization Owners approve them with dual control for material changes." },
    { icon: Smartphone, title: "Device provisioning", text: "Shared Android scanners receive their assigned operating location and availability from the administration service." },
    { icon: Cloud, title: "Integrations", text: "Production-system, Entra ID, and analytics connections are managed separately from scanner operations." }
  ];
  const actions = [
    { icon: Smartphone, title: "Manage scanner fleet", text: "Rename scanners, move assignments, review versions, and enable or disable access.", page: "devices" as Page },
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
        {actions.map((action) => <button className="settings-action-card" key={action.title} onClick={() => setPage(action.page)}><span className="settings-action-card__icon"><action.icon size={19} /></span><span><strong>{action.title}</strong><small>{action.text}</small></span><span className="settings-action-card__go">Open<ChevronRight size={15} /></span></button>)}
      </div>
    </section>
    <section className="location-governance panel">
      <PanelTitle title="Location access model" subtitle="A practical boundary between local operations and corporate governance." action="Open corrections" onClick={() => setPage("corrections")} />
      <div className="location-governance__intro"><span><ShieldCheck size={20} /></span><div><strong>Recommended for rollout: add scoped Location Managers.</strong><p>Managers at a store, Donation Xpress site, or warehouse should be able to keep work moving without silently changing the corporate record. Their changes should create a reasoned request that corporate administrators can review.</p></div><Pill tone="muted">Design ready</Pill></div>
      <div className="location-governance__roles"><article><span className="location-governance__role-icon"><MapPin size={17} /></span><div><h3>Location Manager</h3><p>Scoped to assigned locations. Can enable or disable local scanners, request a container correction, and record a reason for a local operational change.</p><small>Cannot add admins, change organization policy, approve their own material correction, or edit another location.</small></div><Pill tone="muted">Proposed</Pill></article><article><span className="location-governance__role-icon location-governance__role-icon--admin"><UserRound size={17} /></span><div><h3>Operations Administrator</h3><p>Network-wide operational control. Can manage scanners, triage exceptions, and request corrections across locations.</p><small>Should not approve material corrections when they are the requester.</small></div><Pill tone="good">Current</Pill></article><article><span className="location-governance__role-icon location-governance__role-icon--owner"><ShieldCheck size={17} /></span><div><h3>Organization Owner</h3><p>Corporate governance. Manages administrator access and approves, rejects, or reopens official-state corrections with a reason.</p><small>Use sparingly; keep at least two active owners for continuity and dual control.</small></div><Pill tone="blue">Current</Pill></article></div>
      <div className="location-governance__workflow"><span className="eyebrow">Accountable change path</span><div><span><b>1</b><strong>Local manager records what happened</strong><small>Location, scanner, container, and reason.</small></span><ArrowRight size={15} /><span><b>2</b><strong>Corporate queue receives the request</strong><small>Original scan evidence remains unchanged.</small></span><ArrowRight size={15} /><span><b>3</b><strong>Owner approves or rejects</strong><small>A separate decision and reason are audited.</small></span></div></div>
    </section>
    <section className="settings-reference panel">
      <PanelTitle title="Operating policies" subtitle="Reference only — these policies are enforced by the service and are not interactive settings." />
      <div className="settings-reference__grid">{settings.map((setting) => <article className="settings-reference__item" key={setting.title}><span className="settings-reference__icon"><setting.icon size={18} /></span><div><h3>{setting.title}</h3><p>{setting.text}</p></div><Pill tone="muted">Reference</Pill></article>)}</div>
    </section>
    {session && <AccountSecurity session={session} onPasswordChanged={onPasswordChanged} onSignOut={onSignOut} />}{session?.principal.role === "organization_owner" && <AdminDirectory session={session} />}</>;
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

function AdminDirectory({ session }: { session: AdminSession }) {
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
    <div className="admin-directory__users">{users?.map((user) => <ManagedAccountRow key={user.userId} user={user} currentUserId={session.principal.userId} busy={busy} onSave={save} onReset={resetPassword} />) ?? <div className="skeleton"/>}</div>
    {error && <div className="sign-in-error">{error}</div>}
    <form className="admin-user-form" onSubmit={(event) => void addUser(event)}><h3>Add administrator</h3><p>Use an Operations Administrator for normal data and scanner work. Only nominate another Organization Owner when they need full access governance.</p><div><label>Display name<input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><label>Username<input required pattern="[a-z0-9._-]{3,64}" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} /></label></div><div><label>Role<select value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="operations_administrator">Operations Administrator</option><option value="read_only_reviewer">Read-only Reviewer</option><option value="organization_owner">Organization Owner (full control)</option></select></label><label>Temporary password<input required minLength={12} type="password" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} /></label></div><button className="primary" disabled={busy}>{busy ? "Creating…" : "Add administrator"}</button></form>
  </section>;
}

function ManagedAccountRow({ user, currentUserId, busy, onSave, onReset }: { user: AdminPrincipal; currentUserId: string; busy: boolean; onSave: (userId: string, update: { displayName?: string; role?: "organization_owner" | "operations_administrator" | "read_only_reviewer"; isActive?: boolean }) => Promise<void>; onReset: (userId: string, temporaryPassword: string) => Promise<void> }) {
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

function DeviceCard({ device, data, operatingLocations, busy, canManage, onSave, onDetails }: { device: Device; data: OperationsData; operatingLocations: Location[]; busy: boolean; canManage: boolean; onSave: (device: Device, update: { label?: string; assignedLocationId?: string; isActive?: boolean; assignmentReason?: string }) => Promise<void>; onDetails: () => void }) {
  const [label, setLabel] = useState(device.label);
  const [assignedLocationId, setAssignedLocationId] = useState(device.assignedLocationId);
  const [reason, setReason] = useState("");
  useEffect(() => { setLabel(device.label); setAssignedLocationId(device.assignedLocationId); setReason(""); }, [device.label, device.assignedLocationId]);
  const location = data.fixtures.locations.find((item) => item.locationId === device.assignedLocationId);
  const events = data.events.filter((item) => item.deviceId === device.deviceId);
  const assignmentChanged = assignedLocationId !== device.assignedLocationId;
  const labelChanged = label.trim() !== device.label;
  const locked = busy || !canManage;
  return <article className="device-card"><div className="phone-icon"><Smartphone /></div><div className={`device-card__status ${device.isActive ? "" : "device-card__status--disabled"}`}><i /> {device.isActive ? "SCANNING ENABLED" : "SCANNING DISABLED"}</div><h2>{device.label}</h2><p><MapPin size={15} /> Assigned to {location?.name ?? "Unassigned"}</p>{!canManage && <div className="device-read-only">Read-only access: scanner controls are unavailable.</div>}<label className="device-location-control"><span>Scanner name</span><div className="device-name-input"><input value={label} onChange={(event) => setLabel(event.target.value)} disabled={locked} placeholder="Example: Scanner 1" /><button className="secondary" disabled={locked || !labelChanged || label.trim().length < 2} onClick={() => void onSave(device, { label: label.trim() })}>{busy ? "Saving…" : "Save name"}</button></div></label><dl><div><dt>Scanner ID</dt><dd className="device-id">{scannerNumber(device.deviceId)}</dd></div><div><dt>Availability</dt><dd>{device.isActive ? "Enabled" : "Disabled"}</dd></div><div><dt>StackTrack version</dt><dd>{device.reportedAppVersion ?? "Not reported"}</dd></div><div><dt>Observations</dt><dd>{events.length}</dd></div><div><dt>Last app report</dt><dd>{relativeTime(device.lastReportedAt)}</dd></div></dl><label className="device-location-control"><span>Move scanner to</span><select value={assignedLocationId} disabled={locked} onChange={(event) => setAssignedLocationId(event.target.value)}>{operatingLocations.map((option) => <option value={option.locationId} key={option.locationId}>{option.name}</option>)}</select></label>{assignmentChanged && <label className="device-location-control"><span>Reason (optional)</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Example: Scanner moved with the Midtown store team." disabled={locked} /></label>}{assignmentChanged && <button className="primary device-save-assignment" disabled={locked} onClick={() => void onSave(device, { assignedLocationId, ...(reason.trim() ? { assignmentReason: reason.trim() } : {}) })}>{busy ? "Saving…" : "Record scanner move"}</button>}<div className="device-card__actions"><button className={device.isActive ? "secondary" : "primary"} disabled={locked} onClick={() => void onSave(device, { isActive: !device.isActive })}>{busy ? "Saving…" : device.isActive ? "Disable scanner" : "Enable scanner"}</button><button className="secondary" onClick={onDetails}>Details <ChevronRight size={16} /></button></div></article>;
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
  return <article className={`exception-card ${isClosed ? "exception-card--closed" : ""}`}><div className="exception-card__icon"><AlertTriangle size={22} /></div><div className="exception-card__body"><div><Pill tone={isClosed ? "muted" : "warn"}>{reviewStatusLabel(reviewCase.status)}</Pill><span>{relativeTime(reviewCase.lastActionAt ?? reviewCase.openedAt)}</span></div><h2>{reviewCase.containerLabel} needs a review decision</h2><p>{reviewCase.reasonCode.replaceAll("_", " ")} · {projection?.conflicts.length ?? 0} current projection conflicts · {reviewCase.evidenceEventIds.length} preserved evidence event{reviewCase.evidenceEventIds.length === 1 ? "" : "s"}.</p><div className="evidence"><span><strong>{reviewCase.actionCount}</strong> recorded actions</span><span><strong>{projection?.appliedEventIds.length ?? 0}</strong> applied events</span><span><strong>{projection?.warnings.length ?? 0}</strong> timing warnings</span></div>{reviewCase.lastActionReason && <div className="review-last-action"><strong>Latest reason:</strong> {reviewCase.lastActionReason}</div>}{manages && <label className="review-reason"><span>Decision reason</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} placeholder="State what was verified and who should act next." /></label>}{error && <div className="sign-in-error">{error}</div>}</div><div className="exception-card__actions"><button className="secondary" onClick={onEvidence}>View evidence</button>{manages && !isClosed && <button className="secondary" disabled={busy || reason.trim().length < 8} onClick={() => void act("assigned")}>{busy ? "Recording…" : "Assign review"}</button>}{canResolve && !isClosed && <button className="primary" disabled={busy || reason.trim().length < 8} onClick={() => void act("resolved")}>{busy ? "Recording…" : "Resolve case"}</button>}{canResolve && isClosed && <button className="secondary" disabled={busy || reason.trim().length < 8} onClick={() => void act("reopened")}>{busy ? "Recording…" : "Reopen case"}</button>}</div></article>;
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
        ["Reason code", item.reasonCode],
        ["Current status", reviewStatusLabel(item.status)],
        ["Evidence events", String(item.evidenceEventIds.length)],
        ["Last decision", item.lastActionAt ? `${reviewStatusLabel(item.status)} · ${new Date(item.lastActionAt).toLocaleString()}` : "Not yet acted on"]
      ]}/>{item.lastActionReason && <div className="detail-callout"><ShieldCheck size={20}/><span><strong>Latest decision reason:</strong> {item.lastActionReason}</span></div>}<h3 className="detail-section-title">Immutable event evidence</h3><EventEvidence events={data.events.filter((event) => item.evidenceEventIds.includes(event.eventId) || event.containerId === item.containerId)} data={data}/></>
    })} />)}
  </section>;
}
