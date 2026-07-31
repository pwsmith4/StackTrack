import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Boxes,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Cloud,
  Container as ContainerIcon,
  Download,
  ExternalLink,
  FileClock,
  HandHeart,
  LayoutDashboard,
  MapPin,
  Menu,
  MonitorSmartphone,
  PackageCheck,
  RefreshCw,
  Search,
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
  createAdminUser,
  listAdminUsers,
  loadOperationsData,
  reviewCaseAction,
  revokeAdminSession,
  signIn,
  updateAdminUser,
  updateDevice,
  type AdminPrincipal,
  type AdminSession,
  type AuditEntry,
  type Container,
  type Device,
  type DeviceAssignment,
  type Fixtures,
  type Location,
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
  | "activity"
  | "devices"
  | "reports"
  | "settings";

interface OperationsData {
  fixtures: Fixtures;
  events: StoredEvent[];
  reviewCases: ReviewCase[];
  auditEntries: AuditEntry[];
  projections: Record<string, Projection | null>;
}

interface DetailView {
  readonly eyebrow: string;
  readonly title: string;
  readonly body: ReactNode;
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
    eyebrow: "Accuracy center",
    title: "Needs review",
    description: "Contradictory or unusual observations remain visible until resolved."
  },
  activity: {
    eyebrow: "Append-only ledger",
    title: "Activity",
    description: "Every observation, in the order StackTrack received it."
  },
  devices: {
    eyebrow: "Field hardware",
    title: "Devices",
    description: "Shared scanners are locked to a location and individually traceable."
  },
  reports: {
    eyebrow: "Operations intelligence",
    title: "Reports & data",
    description: "A home for exports, trends, and the future Microsoft data integration."
  },
  settings: {
    eyebrow: "Configuration",
    title: "Settings",
    description: "Prototype policies and environment connections."
  }
};

const nav: { page: Page; label: string; icon: typeof Boxes }[] = [
  { page: "dashboard", label: "Overview", icon: LayoutDashboard },
  { page: "containers", label: "Containers", icon: ContainerIcon },
  { page: "loads", label: "Load codes", icon: PackageCheck },
  { page: "locations", label: "Locations", icon: MapPin },
  { page: "exceptions", label: "Needs review", icon: AlertTriangle },
  { page: "activity", label: "Activity", icon: FileClock },
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

function Pill({ tone, children }: { tone: "good" | "warn" | "blue" | "muted"; children: ReactNode }) {
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

function DetailDrawer({ detail, onClose }: { detail: DetailView; onClose: () => void }) {
  return (
    <>
      <button className="detail-scrim" onClick={onClose} aria-label="Close details" />
      <aside className="detail-drawer" role="dialog" aria-modal="true" aria-label={detail.title}>
        <div className="detail-drawer__header">
          <div><span className="eyebrow">{detail.eyebrow}</span><h2>{detail.title}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close details"><X size={18} /></button>
        </div>
        <div className="detail-drawer__body">{detail.body}</div>
      </aside>
    </>
  );
}

function DetailFacts({ items }: { items: readonly [string, ReactNode][] }) {
  return <dl className="detail-facts">{items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function EventEvidence({ events, data }: { events: StoredEvent[]; data: OperationsData }) {
  const locationName = (id: string) => data.fixtures.locations.find((item) => item.locationId === id)?.name ?? "Unknown";
  return <div className="detail-events">{events.length ? events.map((event) => <article key={event.eventId}>
    <div><Pill tone={event.accuracyFlags.length ? "warn" : "blue"}>{eventLabel(event.eventType)}</Pill><time>{new Date(event.eventAt).toLocaleString()}</time></div>
    <strong>{locationName(event.locationId)}</strong>
    <span>{event.eventId}</span>
    <small>{event.accuracyFlags.length ? event.accuracyFlags.join(" · ") : "Timing and device order verified"}</small>
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
            title: "Goodwill Local simulation",
            body: <><p className="detail-lead">This organization is the isolated PostgreSQL pilot tenant. Future production environments will appear here after Entra authentication and tenant provisioning are configured.</p><DetailFacts items={[["Tenant", data?.fixtures.tenant.name ?? "Goodwill Local"], ["Environment", "Local development"], ["Database", "PostgreSQL 16"], ["Authentication", "Development headers"]]}/></>
          })}>
            <span className="site-dot">M</span>
            <span><strong>Goodwill Local</strong><small>Pilot environment</small></span>
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
            </button>
          ))}
        </nav>
        <div className="sidebar__bottom">
          <button onClick={() => setPage("settings")} className={page === "settings" ? "active" : ""}>
            <Settings size={19} /><span>Settings</span>
          </button>
          <a href="http://127.0.0.1:8082" target="_blank" rel="noreferrer">
            <MonitorSmartphone size={19} /><span>Open mobile preview</span><ExternalLink size={14} />
          </a>
          <button className="user-card" onClick={() => session ? setDetail({
            eyebrow: "Signed-in profile", title: session.principal.displayName,
            body: <><p className="detail-lead">This session is verified by the StackTrack API and expires automatically after twelve hours. Signing out revokes this browser session on the server.</p><DetailFacts items={[["Username", session.principal.username], ["Role", roleLabel(session.principal.role)], ["Scope", "Goodwill Local pilot tenant"], ["Session expires", new Date(session.expiresAt).toLocaleString()]]}/><button className="secondary" onClick={() => void signOut()}>Sign out</button></>
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
            <span className={`connection ${error ? "connection--error" : ""}`}>
              <i /> {error ? "API disconnected" : API_URL.includes("127.0.0.1") || API_URL.includes("localhost") ? "Local API connected" : "Azure test API connected"}
            </span>
            <button className="icon-button" onClick={() => void refresh()} aria-label="Refresh data">
              <RefreshCw size={18} className={loading ? "spin" : ""} />
            </button>
            <button className="icon-button" aria-label="Help" onClick={() => setDetail({
              eyebrow: "StackTrack help",
              title: "Using the local operations console",
              body: <><p className="detail-lead">Search for a container or load code, use the left navigation for operational views, and open any record for its immutable evidence history.</p><div className="help-steps"><span><b>1</b> Scan in the mobile app</span><span><b>2</b> Refresh the console</span><span><b>3</b> Review state and evidence</span><span><b>4</b> Export validated records</span></div><div className="detail-callout"><ShieldCheck size={20}/><span>Corrections never delete the original scan. Production approval actions remain disabled until identity and authority rules are confirmed.</span></div></>
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
                  placeholder={page === "devices" ? "Search scanner ID or location" : "Search label or code"}
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
              <span><strong>The test API could not be reached.</strong> Expected at {API_URL}. The interface remains available for review.</span>
              <button onClick={() => void refresh()}>Try again</button>
            </div>
          )}

          {loading && !data ? (
            <div className="loading-grid">{[1, 2, 3, 4].map((item) => <div key={item} className="skeleton" />)}</div>
          ) : data ? (
            <PageContent page={page} data={data} query={query} setPage={setPage} openDetail={setDetail} refresh={refresh} session={session} onRequestSignIn={() => setSignInOpen(true)} onPasswordChanged={markPasswordChanged} onSignOut={signOut} />
          ) : <div className="loading-grid">{[1, 2, 3, 4].map((item) => <div key={item} className="skeleton" />)}</div>}
        </div>
        <footer>
          <span><ShieldCheck size={15} /> Pilot test environment • append-only audit foundation</span>
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
  return <section className="sign-in-dialog" role="dialog" aria-modal="true" aria-label="Administrator sign in"><ShieldCheck size={28}/><span className="eyebrow">SECURE PILOT ACCESS</span><h2>Sign in to view operations.</h2><p>Container, route, device, and report data stays unavailable until the StackTrack API verifies an approved account.</p><form onSubmit={(event) => void submit(event)}><label>Username<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <div className="sign-in-error">{error}</div>}<button className="primary" disabled={busy || !username.trim() || !password} type="submit">{busy ? "Signing in…" : "Sign in"}</button></form><small>Production will use Goodwill Microsoft Entra sign-in. This password route is for the isolated test pilot only.</small></section>;
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
  if (page === "containers") return <ContainersPage data={data} query={query} openDetail={openDetail} />;
  if (page === "loads") return <LoadsPage data={data} query={query} openDetail={openDetail} />;
  if (page === "locations") return <LocationsPage data={data} openDetail={openDetail} />;
  if (page === "exceptions") return <ExceptionsPage data={data} openDetail={openDetail} session={session!} refresh={refresh} />;
  if (page === "activity") return <ActivityPage data={data} query={query} openDetail={openDetail} />;
  if (page === "devices") return <DevicesPage data={data} query={query} openDetail={openDetail} refresh={refresh} session={session} onRequestSignIn={onRequestSignIn} />;
  if (page === "reports") return <ReportsPage data={data} openDetail={openDetail} />;
  return <SettingsPage data={data} openDetail={openDetail} session={session} onRequestSignIn={onRequestSignIn} onPasswordChanged={onPasswordChanged} onSignOut={onSignOut} />;
}

function Dashboard({ data, setPage }: { data: OperationsData; setPage: (page: Page) => void }) {
  const projections = Object.values(data.projections).filter(Boolean) as Projection[];
  const loaded = projections.filter((item) => item.loadState === "loaded").length;
  const transitId = data.fixtures.locations.find((item) => item.type === "in_transit")?.locationId;
  const inTransit = projections.filter((item) => item.locationId === transitId).length;
  const review = projections.filter((item) => item.health === "needs_review").length;
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

  return (
    <>
      <div className="metric-grid">
        <Metric icon={<ContainerIcon />} label="Tracked containers" value={data.fixtures.containers.length} detail="Across 4 location types" tone="blue" />
        <Metric icon={<PackageCheck />} label="Currently loaded" value={loaded} detail={`${Math.round((loaded / data.fixtures.containers.length) * 100)}% of tracked assets`} tone="cyan" />
        <Metric icon={<Truck />} label="In transit" value={inTransit} detail="Latest valid observation" tone="navy" />
        <Metric icon={<AlertTriangle />} label="Needs review" value={review} detail={review ? "Manager attention needed" : "No open exceptions"} tone={review ? "orange" : "green"} />
      </div>

      <div className="dashboard-grid">
        <section className="panel network-panel">
          <PanelTitle title="Pilot route flow" subtitle="Live movement on a representative store-to-warehouse route" action="View all locations" onClick={() => setPage("locations")} />
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
          <div className="accuracy-note">
            <ShieldCheck size={22} />
            <div><strong>Accuracy-first state</strong><span>StackTrack never erases conflicting scans. It applies the latest valid event and keeps contradictory evidence for review.</span></div>
          </div>
        </section>

        <section className="panel review-panel">
          <PanelTitle title="Attention center" subtitle="Items that could change the official state" action="Open queue" onClick={() => setPage("exceptions")} />
          {review === 0 ? <EmptyState>All container histories are internally consistent.</EmptyState> : (
            projections.filter((item) => item.health === "needs_review").map((item) => {
              const c = container(item.containerId);
              return (
                <button className="review-item" key={item.containerId} onClick={() => setPage("exceptions")}>
                  <span className="review-item__icon"><AlertTriangle size={19} /></span>
                  <span><strong>{c?.label}</strong><small>{item.conflicts[0]?.reason.replace(/([A-Z])/g, " $1").trim()}</small></span>
                  <Pill tone="warn">Review</Pill>
                  <ChevronRight size={17} />
                </button>
              );
            })
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

function ContainersPage({ data, query, openDetail }: { data: OperationsData; query: string; openDetail: OpenDetail }) {
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
    openDetail({
      eyebrow: `${container.type} record`,
      title: container.label,
      body: <><DetailFacts items={[
        ["Current state", projection?.loadState ?? "Not observed"],
        ["Last known location", locationName(projection?.locationId ?? null)],
        ["History health", projection?.health ?? "No history"],
        ["Container UUID", container.containerId]
      ]}/><h3 className="detail-section-title">Immutable observation history</h3><EventEvidence events={data.events.filter((event) => event.containerId === container.containerId)} data={data}/></>
    });
  };
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
      <div className="table-wrap">
        <table>
          <thead><tr><th>Asset label</th><th>Container type</th><th>Current state</th><th>Last known location</th><th>Last observed</th><th>History health</th></tr></thead>
          <tbody>{visibleRows.map((container) => {
            const projection = data.projections[container.containerId];
            return <tr className="clickable-row" key={container.containerId} onClick={() => showContainer(container)}>
              <td><strong className="asset-label">{container.label}</strong><small>{container.containerId.slice(0, 13)}…</small></td>
              <td className="capitalize">{container.type}</td>
              <td><Pill tone={projection?.loadState === "loaded" ? "blue" : "muted"}>{projection?.loadState ?? "Not observed"}</Pill></td>
              <td>{locationName(projection?.locationId ?? null)}</td>
              <td>{relativeTime(projection?.lastObservedAt)}</td>
              <td>{projection?.health === "needs_review" ? <Pill tone="warn">Needs review</Pill> : projection ? <Pill tone="good">Clean</Pill> : <Pill tone="muted">No history</Pill>}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <div className="pagination"><span>Showing {rows.length ? pageIndex * pageSize + 1 : 0}–{Math.min(rows.length, (pageIndex + 1) * pageSize)} of {rows.length}</span><div><button disabled={pageIndex === 0} onClick={() => setPageIndex((current) => current - 1)}>Previous</button><b>Page {pageIndex + 1} of {pageCount}</b><button disabled={pageIndex + 1 >= pageCount} onClick={() => setPageIndex((current) => current + 1)}>Next</button></div></div>
    </section>
  );
}

function LoadsPage({ data, query, openDetail }: { data: OperationsData; query: string; openDetail: OpenDetail }) {
  const [filter, setFilter] = useState<"available" | "used" | "previous">("available");
  const [pageIndex, setPageIndex] = useState(0);
  const pageSize = 12;
  useEffect(() => setPageIndex(0), [query]);
  const allLoads = data.events.filter((event) => event.eventType === "load_assigned").filter((event) => {
    const code = String(event.payload.displayLoadCode ?? "");
    return code.toLowerCase().includes(query.toLowerCase());
  });
  const isToday = (value: string) => new Date(value).toDateString() === new Date().toDateString();
  const isActive = (event: StoredEvent) => data.projections[event.containerId]?.activeLoadCodeId === event.loadCodeId;
  const loads = allLoads.filter((event) =>
    filter === "available" ? isActive(event) : filter === "used" ? !isActive(event) : !isToday(event.eventAt)
  );
  const pageCount = Math.max(1, Math.ceil(loads.length / pageSize));
  const visibleLoads = loads.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize);
  const containerName = (id: string) => data.fixtures.containers.find((item) => item.containerId === id)?.label;
  const locationName = (id: string) => data.fixtures.locations.find((item) => item.locationId === id)?.name;
  const exportLoads = () => downloadCsv("stacktrack-load-codes.csv", [
    ["Load code", "Container", "Location", "Goods type", "Classification", "Created at"],
    ...loads.map((event) => [
      String(event.payload.displayLoadCode ?? event.loadCodeId ?? ""),
      containerName(event.containerId) ?? "",
      locationName(event.locationId) ?? "",
      String(event.payload.goodsType ?? ""),
      String(event.payload.secondaryValue ?? ""),
      event.eventAt
    ])
  ]);
  const today = new Date().toLocaleDateString([], { month: "short", day: "numeric" });
  return (
    <>
      <div className="notice-banner"><CheckCircle2 size={22} /><div><strong>Validated list for today</strong><span>Managers can use these codes in the production system. Codes come directly from accepted “mark full” observations.</span></div><button className="primary" onClick={exportLoads}><Download size={16} /> Download list</button></div>
      <section className="panel">
        <div className="toolbar"><div className="filter-tabs"><button className={filter === "available" ? "active" : ""} onClick={() => { setFilter("available"); setPageIndex(0); }}>Available <b>{allLoads.filter(isActive).length}</b></button><button className={filter === "used" ? "active" : ""} onClick={() => { setFilter("used"); setPageIndex(0); }}>Used <b>{allLoads.filter((event) => !isActive(event)).length}</b></button><button className={filter === "previous" ? "active" : ""} onClick={() => { setFilter("previous"); setPageIndex(0); }}>Previous days</button></div><span className="date-chip"><Clock3 size={15} /> Today, {today}</span></div>
        <div className="load-grid">{visibleLoads.map((event) => (
          <article className="load-card" key={event.eventId}>
            <div className="load-card__top"><span>LOAD CODE</span><Pill tone="good">Validated</Pill></div>
            <strong>{String(event.payload.displayLoadCode ?? event.loadCodeId?.slice(0, 8))}</strong>
            <div className="load-card__details"><span><ContainerIcon size={15} /> {containerName(event.containerId)}</span><span><MapPin size={15} /> {locationName(event.locationId)}</span><span><Boxes size={15} /> {String(event.payload.goodsType ?? "Not set")} · {String(event.payload.secondaryValue ?? "Not set")}</span></div>
            <div className="load-card__bottom"><span>Created {relativeTime(event.eventAt)}</span><button onClick={() => openDetail({
              eyebrow: "Load code history",
              title: String(event.payload.displayLoadCode ?? event.loadCodeId),
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

function LocationsPage({ data, openDetail }: { data: OperationsData; openDetail: OpenDetail }) {
  const physicalLocations = data.fixtures.locations.filter((location) => location.type !== "in_transit");
  const [selectedLocationId, setSelectedLocationId] = useState(physicalLocations[0]?.locationId ?? "");
  const [locationQuery, setLocationQuery] = useState("");
  const selected = physicalLocations.find((location) => location.locationId === selectedLocationId) ?? physicalLocations[0];
  if (!selected) return <EmptyState>No pilot locations are available.</EmptyState>;

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
    const originEvent = departure ? events.find((event) => event.eventId !== departure.eventId && event.locationId !== transitId) : undefined;
    const origin = originEvent ? data.fixtures.locations.find((item) => item.locationId === originEvent.locationId) : undefined;
    return { destination, origin, departure };
  };
  const projections = Object.values(data.projections).filter(Boolean) as Projection[];
  const matchingLocations = physicalLocations.filter((location) =>
    `${location.name} ${location.type.replaceAll("_", " ")}`.toLowerCase().includes(locationQuery.trim().toLowerCase())
  );
  const current = projections.filter((projection) => projection.locationId === selected.locationId);
  const moving = projections.filter((projection) => projection.locationId === transitId);
  const arriving = moving.filter((projection) => routeFor(projection).destination?.locationId === selected.locationId);
  const leaving = moving.filter((projection) => routeFor(projection).origin?.locationId === selected.locationId);
  const openContainer = (projection: Projection) => openDetail({
    eyebrow: "Pilot route container",
    title: container(projection.containerId)?.label ?? "Tracked container",
    body: <><DetailFacts items={[
      ["Current state", projection.loadState],
      ["Official location", data.fixtures.locations.find((item) => item.locationId === projection.locationId)?.name ?? "Not observed"],
      ["History health", projection.health],
      ["Last observed", relativeTime(projection.lastObservedAt)]
    ]}/><h3 className="detail-section-title">Immutable observation history</h3><EventEvidence events={eventsFor(projection.containerId)} data={data}/></>
  });

  return <>
    <section className="location-selector panel">
      <div className="location-selector__heading"><PanelTitle title="Pilot locations" subtitle="Choose one operating location to see its current and planned container involvement." /><label className="location-search"><Search size={17} /><input value={locationQuery} onChange={(event) => setLocationQuery(event.target.value)} placeholder="Search locations" aria-label="Search locations" /></label></div>
      <div className="location-selector__list">{matchingLocations.map((location) => {
        const count = projections.filter((projection) => projection.locationId === location.locationId).length;
        return <button key={location.locationId} className={location.locationId === selected.locationId ? "active" : ""} onClick={() => setSelectedLocationId(location.locationId)}><span className={`location-type-icon location-type-icon--${location.type}`}><LocationTypeIcon location={location} /></span><span><b>{location.name}</b><small>{location.type === "donation_express" ? "Donation Xpress" : location.type === "warehouse" ? "Warehouse" : "Store"} · {count} currently here</small></span><ChevronRight size={17} /></button>;
      })}{matchingLocations.length === 0 && <div className="location-selector__empty">No locations match “{locationQuery}”.</div>}</div>
    </section>

    <section className="location-workspace panel">
      <div className="location-workspace__head">
        <div><span className="eyebrow">Selected operating location</span><h2><span className={`location-title-icon location-title-icon--${selected.type}`}><LocationTypeIcon location={selected} size={20} /></span>{selected.name}</h2><p>One place to review containers physically here, inbound, and outbound without mixing simultaneous routes together.</p></div>
        <div className="location-workspace__counts"><span><b>{current.length}</b> here</span><span><b>{arriving.length}</b> arriving</span><span><b>{leaving.length}</b> leaving</span></div>
      </div>
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

function ActivityPage({ data, query, openDetail }: { data: OperationsData; query: string; openDetail: OpenDetail }) {
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
      title: `${c(event.containerId)?.label} · ${eventLabel(event.eventType)}`,
      body: <><DetailFacts items={[
        ["Observed at", new Date(event.eventAt).toLocaleString()],
        ["Received at", new Date(event.receivedAt).toLocaleString()],
        ["Location", l(event.locationId) ?? "Unknown"],
        ["Event UUID", event.eventId]
      ]}/><h3 className="detail-section-title">Accuracy evidence</h3><p className="detail-lead">{event.accuracyFlags.length ? event.accuracyFlags.join(" · ") : "No timing, ordering, or reference-data warnings were recorded."}</p></>
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
    <div className="device-guidance"><ShieldCheck size={20} /><span><strong>Scanner control is an accountable action.</strong> The app reports its installed version; assignments and scanner-name changes become permanent history, with an optional move note.</span></div>
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
  return { eyebrow: "Shared scanner", title: device.label, body: <><DetailFacts items={[["Scanner ID", scannerNumber(device.deviceId)], ["Technical installation ID", device.installationId], ["Assigned location", locationName(device.assignedLocationId)], ["Scanning enabled", device.isActive ? "Yes" : "No"], ["Installed StackTrack version", device.reportedAppVersion ?? "Not reported by this device yet"], ["Last app report", relativeTime(device.lastReportedAt)]]}/><h3 className="detail-section-title">Assignment history</h3>{history.length ? <div className="assignment-history">{history.map((entry: DeviceAssignment) => <article key={entry.assignmentHistoryId}><time>{new Date(entry.occurredAt).toLocaleString()}</time><strong>{locationName(entry.previousLocationId)} <ArrowRight size={14} /> {locationName(entry.assignedLocationId)}</strong><span>{entry.reason}</span><small>Preserved in the device audit history</small></article>)}</div> : <EmptyState>No location reassignment has been recorded yet.</EmptyState>}<h3 className="detail-section-title">Latest scanner activity</h3><EventEvidence events={events.slice(0, 12)} data={data}/></> };
  /* Legacy required-version policy controls intentionally removed from the pilot UI.
  const requiredAppVersion = device.requiredAppVersion ?? "";
  const updateNeeded = versionIsOlder(device.reportedAppVersion, requiredAppVersion);
  return { eyebrow: "Shared scanner", title: device.label, body: <><DetailFacts items={[["Assigned location", locationName(device.assignedLocationId)], ["Scanning enabled", device.isActive ? "Yes" : "No"], ["Pending offline scans", device.pendingOfflineScanCount], ["Installed / required", `${device.reportedAppVersion ?? "Not reported"} / ${requiredAppVersion || "Not set"}${updateNeeded ? " — update required" : ""}`], ["Last app report", relativeTime(device.lastReportedAt)], ["Installation UUID", device.installationId]]}/><h3 className="detail-section-title">Assignment history</h3>{history.length ? <div className="assignment-history">{history.map((entry: DeviceAssignment) => <article key={entry.assignmentHistoryId}><time>{new Date(entry.occurredAt).toLocaleString()}</time><strong>{locationName(entry.previousLocationId)} <ArrowRight size={14} /> {locationName(entry.assignedLocationId)}</strong><span>{entry.reason}</span><small>Preserved in the device audit history</small></article>)}</div> : <EmptyState>No location reassignment has been recorded yet.</EmptyState>}<h3 className="detail-section-title">Latest scanner activity</h3><EventEvidence events={events.slice(0, 12)} data={data}/></> };
}

*/
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
  /* Legacy required-version controls intentionally removed from the pilot UI.
  const versionChanged = requiredVersion.trim() !== requiredAppVersion;
  const updateNeeded = versionIsOlder(device.reportedAppVersion, requiredAppVersion);
  return <article className="device-card"><div className="phone-icon"><Smartphone /></div><div className={`device-card__status ${device.isActive ? "" : "device-card__status--disabled"}`}><i /> {device.isActive ? "SCANNING ENABLED" : "SCANNING DISABLED"}</div><h2>{device.label}</h2><p><MapPin size={15} /> Assigned to {location?.name}</p>{updateNeeded && <div className="device-update-warning"><AlertTriangle size={16} /><span>Update required: {device.reportedAppVersion ?? "not reported"} → {requiredAppVersion}</span></div>}<dl><div><dt>Availability</dt><dd>{device.isActive ? "Enabled" : "Disabled"}</dd></div><div><dt>Installed app</dt><dd>{device.reportedAppVersion ?? "Not reported"}</dd></div><div><dt>Required app</dt><dd>{requiredAppVersion || "Not set"}</dd></div><div><dt>Queued scans</dt><dd>{device.pendingOfflineScanCount ?? 0}</dd></div><div><dt>Observations</dt><dd>{events.length}</dd></div><div><dt>Last app report</dt><dd>{relativeTime(device.lastReportedAt)}</dd></div></dl><label className="device-location-control"><span>Move scanner to</span><select value={assignedLocationId} disabled={busy} onChange={(event) => setAssignedLocationId(event.target.value)}>{operatingLocations.map((option) => <option value={option.locationId} key={option.locationId}>{option.name}</option>)}</select></label>{assignmentChanged && <label className="device-location-control"><span>Required reason</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Example: Scanner moved with the Midtown store team." disabled={busy} /></label>}{assignmentChanged && <button className="primary device-save-assignment" disabled={busy || reason.trim().length < 5} onClick={() => void onSave(device, { assignedLocationId, assignmentReason: reason.trim() })}>{busy ? "Saving…" : "Record scanner move"}</button>}<label className="device-location-control"><span>Required app version</span><div className="device-version-input"><input value={requiredVersion} onChange={(event) => setRequiredVersion(event.target.value)} disabled={busy} /><button className="secondary" disabled={busy || !versionChanged || !requiredVersion.trim()} onClick={() => void onSave(device, { requiredAppVersion: requiredVersion.trim() })}>Require</button></div></label><div className="device-card__actions"><button className={device.isActive ? "secondary" : "primary"} disabled={busy} onClick={() => void onSave(device, { isActive: !device.isActive })}>{busy ? "Saving…" : device.isActive ? "Disable scanner" : "Enable scanner"}</button><button className="secondary" onClick={onDetails}>Details <ChevronRight size={16} /></button></div></article>;
}

*/
}

function ReportsPage({ data, openDetail }: { data: OperationsData; openDetail: OpenDetail }) {
  const reports = [
    { id: "movement", icon: Activity, title: "Container movement", text: "Accepted observations by location and day.", tag: "Ready" },
    { id: "loads", icon: PackageCheck, title: "Daily load codes", text: "Validated codes for production entry.", tag: "Ready" },
    { id: "exceptions", icon: AlertTriangle, title: "Exception history", text: "Corrections, approvals, and preserved evidence.", tag: "Ready" },
    { id: "lake", icon: Cloud, title: "Microsoft data lake export", text: "Scheduled analytics feed for Fabric or Azure.", tag: "Planned" }
  ];
  const openReport = (report: typeof reports[number]) => {
    if (report.id === "movement") {
      downloadCsv("stacktrack-container-movement.csv", [["Event", "Container", "Observation", "Location", "Observed at", "Warnings"], ...data.events.map((event) => [
        event.eventId,
        data.fixtures.containers.find((item) => item.containerId === event.containerId)?.label ?? "",
        eventLabel(event.eventType),
        data.fixtures.locations.find((item) => item.locationId === event.locationId)?.name ?? "",
        event.eventAt,
        event.accuracyFlags.join("; ")
      ])]);
      return;
    }
    if (report.id === "loads") {
      downloadCsv("stacktrack-daily-load-codes.csv", [["Load code", "Container", "Created at"], ...data.events.filter((event) => event.eventType === "load_assigned").map((event) => [
        String(event.payload.displayLoadCode ?? event.loadCodeId ?? ""),
        data.fixtures.containers.find((item) => item.containerId === event.containerId)?.label ?? "",
        event.eventAt
      ])]);
      return;
    }
    if (report.id === "exceptions") {
      downloadCsv("stacktrack-exception-history.csv", [["Container", "Health", "Conflicts", "Warnings"], ...Object.values(data.projections).filter(Boolean).map((projection) => [
        data.fixtures.containers.find((item) => item.containerId === projection!.containerId)?.label ?? "",
        projection!.health,
        projection!.conflicts.map((item) => item.reason).join("; "),
        projection!.warnings.join("; ")
      ])]);
      return;
    }
    openDetail({
      eyebrow: "Planned integration",
      title: "Microsoft analytics export",
      body: <><p className="detail-lead">The operational PostgreSQL database remains the source of truth. A future scheduled pipeline can copy reporting data into Microsoft Fabric or Azure Data Lake without putting scanner writes directly into the lake.</p><DetailFacts items={[
        ["Source", "Azure Database for PostgreSQL"],
        ["Destination", "Microsoft Fabric Lakehouse or ADLS Gen2"],
        ["Pattern", "Incremental append-only export"],
        ["Status", "Awaiting Goodwill Microsoft architecture decisions"]
      ]}/></>
    });
  };
  return <>
    <div className="report-grid">{reports.map((report) => <article className="report-card" key={report.title}><span><report.icon /></span><Pill tone={report.tag === "Ready" ? "good" : "muted"}>{report.tag}</Pill><h2>{report.title}</h2><p>{report.text}</p><button onClick={() => openReport(report)}>{report.tag === "Ready" ? "Download CSV" : "View plan"} <ArrowRight size={16} /></button></article>)}</div>
    <section className="panel data-health"><PanelTitle title="Data health" subtitle="Quality signals across the local pilot dataset" /><div className="health-bar"><span style={{ width: `${Math.max(15, 100 - data.events.filter((item) => item.accuracyFlags.length).length * 5)}%` }} /></div><div className="health-stats"><span><b>{data.events.length}</b> ledger events</span><span><b>{data.events.filter((item) => item.accuracyFlags.length === 0).length}</b> timing verified</span><span><b>{Object.values(data.projections).filter((item) => item?.health === "needs_review").length}</b> open exceptions</span></div></section>
  </>;
}

function SettingsPage({ data, openDetail, session, onRequestSignIn, onPasswordChanged, onSignOut }: { data: OperationsData; openDetail: OpenDetail; session: AdminSession | null; onRequestSignIn: () => void; onPasswordChanged: () => void; onSignOut: () => Promise<void> }) {
  const settings = [
    { icon: UserRound, title: "Roles & approvals", text: "Store managers handle routine corrections; corporate data stewards approve material state changes.", details: [["Store manager", "Request routine corrections"], ["Corporate steward", "Approve material state changes"], ["Status", "Policy draft — needs Goodwill approval"]] as [string, string][] },
    { icon: Smartphone, title: "Device provisioning", text: "Shared Android scanners remain locked to an assigned operating location.", details: [["Identity", "One installation UUID per physical device"], ["Assignment", "Exactly one operating location"], ["Status", "Local shared-device simulation active"]] as [string, string][] },
    { icon: Wifi, title: "Offline behavior", text: "Scans queue locally, preserve device order, and synchronize when connectivity returns.", details: [["Local queue", "AsyncStorage on the scanner"], ["Ordering", "Device installation + monotonic sequence"], ["Conflict handling", "Accept evidence and flag review"]] as [string, string][] },
    { icon: Cloud, title: "Integrations", text: "Production system, Entra ID, and analytics connections are placeholders in this local build.", details: [["Production system API", "Pending access"], ["Microsoft Entra ID", "Pending tenant details"], ["Analytics", "Fabric / Data Lake decision pending"]] as [string, string][] }
  ];
  return <><section className="settings-list"><article className="access-settings"><span><ShieldCheck /></span><div><h2>Administrator access</h2><p>{session ? `${session.principal.displayName} is signed in as ${roleLabel(session.principal.role)}. Organization Owners can add daily administrators from this console.` : "Operational changes are protected by a server-side pilot account. Sign in to manage scanners and administrator accounts."}</p></div><button className="secondary" onClick={onRequestSignIn}>{session ? "Manage access" : "Sign in"}</button></article>{settings.map((setting) => <article key={setting.title}><span><setting.icon /></span><div><h2>{setting.title}</h2><p>{setting.text}</p></div><button aria-label={`Open ${setting.title}`} onClick={() => openDetail({
    eyebrow: "Configuration",
    title: setting.title,
    body: <><p className="detail-lead">{setting.text}</p><DetailFacts items={setting.details}/></>
  })}><ChevronRight /></button></article>)}</section>{session && <AccountSecurity session={session} onPasswordChanged={onPasswordChanged} onSignOut={onSignOut} />}{session && <GovernanceTimeline entries={data.auditEntries} />}{session?.principal.role === "organization_owner" && <AdminDirectory session={session} />}</>;
}

function GovernanceTimeline({ entries }: { entries: AuditEntry[] }) {
  const actionLabel = (action: string) => action.replace(/^admin\.|^device\.|^review\./, "").replaceAll("_", " ").replaceAll(".", " ");
  return <section className="governance-timeline"><PanelTitle title="Governance timeline" subtitle="Recent system, scanner, access, and review actions. This is an operational view of the append-only audit log." />{entries.length ? <div className="governance-timeline__list">{entries.slice(0, 20).map((entry) => <article key={entry.auditId}><span className={`governance-timeline__actor governance-timeline__actor--${entry.actorType}`}>{entry.actorType === "user" ? <UserRound size={16} /> : entry.actorType === "device" ? <Smartphone size={16} /> : <ShieldCheck size={16} />}</span><div><strong>{actionLabel(entry.action)}</strong><p>{entry.actorDisplayName} · {entry.targetType.replaceAll("_", " ")}</p>{typeof entry.details.assignmentReason === "string" && <small>Move note: {entry.details.assignmentReason}</small>}{typeof entry.details.reason === "string" && <small>Reason: {entry.details.reason}</small>}</div><time>{relativeTime(entry.occurredAt)}</time></article>)}</div> : <EmptyState>No governed actions have been recorded in this test tenant yet.</EmptyState>}</section>;
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
  return <section className="admin-directory"><PanelTitle title="Administrator directory" subtitle="Organization Owners control who can manage the pilot." /><div className="admin-directory__users">{users?.map((user) => <article key={user.userId}><span className="avatar">{initials(user.displayName)}</span><div><strong>{user.displayName}</strong><small>@{user.username}</small></div><Pill tone={user.role === "organization_owner" ? "blue" : user.role === "operations_administrator" ? "good" : "muted"}>{roleLabel(user.role)}</Pill></article>) ?? <div className="skeleton"/>}</div><form className="admin-user-form" onSubmit={(event) => void submit(event)}><h3>Add administrator</h3><p>New accounts must change their temporary password before production use.</p><div><label>Display name<input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><label>Username<input required pattern="[a-z0-9._-]{3,64}" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} /></label></div><div><label>Role<select value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="operations_administrator">Operations Administrator</option><option value="read_only_reviewer">Read-only Reviewer</option></select></label><label>Temporary password<input required minLength={12} type="password" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} /></label></div>{error && <div className="sign-in-error">{error}</div>}<button className="primary" disabled={busy}>{busy ? "Creating…" : "Add administrator"}</button></form></section>;
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
  return <section className="admin-directory"><PanelTitle title="Administrator directory" subtitle="Organization Owners govern pilot access. Role changes and disabled accounts immediately invalidate the affected person’s active browser sessions." />
    <div className="admin-directory__users">{users?.map((user) => <ManagedAccountRow key={user.userId} user={user} currentUserId={session.principal.userId} busy={busy} onSave={save} />) ?? <div className="skeleton"/>}</div>
    {error && <div className="sign-in-error">{error}</div>}
    <form className="admin-user-form" onSubmit={(event) => void addUser(event)}><h3>Add administrator</h3><p>Use an Operations Administrator for normal data and scanner work. Only nominate another Organization Owner when they need full access governance.</p><div><label>Display name<input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><label>Username<input required pattern="[a-z0-9._-]{3,64}" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} /></label></div><div><label>Role<select value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="operations_administrator">Operations Administrator</option><option value="read_only_reviewer">Read-only Reviewer</option><option value="organization_owner">Organization Owner (full control)</option></select></label><label>Temporary password<input required minLength={12} type="password" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} /></label></div><button className="primary" disabled={busy}>{busy ? "Creating…" : "Add administrator"}</button></form>
  </section>;
}

function ManagedAccountRow({ user, currentUserId, busy, onSave }: { user: AdminPrincipal; currentUserId: string; busy: boolean; onSave: (userId: string, update: { displayName?: string; role?: "organization_owner" | "operations_administrator" | "read_only_reviewer"; isActive?: boolean }) => Promise<void> }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState(user.role);
  useEffect(() => { setDisplayName(user.displayName); setRole(user.role); }, [user.displayName, user.role]);
  const self = user.userId === currentUserId;
  const changed = displayName.trim() !== user.displayName || role !== user.role;
  return <article className={!user.isActive ? "admin-account admin-account--disabled" : "admin-account"}><span className="avatar">{initials(user.displayName)}</span><div className="admin-account__identity"><strong>{user.displayName}</strong><small>@{user.username}{self ? " · You" : ""}</small><div><Pill tone={user.role === "organization_owner" ? "blue" : user.role === "operations_administrator" ? "good" : "muted"}>{roleLabel(user.role)}</Pill>{!user.isActive && <Pill tone="warn">Disabled</Pill>}{user.mustChangePassword && <Pill tone="warn">Password change pending</Pill>}</div></div>{self ? <small className="admin-account__self">Use another Organization Owner to change your role or disable this account.</small> : <div className="admin-account__controls"><input aria-label={`${user.username} display name`} value={displayName} disabled={busy} onChange={(event) => setDisplayName(event.target.value)} /><select aria-label={`${user.username} role`} value={role} disabled={busy} onChange={(event) => setRole(event.target.value as typeof role)}><option value="operations_administrator">Operations Administrator</option><option value="read_only_reviewer">Read-only Reviewer</option><option value="organization_owner">Organization Owner</option></select><button className="secondary" disabled={busy || !changed || displayName.trim().length < 2} onClick={() => void onSave(user.userId, { ...(displayName.trim() !== user.displayName ? { displayName: displayName.trim() } : {}), ...(role !== user.role ? { role: role as "organization_owner" | "operations_administrator" | "read_only_reviewer" } : {}) })}>Save</button><button className={user.isActive ? "secondary" : "primary"} disabled={busy} onClick={() => void onSave(user.userId, { isActive: !user.isActive })}>{user.isActive ? "Disable" : "Enable"}</button></div>}</article>;
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
    <div className="accuracy-summary"><span><ShieldCheck size={25} /></span><div><strong>Evidence is preserved; disposition is append-only.</strong><p>Each review decision is tied to its signed-in administrator, includes a reason, and never rewrites the scans that created the case.</p></div></div>
    <div className="review-summary"><span><b>{activeCases.length}</b> active cases</span><span><b>{data.reviewCases.length - activeCases.length}</b> completed history</span><span>Organization Owners can resolve material cases.</span></div>
    {data.reviewCases.length === 0 ? <EmptyState>No review cases have been created from the current scan history.</EmptyState> : data.reviewCases.map((item) => <ReviewCaseCard key={item.reviewCaseId} reviewCase={item} data={data} session={session} onAction={async (action, reason) => { await reviewCaseAction(session, item.reviewCaseId, action, reason); await refresh(); }} onEvidence={() => openDetail({
      eyebrow: "Preserved evidence",
      title: `${item.containerLabel} review evidence`,
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
