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
  Wifi,
  X
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  API_URL,
  loadOperationsData,
  type Container,
  type Fixtures,
  type Location,
  type Projection,
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
  const searchRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loadOperationsData());
      setError(null);
      setLastRefresh(new Date());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not connect to the local API.");
    } finally {
      setLoading(false);
    }
  }, []);

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

  const selected = pageTitles[page];
  const reviewCount = data
    ? Object.values(data.projections).filter((projection) => projection?.health === "needs_review").length
    : 0;

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
          <button className="user-card" onClick={() => setDetail({
            eyebrow: "Signed-in profile",
            title: "Parker Smith",
            body: <><p className="detail-lead">The current administrator identity is simulated. Production roles will come from Microsoft Entra ID and Goodwill security groups.</p><DetailFacts items={[["Role", "Corporate administrator"], ["Scope", "All pilot locations"], ["Approval level", "Material corrections (prototype)"]]}/></>
          })}>
            <span className="avatar">PS</span>
            <span><strong>Parker Smith</strong><small>Corporate administrator</small></span>
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
              <i /> {error ? "API disconnected" : "Local API connected"}
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
                  placeholder="Search label or code"
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
              <span><strong>Start the local API to use live data.</strong> Expected at {API_URL}. The interface remains available for review.</span>
              <button onClick={() => void refresh()}>Try again</button>
            </div>
          )}

          {loading && !data ? (
            <div className="loading-grid">{[1, 2, 3, 4].map((item) => <div key={item} className="skeleton" />)}</div>
          ) : data ? (
            <PageContent page={page} data={data} query={query} setPage={setPage} openDetail={setDetail} />
          ) : null}
        </div>
        <footer>
          <span><ShieldCheck size={15} /> Local prototype • append-only audit foundation</span>
          <span>Last refreshed {lastRefresh.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
        </footer>
      </main>
      {detail && <DetailDrawer detail={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function PageContent({
  page,
  data,
  query,
  setPage,
  openDetail
}: {
  page: Page;
  data: OperationsData;
  query: string;
  setPage: (page: Page) => void;
  openDetail: OpenDetail;
}) {
  if (page === "dashboard") return <Dashboard data={data} setPage={setPage} />;
  if (page === "containers") return <ContainersPage data={data} query={query} openDetail={openDetail} />;
  if (page === "loads") return <LoadsPage data={data} query={query} openDetail={openDetail} />;
  if (page === "locations") return <LocationsPage data={data} openDetail={openDetail} />;
  if (page === "exceptions") return <ExceptionsPage data={data} openDetail={openDetail} />;
  if (page === "activity") return <ActivityPage data={data} query={query} openDetail={openDetail} />;
  if (page === "devices") return <DevicesPage data={data} openDetail={openDetail} />;
  if (page === "reports") return <ReportsPage data={data} openDetail={openDetail} />;
  return <SettingsPage openDetail={openDetail} />;
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
  return <div className="location-grid">{data.fixtures.locations.map((location) => {
    const projected = Object.values(data.projections).filter((item) => item?.locationId === location.locationId);
    const loaded = projected.filter((item) => item?.loadState === "loaded").length;
    const Icon = location.type === "warehouse" ? Building2 : location.type === "in_transit" ? Truck : Boxes;
    return <article className="location-card" key={location.locationId}>
      <div className="location-card__head"><span><Icon size={22} /></span><Pill tone="good">Active</Pill></div>
      <span className="eyebrow">{location.type.replaceAll("_", " ")}</span><h2>{location.name}</h2>
      <div className="location-stats"><div><strong>{projected.length}</strong><span>Observed here</span></div><div><strong>{loaded}</strong><span>Loaded</span></div></div>
      <button onClick={() => openDetail({
        eyebrow: location.type.replaceAll("_", " "),
        title: location.name,
        body: <><DetailFacts items={[
          ["Containers observed here", projected.length],
          ["Currently loaded", loaded],
          ["Devices assigned", data.fixtures.devices.filter((device) => device.assignedLocationId === location.locationId).length],
          ["Location UUID", location.locationId]
        ]}/><h3 className="detail-section-title">Containers at this location</h3><div className="detail-chip-list">{projected.slice(0, 30).map((projection) => <span key={projection!.containerId}>{data.fixtures.containers.find((item) => item.containerId === projection!.containerId)?.label}</span>)}{projected.length === 0 && <small>No current observations at this location.</small>}</div></>
      })}>Open location <ArrowRight size={16} /></button>
    </article>;
  })}</div>;
}

function ExceptionsPage({ data, openDetail }: { data: OperationsData; openDetail: OpenDetail }) {
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

function DevicesPage({ data, openDetail }: { data: OperationsData; openDetail: OpenDetail }) {
  return <div className="device-grid">{data.fixtures.devices.map((device) => {
    const location = data.fixtures.locations.find((item) => item.locationId === device.assignedLocationId);
    const events = data.events.filter((item) => item.deviceId === device.deviceId);
    return <article className="device-card" key={device.deviceId}>
      <div className="phone-icon"><Smartphone /></div><div className="device-card__status"><i /> ONLINE</div>
      <h2>{device.label}</h2><p><MapPin size={15} /> Locked to {location?.name}</p>
      <dl><div><dt>Last sync</dt><dd>Just now</dd></div><div><dt>Queued scans</dt><dd>0</dd></div><div><dt>Observations</dt><dd>{events.length}</dd></div><div><dt>App version</dt><dd>0.2 local</dd></div></dl>
      <button className="secondary" onClick={() => openDetail({
        eyebrow: "Shared scanner",
        title: device.label,
        body: <><DetailFacts items={[
          ["Assigned location", location?.name ?? "Unknown"],
          ["Observations", events.length],
          ["Installation UUID", device.installationId],
          ["Device UUID", device.deviceId]
        ]}/><h3 className="detail-section-title">Latest scanner activity</h3><EventEvidence events={events.slice(0, 12)} data={data}/></>
      })}>Device details <ChevronRight size={16} /></button>
    </article>;
  })}</div>;
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

function SettingsPage({ openDetail }: { openDetail: OpenDetail }) {
  const settings = [
    { icon: UserRound, title: "Roles & approvals", text: "Store managers handle routine corrections; corporate data stewards approve material state changes.", details: [["Store manager", "Request routine corrections"], ["Corporate steward", "Approve material state changes"], ["Status", "Policy draft — needs Goodwill approval"]] as [string, string][] },
    { icon: Smartphone, title: "Device provisioning", text: "Shared Android scanners remain locked to an assigned operating location.", details: [["Identity", "One installation UUID per physical device"], ["Assignment", "Exactly one operating location"], ["Status", "Local shared-device simulation active"]] as [string, string][] },
    { icon: Wifi, title: "Offline behavior", text: "Scans queue locally, preserve device order, and synchronize when connectivity returns.", details: [["Local queue", "AsyncStorage on the scanner"], ["Ordering", "Device installation + monotonic sequence"], ["Conflict handling", "Accept evidence and flag review"]] as [string, string][] },
    { icon: Cloud, title: "Integrations", text: "Production system, Entra ID, and analytics connections are placeholders in this local build.", details: [["Production system API", "Pending access"], ["Microsoft Entra ID", "Pending tenant details"], ["Analytics", "Fabric / Data Lake decision pending"]] as [string, string][] }
  ];
  return <section className="settings-list">{settings.map((setting) => <article key={setting.title}><span><setting.icon /></span><div><h2>{setting.title}</h2><p>{setting.text}</p></div><button aria-label={`Open ${setting.title}`} onClick={() => openDetail({
    eyebrow: "Configuration",
    title: setting.title,
    body: <><p className="detail-lead">{setting.text}</p><DetailFacts items={setting.details}/></>
  })}><ChevronRight /></button></article>)}</section>;
}
