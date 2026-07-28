import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useCallback, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { APP_RELEASE, APP_REPORTED_VERSION, APP_VERSION } from "./src/release";

const colors = {
  navy: "#00294F",
  deepBlue: "#003A6F",
  blue: "#00539F",
  cyan: "#009ED9",
  paleBlue: "#E7F3F9",
  surface: "#FFFFFF",
  canvas: "#F3F6F8",
  ink: "#212934",
  muted: "#687683",
  line: "#DCE3E8",
  green: "#16845B",
  paleGreen: "#E4F4ED",
  orange: "#B85417",
  paleOrange: "#FFF0E5",
  red: "#B3453A"
};

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:3000";
const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const DEVICE_ID = "30000000-0000-4000-8000-000000000001";
const INSTALLATION_ID = "31000000-0000-4000-8000-000000000001";
const LOCATION_ID = "20000000-0000-4000-8000-000000000002";
const QUEUE_KEY = "stacktrack.local.queue.v2";
const SEQUENCE_KEY = "stacktrack.local.sequence.v2";

type IconName = ComponentProps<typeof Ionicons>["name"];
type Tab = "home" | "activity" | "settings";
type WorkflowStep = "scan" | "action" | "details" | "confirm" | "success";
type ActionType = "load_assigned" | "batch_out" | "batch_in" | "emptied";
type QueueStatus = "pending" | "synced" | "review";

interface ContainerReference {
  containerId: string;
  label: string;
  type: string;
}

interface Fixtures {
  containers: ContainerReference[];
  locations: { locationId: string; name: string; type: string }[];
  goodsTypes: { name: string; secondaryLabel: string; options: string[] }[];
  devices?: {
    deviceId: string;
    label?: string;
    assignedLocationId?: string;
    requiredAppVersion?: string;
    isActive?: boolean;
  }[];
}

interface LocalObservation {
  localId: string;
  label: string;
  eventType: ActionType;
  eventAt: string;
  status: QueueStatus;
  loadCode?: string;
  message?: string;
  event?: Record<string, unknown>;
}

interface WorkflowState {
  label: string;
  container: ContainerReference | null;
  action: ActionType | null;
  goodsType: string;
  secondaryValue: string;
  destinationId: string;
  notes: string;
  loadCode: string | null;
}

const initialWorkflow: WorkflowState = {
  label: "",
  container: null,
  action: null,
  goodsType: "Soft",
  secondaryValue: "Raw",
  destinationId: "20000000-0000-4000-8000-000000000003",
  notes: "",
  loadCode: null
};

function pseudoUuid() {
  const hex = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  return hex.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function displayLoadCode(loadCodeId: string) {
  const date = new Date();
  const uniqueSuffix = loadCodeId.replaceAll("-", "").slice(0, 8).toUpperCase();
  return `ST-${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}-${uniqueSuffix}`;
}

function actionLabel(action: ActionType) {
  return {
    load_assigned: "Mark full",
    batch_out: "Send out",
    batch_in: "Receive",
    emptied: "Mark empty"
  }[action];
}

function versionIsOlder(version: string, required: string) {
  const parse = (value: string) => value.replace(/^v/i, "").split(".").map((item) => Number.parseInt(item, 10) || 0);
  const actual = parse(version); const target = parse(required);
  for (let index = 0; index < Math.max(actual.length, target.length); index += 1) {
    if ((actual[index] ?? 0) !== (target[index] ?? 0)) return (actual[index] ?? 0) < (target[index] ?? 0);
  }
  return false;
}

function Mark() {
  return (
    <View style={styles.mark}>
      <Image source={require("./assets/stacktrack-logo-tight.png")} style={styles.markLogo} resizeMode="contain" accessibilityLabel="StackTrack" accessibilityIgnoresInvertColors />
    </View>
  );
}

function Icon({ name, size = 21, color = colors.blue }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} />;
}

function Tag({ tone = "blue", children }: { tone?: "blue" | "green" | "orange" | "muted"; children: ReactNode }) {
  return (
    <View style={[styles.tag, tone === "green" && styles.tagGreen, tone === "orange" && styles.tagOrange, tone === "muted" && styles.tagMuted]}>
      <Text style={[styles.tagText, tone === "green" && styles.tagTextGreen, tone === "orange" && styles.tagTextOrange, tone === "muted" && styles.tagTextMuted]}>{children}</Text>
    </View>
  );
}

function PrimaryButton({ children, onPress, disabled = false, icon }: { children: ReactNode; onPress: () => void; disabled?: boolean; icon?: IconName }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.primaryButton, pressed && !disabled && styles.buttonPressed, disabled && styles.buttonDisabled]}>
      {icon && <Icon name={icon} size={20} color="white" />}
      <Text style={styles.primaryButtonText}>{children}</Text>
    </Pressable>
  );
}

function AppContent() {
  const { width } = useWindowDimensions();
  const isWide = width >= 720;
  const [tab, setTab] = useState<Tab>("home");
  const [fixtures, setFixtures] = useState<Fixtures | null>(null);
  const [online, setOnline] = useState(true);
  const [offlineMode, setOfflineMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [observations, setObservations] = useState<LocalObservation[]>([]);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [step, setStep] = useState<WorkflowStep>("scan");
  const [workflow, setWorkflow] = useState<WorkflowState>(initialWorkflow);
  const [submitting, setSubmitting] = useState(false);
  const [requiredAppVersion, setRequiredAppVersion] = useState(APP_VERSION);
  const [scannerEnabled, setScannerEnabled] = useState(true);
  const [assignedLocationId, setAssignedLocationId] = useState(LOCATION_ID);
  const [deviceLocationName, setDeviceLocationName] = useState("Midtown Store");
  const [deviceLabel, setDeviceLabel] = useState("Scanner A — Midtown");
  const [refreshingDevice, setRefreshingDevice] = useState(false);

  const loadLocal = useCallback(async () => {
    const cached = await AsyncStorage.getItem(QUEUE_KEY);
    if (cached) setObservations(JSON.parse(cached) as LocalObservation[]);
    try {
      // Device availability and assignment are control-plane data.  Bust any
      // intermediary cache so an admin action is visible on the next refresh.
      const response = await fetch(`${API_URL}/api/v1/local/reference-data?refresh=${Date.now()}`, {
        headers: {
          "x-stacktrack-tenant-id": TENANT_ID,
          "cache-control": "no-cache"
        }
      });
      if (!response.ok) throw new Error("API unavailable");
      const loaded = await response.json() as Fixtures;
      setFixtures(loaded);
      const registeredDevice = loaded.devices?.find((device) => device.deviceId === DEVICE_ID);
      setRequiredAppVersion(registeredDevice?.requiredAppVersion ?? APP_VERSION);
      setScannerEnabled(registeredDevice?.isActive ?? true);
      const nextLocationId = registeredDevice?.assignedLocationId ?? LOCATION_ID;
      setAssignedLocationId(nextLocationId);
      setDeviceLocationName(loaded.locations.find((location) => location.locationId === nextLocationId)?.name ?? "Assigned location unavailable");
      setDeviceLabel(registeredDevice?.label ?? "Assigned scanner");
      setOnline(true);
    } catch {
      setOnline(false);
      setFixtures({
        containers: [
          { containerId: "40000000-0000-4000-8000-000000000001", label: "B1001", type: "bin" },
          { containerId: "40000000-0000-4000-8000-000000000002", label: "B1002", type: "bin" },
          { containerId: "40000000-0000-4000-8000-000000000004", label: "C2001", type: "cart" }
        ],
        locations: [
          { locationId: LOCATION_ID, name: "Midtown Store", type: "store_backroom" },
          { locationId: "20000000-0000-4000-8000-000000000003", name: "South Sacramento Warehouse", type: "warehouse" }
        ],
        goodsTypes: [
          { name: "Soft", secondaryLabel: "Quality Type", options: ["Raw", "Pre-Sort", "Salvage"] },
          { name: "Hard", secondaryLabel: "Quality Type", options: ["Raw", "Pre-Sort", "Salvage"] },
          { name: "Books", secondaryLabel: "Quality Type", options: ["Raw", "Pre-Sort", "Salvage"] },
          { name: "Other", secondaryLabel: "Other Type", options: ["Trash", "Ecomm", "Ewaste", "Bric Brac"] }
        ]
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadLocal(); }, [loadLocal]);
  useEffect(() => {
    const refreshTimer = setInterval(() => void loadLocal(), 30_000);
    return () => clearInterval(refreshTimer);
  }, [loadLocal]);

  const refreshDevice = async () => {
    setRefreshingDevice(true);
    await loadLocal();
    setRefreshingDevice(false);
  };

  const pending = observations.filter((item) => item.status === "pending").length;
  const effectiveOnline = online && !offlineMode;
  const recent = observations.slice(0, 4);
  const updateRequired = versionIsOlder(APP_VERSION, requiredAppVersion);

  useEffect(() => {
    if (!effectiveOnline) return;
    void fetch(`${API_URL}/api/v1/local/devices/${DEVICE_ID}/telemetry`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-stacktrack-tenant-id": TENANT_ID },
      body: JSON.stringify({ installationId: INSTALLATION_ID, appVersion: APP_REPORTED_VERSION, pendingOfflineScanCount: pending })
    }).catch(() => undefined);
  }, [effectiveOnline, pending]);

  const saveObservations = async (next: LocalObservation[]) => {
    setObservations(next);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(next));
  };

  const syncPending = async () => {
    if (offlineMode || !scannerEnabled) return;
    const next = [...observations];
    let reachedServer = false;
    for (let index = 0; index < next.length; index += 1) {
      const item = next[index];
      if (!item || item.status !== "pending" || !item.event) continue;
      try {
        const response = await fetch(`${API_URL}/api/v1/events`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-stacktrack-tenant-id": TENANT_ID,
            "x-stacktrack-device-id": DEVICE_ID
          },
          body: JSON.stringify(item.event)
        });
        const result = await response.json() as { accepted?: boolean; status?: string; message?: string };
        if (!response.ok || !result.accepted) throw new Error(result.message ?? "Server rejected observation");
        reachedServer = true;
        next[index] = {
          ...item,
          status: result.status === "accepted_for_review" ? "review" : "synced",
          message: result.status === "accepted_for_review"
            ? "Saved and flagged for administrative review."
            : "Synced to the local ledger."
        };
      } catch {
        setOnline(false);
        break;
      }
    }
    if (reachedServer) setOnline(true);
    await saveObservations(next);
  };

  const beginScan = () => {
    if (!scannerEnabled) {
      Alert.alert("Scanner disabled", "An administrator has disabled this scanner. Ask them to enable it before recording new observations.");
      return;
    }
    setWorkflow(initialWorkflow);
    setStep("scan");
    setWorkflowOpen(true);
  };

  const findContainer = () => {
    const normalized = workflow.label.trim().toUpperCase();
    const container = fixtures?.containers.find((item) => item.label === normalized) ?? null;
    if (!container) {
      if (Platform.OS === "web") window.alert("That label is not in the local reference list. Try B1001, B1002, or C2001.");
      else Alert.alert("Container not found", "Try B1001, B1002, or C2001 in this local build.");
      return;
    }
    setWorkflow((current) => ({ ...current, label: normalized, container }));
    setStep("action");
  };

  const chooseAction = (action: ActionType) => {
    setWorkflow((current) => ({ ...current, action }));
    setStep(action === "load_assigned" || action === "batch_out" ? "details" : "confirm");
  };

  const submitObservation = async () => {
    if (!workflow.container || !workflow.action) return;
    setSubmitting(true);
    const sequence = Number(await AsyncStorage.getItem(SEQUENCE_KEY) ?? "20");
    const eventId = pseudoUuid();
    const loadCodeId = workflow.action === "load_assigned" ? pseudoUuid() : undefined;
    const loadCode = loadCodeId ? displayLoadCode(loadCodeId) : null;
    const eventAt = new Date().toISOString();
    const payload = workflow.action === "load_assigned"
      ? { displayLoadCode: loadCode, goodsType: workflow.goodsType, secondaryValue: workflow.secondaryValue, notes: workflow.notes }
      : workflow.action === "batch_out"
        ? { destinationLocationId: workflow.destinationId, notes: workflow.notes }
        : { notes: workflow.notes };
    const event = {
      eventId,
      deviceInstallationId: INSTALLATION_ID,
      deviceSequence: sequence,
      containerId: workflow.container.containerId,
      ...(loadCodeId ? { loadCodeId } : {}),
      locationId: workflow.action === "batch_out"
        ? "20000000-0000-4000-8000-000000000004"
        : assignedLocationId,
      eventType: workflow.action,
      eventAt,
      deviceClockOffsetSeconds: 0,
      clockVerifiedAt: eventAt,
      referenceDataVersion: new Date(Date.now() - 60_000).toISOString(),
      payload
    };
    let status: QueueStatus = "pending";
    let message = "Saved on this device and waiting to sync.";
    if (effectiveOnline) {
      try {
        const response = await fetch(`${API_URL}/api/v1/events`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-stacktrack-tenant-id": TENANT_ID,
            "x-stacktrack-device-id": DEVICE_ID
          },
          body: JSON.stringify(event)
        });
        const result = await response.json() as { accepted?: boolean; status?: string; message?: string };
        if (!response.ok || !result.accepted) throw new Error(result.message ?? "Server rejected observation");
        status = result.status === "accepted_for_review" ? "review" : "synced";
        message = status === "review" ? "Saved and flagged for administrative review." : "Synced to the local ledger.";
        setOnline(true);
      } catch {
        setOnline(false);
      }
    }
    const next: LocalObservation = {
      localId: eventId,
      label: workflow.container.label,
      eventType: workflow.action,
      eventAt,
      status,
      ...(loadCode ? { loadCode } : {}),
      message,
      event
    };
    await saveObservations([next, ...observations]);
    await AsyncStorage.setItem(SEQUENCE_KEY, String(sequence + 1));
    setWorkflow((current) => ({ ...current, loadCode }));
    setStep("success");
    setSubmitting(false);
  };

  const closeWorkflow = () => {
    setWorkflowOpen(false);
    setStep("scan");
    setWorkflow(initialWorkflow);
  };

  if (loading) {
    return (
      <View style={styles.launchScreen}>
        <Image
          source={require("./assets/stacktrack-logo-tight.png")}
          style={styles.launchLogo}
          resizeMode="contain"
        />
        <ActivityIndicator size="small" color={colors.blue} style={styles.launchSpinner} />
        <Text style={styles.launchLoadingText}>Preparing scanner…</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" translucent={false} hidden={false} />
      <View style={[styles.app, isWide && styles.appWide]}>
        {isWide && <WideNav tab={tab} setTab={setTab} pending={pending} />}
        <View style={styles.main}>
          <View style={styles.header}>
            <Mark />
            <View style={styles.headerRight}>
              <Pressable onPress={() => void refreshDevice()} disabled={refreshingDevice} accessibilityLabel="Refresh device assignment" style={({ pressed }) => [styles.headerRefresh, pressed && styles.buttonPressed]}><Icon name="refresh-outline" size={18} color={colors.blue} /></Pressable>
              <View style={styles.headerStatus}>
                <View style={[styles.statusDot, !effectiveOnline && styles.statusDotOffline]} />
                <Text style={styles.headerStatusText}>{refreshingDevice ? "REFRESHING" : effectiveOnline ? "SYNCED" : "OFFLINE"}</Text>
              </View>
            </View>
          </View>
          {tab === "home" && <HomeScreen online={effectiveOnline} pending={pending} recent={recent} onScan={beginScan} updateRequired={updateRequired} requiredAppVersion={requiredAppVersion} scannerEnabled={scannerEnabled} deviceLocationName={deviceLocationName} />}
          {tab === "activity" && <ActivityScreen observations={observations} />}
          {tab === "settings" && (
            <SettingsScreen
              offlineMode={offlineMode}
              setOfflineMode={setOfflineMode}
              online={online}
              onReconnect={() => void syncPending()}
              updateRequired={updateRequired}
              requiredAppVersion={requiredAppVersion}
              scannerEnabled={scannerEnabled}
              deviceLocationName={deviceLocationName}
              deviceLabel={deviceLabel}
            />
          )}
          {!isWide && <BottomNav tab={tab} setTab={setTab} pending={pending} />}
        </View>
      </View>

      <Modal visible={workflowOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeWorkflow}>
        <SafeAreaProvider>
          <SafeAreaView style={styles.modalSafe}>
            <WorkflowHeader step={step} onClose={closeWorkflow} onBack={() => setStep(step === "action" ? "scan" : step === "details" || step === "confirm" ? "action" : "scan")} />
            <ScrollView contentContainerStyle={styles.workflowContent} keyboardShouldPersistTaps="handled">
              {step === "scan" && <ScanStep workflow={workflow} setWorkflow={setWorkflow} onContinue={findContainer} />}
              {step === "action" && workflow.container && <ActionStep container={workflow.container} onChoose={chooseAction} />}
              {step === "details" && fixtures && <DetailsStep workflow={workflow} setWorkflow={setWorkflow} fixtures={fixtures} assignedLocationId={assignedLocationId} onContinue={() => setStep("confirm")} />}
              {step === "confirm" && workflow.container && workflow.action && <ConfirmStep workflow={workflow} fixtures={fixtures} submitting={submitting} onSubmit={() => void submitObservation()} />}
              {step === "success" && workflow.container && workflow.action && <SuccessStep workflow={workflow} online={effectiveOnline} onDone={closeWorkflow} onAnother={() => { closeWorkflow(); setTimeout(beginScan, 150); }} />}
            </ScrollView>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </SafeAreaView>
  );
}

function HomeScreen({ online, pending, recent, onScan, updateRequired, requiredAppVersion, scannerEnabled, deviceLocationName }: { online: boolean; pending: number; recent: LocalObservation[]; onScan: () => void; updateRequired: boolean; requiredAppVersion: string; scannerEnabled: boolean; deviceLocationName: string }) {
  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <View style={styles.locationStrip}>
        <View style={styles.locationIcon}><Icon name="location" size={19} /></View>
        <View style={styles.locationCopy}><Text style={styles.overline}>DEVICE LOCATION</Text><Text style={styles.locationName}>{deviceLocationName}</Text></View>
        <Tag tone="green">LOCKED</Tag>
      </View>
      {updateRequired && <View style={styles.requiredUpdateBanner}><Icon name="alert-circle-outline" color={colors.orange} size={22} /><View style={styles.requiredUpdateCopy}><Text style={styles.requiredUpdateTitle}>Update required</Text><Text style={styles.requiredUpdateText}>This scanner is on {APP_VERSION}; StackTrack {requiredAppVersion} is required. Ask an administrator to update this device.</Text></View></View>}
      {!scannerEnabled && <View style={styles.requiredUpdateBanner}><Icon name="pause-circle-outline" color={colors.red} size={22} /><View style={styles.requiredUpdateCopy}><Text style={styles.requiredUpdateTitle}>Scanner disabled</Text><Text style={styles.requiredUpdateText}>An administrator has paused this shared scanner. New observations cannot be recorded until it is enabled.</Text></View></View>}

      <View style={styles.hero}>
        <Text style={styles.heroEyebrow}>FIELD SCANNER</Text>
        <Text style={styles.heroTitle}>Ready for the{`\n`}next container.</Text>
        <Text style={styles.heroText}>Scan the 4 × 4 label, then record one clear observation.</Text>
        <Pressable onPress={onScan} disabled={!scannerEnabled} style={({ pressed }) => [styles.scanButton, pressed && scannerEnabled && styles.buttonPressed, !scannerEnabled && styles.buttonDisabled]}>
          <View style={styles.scanGlyph}><Icon name="scan-outline" size={36} color="white" /></View>
          <View style={styles.scanCopy}><Text style={styles.scanButtonText}>SCAN CONTAINER</Text><Text style={styles.scanButtonSub}>Camera or handheld scanner</Text></View>
          <Icon name="arrow-forward" color="white" />
        </Pressable>
        <Text style={styles.testHint}>Local test labels: B1001 · B1002 · C2001</Text>
      </View>

      <View style={styles.syncCard}>
        <View style={[styles.syncIcon, !online && styles.syncIconOffline]}><Icon name={online ? "cloud-done-outline" : "cloud-offline-outline"} color={online ? colors.green : colors.orange} /></View>
        <View style={styles.syncCopy}><Text style={styles.syncTitle}>{online ? "All observations synced" : "Offline capture is active"}</Text><Text style={styles.syncText}>{pending ? `${pending} observation${pending === 1 ? "" : "s"} waiting on this device` : online ? "Nothing is waiting on this device" : "Scans will queue safely on this device"}</Text></View>
        {pending > 0 && <View style={styles.pendingBadge}><Text>{pending}</Text></View>}
      </View>

      <View style={styles.sectionTitleRow}><Text style={styles.sectionTitle}>RECENT ON THIS DEVICE</Text><Text style={styles.sectionAction}>VIEW ALL</Text></View>
      <View style={styles.recentCard}>
        {recent.length === 0 ? (
          <View style={styles.emptyRecent}><Icon name="clipboard-outline" size={27} color={colors.muted} /><Text style={styles.emptyRecentTitle}>No device activity yet</Text><Text style={styles.emptyRecentText}>Your first scan will appear here.</Text></View>
        ) : recent.map((item, index) => <ObservationRow key={item.localId} item={item} last={index === recent.length - 1} />)}
      </View>

      <View style={styles.accuracyCard}>
        <View style={styles.accuracyIcon}><Icon name="shield-checkmark-outline" color={colors.blue} size={22} /></View>
        <View style={styles.accuracyCopy}><Text style={styles.accuracyTitle}>Built for accurate records</Text><Text style={styles.accuracyText}>Each scan is timestamped, ordered, and kept as evidence—even when another device disagrees.</Text></View>
      </View>
    </ScrollView>
  );
}

function ObservationRow({ item, last }: { item: LocalObservation; last: boolean }) {
  const icon: IconName = item.eventType === "load_assigned" ? "archive-outline" : item.eventType === "batch_out" ? "arrow-forward-circle-outline" : item.eventType === "batch_in" ? "arrow-down-circle-outline" : "checkmark-circle-outline";
  return (
    <View style={[styles.observation, last && styles.observationLast]}>
      <View style={styles.observationIcon}><Icon name={icon} size={20} /></View>
      <View style={styles.observationCopy}><Text style={styles.observationTitle}>{item.label} · {actionLabel(item.eventType)}</Text><Text style={styles.observationTime}>{new Date(item.eventAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}{item.loadCode ? ` · ${item.loadCode}` : ""}</Text></View>
      <Tag tone={item.status === "synced" ? "green" : item.status === "review" ? "orange" : "muted"}>{item.status === "synced" ? "SYNCED" : item.status === "review" ? "REVIEW" : "QUEUED"}</Tag>
    </View>
  );
}

function ActivityScreen({ observations }: { observations: LocalObservation[] }) {
  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <Text style={styles.pageEyebrow}>DEVICE HISTORY</Text><Text style={styles.pageTitle}>Your activity</Text><Text style={styles.pageDescription}>Observations recorded on this shared scanner.</Text>
      <View style={styles.activitySummary}><View style={styles.summaryItem}><Text style={styles.summaryValue}>{observations.length}</Text><Text style={styles.summaryLabel}>TOTAL</Text></View><View style={styles.summaryItem}><Text style={styles.summaryValue}>{observations.filter((item) => item.status === "synced").length}</Text><Text style={styles.summaryLabel}>SYNCED</Text></View><View style={styles.summaryItem}><Text style={styles.summaryValue}>{observations.filter((item) => item.status === "pending").length}</Text><Text style={styles.summaryLabel}>QUEUED</Text></View></View>
      <View style={styles.recentCard}>{observations.length ? observations.map((item, index) => <ObservationRow key={item.localId} item={item} last={index === observations.length - 1} />) : <View style={styles.emptyRecent}><Icon name="time-outline" size={28} color={colors.muted} /><Text style={styles.emptyRecentTitle}>No activity on this device</Text></View>}</View>
    </ScrollView>
  );
}

function SettingsScreen({ offlineMode, setOfflineMode, online, onReconnect, updateRequired, requiredAppVersion, scannerEnabled, deviceLocationName, deviceLabel }: { offlineMode: boolean; setOfflineMode: (value: boolean) => void; online: boolean; onReconnect: () => void; updateRequired: boolean; requiredAppVersion: string; scannerEnabled: boolean; deviceLocationName: string; deviceLabel: string }) {
  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <Text style={styles.pageEyebrow}>LOCAL PROTOTYPE</Text><Text style={styles.pageTitle}>Device settings</Text><Text style={styles.pageDescription}>This shared scanner is provisioned for one operating location.</Text>
      <View style={styles.settingsCard}>
        <SettingRow icon="location-outline" title="Assigned location" subtitle={deviceLocationName} trailing={<Tag tone="green">LOCKED</Tag>} />
        <SettingRow icon="phone-portrait-outline" title="Device" subtitle={deviceLabel} />
        <SettingRow icon={scannerEnabled ? "play-circle-outline" : "pause-circle-outline"} title="Scanner availability" subtitle={scannerEnabled ? "Enabled by administrator" : "Disabled by administrator"} trailing={<Tag tone={scannerEnabled ? "green" : "orange"}>{scannerEnabled ? "ENABLED" : "DISABLED"}</Tag>} />
        <SettingRow icon={updateRequired ? "alert-circle-outline" : "checkmark-circle-outline"} title="StackTrack version" subtitle={`${APP_RELEASE}${updateRequired ? ` — update to ${requiredAppVersion} required` : " — current"}`} trailing={<Tag tone={updateRequired ? "orange" : "green"}>{updateRequired ? "UPDATE" : "CURRENT"}</Tag>} />
        <SettingRow icon={online ? "cloud-done-outline" : "cloud-offline-outline"} title="Data service" subtitle={API_URL.includes("azurecontainerapps.io") ? "Azure test environment" : "Local development environment"} trailing={<Tag tone={online ? "green" : "orange"}>{online ? "CONNECTED" : "OFFLINE"}</Tag>} />
        <SettingRow icon="person-outline" title="Session" subtitle="Shared device mode" />
      </View>
      <Text style={styles.sectionTitle}>TESTING</Text>
      <View style={styles.settingsCard}>
        <SettingRow icon="cloud-offline-outline" title="Simulate offline" subtitle="Queue new observations locally" trailing={<Switch value={offlineMode} onValueChange={setOfflineMode} trackColor={{ false: "#C9D2D9", true: colors.cyan }} />} />
        <SettingRow icon="server-outline" title="Local API" subtitle={online ? API_URL : "Connection unavailable"} trailing={<Pressable onPress={onReconnect}><Text style={styles.retryText}>RETRY</Text></Pressable>} />
      </View>
      <View style={styles.prototypeNotice}><Icon name="construct-outline" color={colors.orange} /><Text>This is a local test build. Authentication, remote device management, and production integrations are intentionally simulated.</Text></View>
    </ScrollView>
  );
}

function SettingRow({ icon, title, subtitle, trailing }: { icon: IconName; title: string; subtitle: string; trailing?: ReactNode }) {
  return <View style={styles.settingRow}><View style={styles.settingIcon}><Icon name={icon} size={20} /></View><View style={styles.settingCopy}><Text style={styles.settingTitle}>{title}</Text><Text style={styles.settingSubtitle}>{subtitle}</Text></View>{trailing}</View>;
}

function WorkflowHeader({ step, onClose, onBack }: { step: WorkflowStep; onClose: () => void; onBack: () => void }) {
  const showBack = step !== "scan" && step !== "success";
  const progress = step === "scan" ? 1 : step === "action" ? 2 : step === "details" ? 3 : step === "confirm" ? 4 : 4;
  return (
    <>
      <View style={styles.workflowHeader}>
        <Pressable onPress={showBack ? onBack : onClose} style={styles.workflowHeaderButton}><Icon name={showBack ? "arrow-back" : "close"} color={colors.ink} /></Pressable>
        <Text style={styles.workflowHeaderTitle}>{step === "success" ? "Observation saved" : "New observation"}</Text>
        <Pressable onPress={onClose} style={styles.workflowHeaderButton}>{showBack ? <Icon name="close" color={colors.ink} /> : <View />}</Pressable>
      </View>
      {step !== "success" && <View style={styles.progress}><View style={[styles.progressFill, { width: `${progress * 25}%` }]} /></View>}
    </>
  );
}

function ScanStep({ workflow, setWorkflow, onContinue }: { workflow: WorkflowState; setWorkflow: (value: (current: WorkflowState) => WorkflowState) => void; onContinue: () => void }) {
  return (
    <View style={styles.step}>
      <Text style={styles.stepEyebrow}>STEP 1 OF 4</Text><Text style={styles.stepTitle}>Scan the container label</Text><Text style={styles.stepText}>Center the QR code in the frame or enter the printed ID.</Text>
      <View style={styles.scanFrame}><View style={styles.scanCornerA} /><View style={styles.scanCornerB} /><View style={styles.scanCornerC} /><View style={styles.scanCornerD} /><Icon name="qr-code-outline" size={80} color={colors.blue} /><View style={styles.scanLine} /></View>
      <View style={styles.orRow}><View /><Text>OR ENTER LABEL</Text><View /></View>
      <TextInput
        value={workflow.label}
        onChangeText={(label) => setWorkflow((current) => ({ ...current, label }))}
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="done"
        blurOnSubmit
        placeholder="Example: B1001"
        placeholderTextColor="#94A0AA"
        style={styles.labelInput}
        onSubmitEditing={onContinue}
      />
      <PrimaryButton onPress={onContinue} disabled={!workflow.label.trim()} icon="arrow-forward">CONTINUE</PrimaryButton>
      <Pressable onPress={() => setWorkflow((current) => ({ ...current, label: "B1001" }))} style={styles.testLabelButton}><Text>FILL TEST LABEL B1001</Text></Pressable>
    </View>
  );
}

function ActionStep({ container, onChoose }: { container: ContainerReference; onChoose: (action: ActionType) => void }) {
  const actions: { action: ActionType; icon: IconName; title: string; text: string; accent: string }[] = [
    { action: "load_assigned", icon: "archive-outline", title: "Mark full", text: "Generate a load code", accent: colors.blue },
    { action: "batch_out", icon: "arrow-forward-circle-outline", title: "Send out", text: "Move toward a destination", accent: colors.cyan },
    { action: "batch_in", icon: "arrow-down-circle-outline", title: "Receive", text: "Confirm arrival here", accent: colors.green },
    { action: "emptied", icon: "checkmark-circle-outline", title: "Mark empty", text: "Close the active load", accent: colors.orange }
  ];
  return (
    <View style={styles.step}>
      <Text style={styles.stepEyebrow}>STEP 2 OF 4</Text><Text style={styles.stepTitle}>What happened?</Text><Text style={styles.stepText}>Choose the one observation you are making now.</Text>
      <View style={styles.scannedContainer}><View style={styles.scannedIcon}><Icon name="cube-outline" /></View><View><Text style={styles.scannedLabel}>{container.label}</Text><Text style={styles.scannedType}>{container.type.toUpperCase()} · LABEL VERIFIED</Text></View><Icon name="checkmark-circle" color={colors.green} /></View>
      <View style={styles.actionGrid}>{actions.map((item) => (
        <Pressable key={item.action} onPress={() => onChoose(item.action)} style={({ pressed }) => [styles.actionCard, pressed && styles.actionCardPressed]}>
          <View style={[styles.actionIcon, { backgroundColor: `${item.accent}18` }]}><Icon name={item.icon} size={26} color={item.accent} /></View>
          <Text style={styles.actionTitle}>{item.title}</Text><Text style={styles.actionText}>{item.text}</Text><Icon name="arrow-forward" size={18} color={colors.blue} />
        </Pressable>
      ))}</View>
    </View>
  );
}

function DetailsStep({ workflow, setWorkflow, fixtures, assignedLocationId, onContinue }: { workflow: WorkflowState; setWorkflow: (value: (current: WorkflowState) => WorkflowState) => void; fixtures: Fixtures; assignedLocationId: string; onContinue: () => void }) {
  const selectedGoods = fixtures.goodsTypes.find((item) => item.name === workflow.goodsType) ?? fixtures.goodsTypes[0];
  return (
    <View style={styles.step}>
      <Text style={styles.stepEyebrow}>STEP 3 OF 4</Text><Text style={styles.stepTitle}>{workflow.action === "load_assigned" ? "Describe the load" : "Choose the destination"}</Text><Text style={styles.stepText}>These details make the observation useful downstream.</Text>
      {workflow.action === "load_assigned" ? (
        <>
          <Text style={styles.fieldLabel}>GOODS TYPE</Text><View style={styles.choiceWrap}>{fixtures.goodsTypes.map((item) => <Pressable key={item.name} onPress={() => setWorkflow((current) => ({ ...current, goodsType: item.name, secondaryValue: item.options[0] ?? "" }))} style={[styles.choice, workflow.goodsType === item.name && styles.choiceActive]}><Text style={[styles.choiceText, workflow.goodsType === item.name && styles.choiceTextActive]}>{item.name}</Text></Pressable>)}</View>
          <Text style={styles.fieldLabel}>{selectedGoods?.secondaryLabel.toUpperCase()}</Text><View style={styles.choiceWrap}>{selectedGoods?.options.map((item) => <Pressable key={item} onPress={() => setWorkflow((current) => ({ ...current, secondaryValue: item }))} style={[styles.choice, workflow.secondaryValue === item && styles.choiceActive]}><Text style={[styles.choiceText, workflow.secondaryValue === item && styles.choiceTextActive]}>{item}</Text></Pressable>)}</View>
        </>
      ) : (
        <View>{fixtures.locations.filter((item) => item.locationId !== assignedLocationId && item.type !== "in_transit").map((location) => <Pressable key={location.locationId} onPress={() => setWorkflow((current) => ({ ...current, destinationId: location.locationId }))} style={[styles.destination, workflow.destinationId === location.locationId && styles.destinationActive]}><View style={styles.destinationIcon}><Icon name="business-outline" /></View><View style={styles.destinationCopy}><Text style={styles.destinationTitle}>{location.name}</Text><Text style={styles.destinationText}>{location.type.replaceAll("_", " ")}</Text></View><Icon name={workflow.destinationId === location.locationId ? "radio-button-on" : "radio-button-off"} color={workflow.destinationId === location.locationId ? colors.blue : colors.muted} /></Pressable>)}</View>
      )}
      <Text style={styles.fieldLabel}>OPTIONAL NOTE</Text><TextInput value={workflow.notes} onChangeText={(notes) => setWorkflow((current) => ({ ...current, notes }))} placeholder="Add context for a manager" placeholderTextColor="#98A2AB" style={[styles.labelInput, styles.noteInput]} multiline />
      <PrimaryButton onPress={onContinue} icon="arrow-forward">REVIEW OBSERVATION</PrimaryButton>
    </View>
  );
}

function ConfirmStep({ workflow, fixtures, submitting, onSubmit }: { workflow: WorkflowState; fixtures: Fixtures | null; submitting: boolean; onSubmit: () => void }) {
  const destination = fixtures?.locations.find((item) => item.locationId === workflow.destinationId)?.name;
  return (
    <View style={styles.step}>
      <Text style={styles.stepEyebrow}>STEP 4 OF 4</Text><Text style={styles.stepTitle}>Confirm before saving</Text><Text style={styles.stepText}>Check the label and action. The original observation will remain in the audit history.</Text>
      <View style={styles.confirmCard}>
        <ConfirmRow label="Container" value={workflow.container?.label ?? ""} />
        <ConfirmRow label="Observation" value={actionLabel(workflow.action!)} />
        <ConfirmRow label="Location" value="Midtown Store" />
        {workflow.action === "load_assigned" && <><ConfirmRow label="Goods" value={workflow.goodsType} /><ConfirmRow label="Quality" value={workflow.secondaryValue} /></>}
        {workflow.action === "batch_out" && <ConfirmRow label="Destination" value={destination ?? "Not selected"} />}
        {workflow.notes && <ConfirmRow label="Note" value={workflow.notes} />}
        <ConfirmRow label="Device time" value={new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} last />
      </View>
      <View style={styles.auditNotice}><Icon name="shield-checkmark-outline" size={22} /><Text>Saving creates a timestamped, append-only observation tied to this device installation.</Text></View>
      <PrimaryButton onPress={onSubmit} disabled={submitting} {...(!submitting ? { icon: "checkmark" as const } : {})}>{submitting ? "SAVING…" : "SAVE OBSERVATION"}</PrimaryButton>
    </View>
  );
}

function ConfirmRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return <View style={[styles.confirmRow, last && styles.confirmRowLast]}><Text style={styles.confirmLabel}>{label}</Text><Text style={styles.confirmValue}>{value}</Text></View>;
}

function SuccessStep({ workflow, online, onDone, onAnother }: { workflow: WorkflowState; online: boolean; onDone: () => void; onAnother: () => void }) {
  return (
    <View style={[styles.step, styles.successStep]}>
      <View style={styles.successIcon}><Icon name="checkmark" size={45} color="white" /></View>
      <Text style={styles.successEyebrow}>{online ? "SAVED & SYNCED" : "SAVED ON DEVICE"}</Text><Text style={styles.successTitle}>{workflow.container?.label} updated.</Text>
      <Text style={styles.successText}>{online ? "The observation is now part of the local audit ledger." : "The observation is safe on this device and will sync when a connection returns."}</Text>
      {workflow.loadCode && <View style={styles.loadCodeBox}><Text style={styles.loadCodeLabel}>GENERATED LOAD CODE</Text><Text style={styles.loadCodeValue}>{workflow.loadCode}</Text><Text style={styles.loadCodeHelp}>Use this code in the production system.</Text></View>}
      <PrimaryButton onPress={onDone}>DONE</PrimaryButton>
      <Pressable onPress={onAnother} style={styles.anotherButton}><Icon name="scan-outline" size={18} /><Text>SCAN ANOTHER CONTAINER</Text></Pressable>
    </View>
  );
}

function WideNav({ tab, setTab, pending }: { tab: Tab; setTab: (tab: Tab) => void; pending: number }) {
  return <View style={styles.wideNav}><Mark /><View style={styles.wideNavLocation}><Text style={styles.overline}>ASSIGNED LOCATION</Text><Text style={styles.wideNavLocationName}>Midtown Store</Text></View><View style={styles.wideNavItems}><NavItem icon="home-outline" activeIcon="home" label="Home" active={tab === "home"} onPress={() => setTab("home")} /><NavItem icon="time-outline" activeIcon="time" label="Activity" active={tab === "activity"} onPress={() => setTab("activity")} badge={pending} /><NavItem icon="settings-outline" activeIcon="settings" label="Settings" active={tab === "settings"} onPress={() => setTab("settings")} /></View><View style={styles.wideNavFoot}><Icon name="shield-checkmark-outline" color="#87B9D2" /><Text>Accuracy-first local build</Text></View></View>;
}

function BottomNav({ tab, setTab, pending }: { tab: Tab; setTab: (tab: Tab) => void; pending: number }) {
  return <View style={styles.bottomNav}><NavItem icon="home-outline" activeIcon="home" label="Home" active={tab === "home"} onPress={() => setTab("home")} /><NavItem icon="time-outline" activeIcon="time" label="Activity" active={tab === "activity"} onPress={() => setTab("activity")} badge={pending} /><NavItem icon="settings-outline" activeIcon="settings" label="Settings" active={tab === "settings"} onPress={() => setTab("settings")} /></View>;
}

function NavItem({ icon, activeIcon, label, active, onPress, badge = 0 }: { icon: IconName; activeIcon: IconName; label: string; active: boolean; onPress: () => void; badge?: number }) {
  return <Pressable onPress={onPress} style={[styles.navItem, active && styles.navItemActive]}><View><Icon name={active ? activeIcon : icon} color={active ? colors.blue : "#788692"} />{badge > 0 && <View style={styles.navBadge}><Text>{badge}</Text></View>}</View><Text style={[styles.navLabel, active && styles.navLabelActive]}>{label}</Text></Pressable>;
}

export default function App() {
  return <SafeAreaProvider><AppContent /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  app: { flex: 1, backgroundColor: colors.canvas },
  appWide: { flexDirection: "row", maxWidth: 1100, width: "100%", alignSelf: "center", backgroundColor: colors.surface, boxShadow: "0 18px 60px rgba(18,42,61,.16)" as never },
  main: { flex: 1, minWidth: 0 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas },
  loadingText: { color: colors.muted, marginTop: 12, fontSize: 13 },
  launchScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.canvas,
    padding: 32
  },
  launchLogo: { width: 300, height: 78, marginBottom: 18 },
  launchSpinner: { marginTop: 24 },
  launchLoadingText: { color: colors.muted, marginTop: 12, fontSize: 13 },
  header: { height: 68, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.line, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerRefresh: { width: 34, height: 34, borderWidth: 1, borderColor: colors.line, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  mark: { flexDirection: "row", alignItems: "center" },
  markLogo: { width: 156, height: 42 },
  headerStatus: { flexDirection: "row", alignItems: "center", backgroundColor: "#F0F4F6", borderRadius: 12, paddingHorizontal: 9, paddingVertical: 5 },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.green, marginRight: 5 },
  statusDotOffline: { backgroundColor: colors.orange },
  headerStatusText: { fontSize: 8, color: colors.muted, fontWeight: "800", letterSpacing: 0.7 },
  screenContent: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 96, maxWidth: 720, width: "100%", alignSelf: "center" },
  locationStrip: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: 12, marginBottom: 18 },
  requiredUpdateBanner: { flexDirection: "row", gap: 10, backgroundColor: colors.paleOrange, borderLeftWidth: 3, borderLeftColor: colors.orange, padding: 13, marginBottom: 18 },
  requiredUpdateCopy: { flex: 1 },
  requiredUpdateTitle: { color: colors.orange, fontWeight: "800", fontSize: 13, marginBottom: 3 },
  requiredUpdateText: { color: "#80512F", fontSize: 11, lineHeight: 16 },
  locationIcon: { width: 35, height: 35, backgroundColor: colors.paleBlue, alignItems: "center", justifyContent: "center", marginRight: 10 },
  locationCopy: { flex: 1 },
  overline: { color: colors.muted, fontSize: 8, fontWeight: "800", letterSpacing: 1.1 },
  locationName: { color: colors.ink, fontSize: 13, fontWeight: "700", marginTop: 2 },
  tag: { backgroundColor: colors.paleBlue, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5 },
  tagGreen: { backgroundColor: colors.paleGreen },
  tagOrange: { backgroundColor: colors.paleOrange },
  tagMuted: { backgroundColor: "#EDF0F2" },
  tagText: { color: colors.blue, fontSize: 7, fontWeight: "900", letterSpacing: 0.6 },
  tagTextGreen: { color: colors.green },
  tagTextOrange: { color: colors.orange },
  tagTextMuted: { color: colors.muted },
  hero: { backgroundColor: colors.navy, padding: 24, marginBottom: 14, overflow: "hidden" },
  heroEyebrow: { color: "#6FC3E2", fontSize: 9, fontWeight: "800", letterSpacing: 1.7, marginBottom: 9 },
  heroTitle: { color: "white", fontSize: 32, lineHeight: 35, fontWeight: "800", letterSpacing: -1 },
  heroText: { color: "#B6CADA", fontSize: 12, lineHeight: 18, marginTop: 9, maxWidth: 330 },
  scanButton: { minHeight: 76, backgroundColor: colors.blue, marginTop: 23, padding: 13, flexDirection: "row", alignItems: "center", borderLeftWidth: 4, borderLeftColor: colors.cyan },
  scanGlyph: { width: 48, alignItems: "center", justifyContent: "center", marginRight: 8 },
  scanCopy: { flex: 1 },
  scanButtonText: { color: "white", fontSize: 13, fontWeight: "900", letterSpacing: 0.7 },
  scanButtonSub: { color: "#C6E1EE", fontSize: 9, marginTop: 3 },
  testHint: { color: "#789CB6", textAlign: "center", fontSize: 8, marginTop: 11 },
  buttonPressed: { opacity: 0.84, transform: [{ scale: 0.99 }] },
  buttonDisabled: { opacity: 0.45 },
  syncCard: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: 13, marginBottom: 24 },
  syncIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.paleGreen, alignItems: "center", justifyContent: "center", marginRight: 10 },
  syncIconOffline: { backgroundColor: colors.paleOrange },
  syncCopy: { flex: 1 },
  syncTitle: { color: colors.ink, fontSize: 11, fontWeight: "700" },
  syncText: { color: colors.muted, fontSize: 8.5, marginTop: 3 },
  pendingBadge: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.orange, alignItems: "center", justifyContent: "center" },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 9 },
  sectionTitle: { color: colors.muted, fontSize: 8.5, fontWeight: "900", letterSpacing: 1.2, marginVertical: 11 },
  sectionAction: { color: colors.blue, fontSize: 8, fontWeight: "900" },
  recentCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, marginBottom: 15 },
  observation: { minHeight: 66, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: "#EAEDEF" },
  observationLast: { borderBottomWidth: 0 },
  observationIcon: { width: 36, height: 36, backgroundColor: colors.paleBlue, alignItems: "center", justifyContent: "center", marginRight: 10 },
  observationCopy: { flex: 1 },
  observationTitle: { color: colors.ink, fontSize: 10.5, fontWeight: "700" },
  observationTime: { color: colors.muted, fontSize: 8, marginTop: 4 },
  emptyRecent: { minHeight: 120, alignItems: "center", justifyContent: "center", padding: 20 },
  emptyRecentTitle: { color: colors.ink, fontSize: 11, fontWeight: "700", marginTop: 8 },
  emptyRecentText: { color: colors.muted, fontSize: 9, marginTop: 3 },
  accuracyCard: { backgroundColor: colors.paleBlue, borderLeftWidth: 3, borderLeftColor: colors.cyan, padding: 13, flexDirection: "row" },
  accuracyIcon: { width: 34, height: 34, backgroundColor: "white", alignItems: "center", justifyContent: "center", marginRight: 10 },
  accuracyCopy: { flex: 1 },
  accuracyTitle: { color: colors.blue, fontSize: 10, fontWeight: "800" },
  accuracyText: { color: "#657986", fontSize: 8.5, lineHeight: 13, marginTop: 3 },
  bottomNav: { position: "absolute", left: 0, right: 0, bottom: 0, height: 70, flexDirection: "row", backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line, paddingBottom: Platform.OS === "ios" ? 8 : 0 },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
  navItemActive: { backgroundColor: "#F7FAFC" },
  navLabel: { color: "#788692", fontSize: 8, fontWeight: "700" },
  navLabelActive: { color: colors.blue, fontWeight: "900" },
  navBadge: { position: "absolute", right: -9, top: -6, minWidth: 15, height: 15, borderRadius: 8, backgroundColor: colors.orange, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  pageEyebrow: { color: colors.blue, fontSize: 9, fontWeight: "900", letterSpacing: 1.5, marginTop: 8 },
  pageTitle: { color: colors.ink, fontSize: 29, fontWeight: "800", letterSpacing: -0.8, marginTop: 6 },
  pageDescription: { color: colors.muted, fontSize: 11, marginTop: 5, marginBottom: 20 },
  activitySummary: { flexDirection: "row", backgroundColor: colors.navy, paddingVertical: 20, marginBottom: 15 },
  summaryItem: { flex: 1 },
  summaryValue: { color: "white", fontSize: 25, fontWeight: "800", textAlign: "center" },
  summaryLabel: { color: "#7FA8C2", fontSize: 7, fontWeight: "900", letterSpacing: 1, marginTop: 3, textAlign: "center" },
  settingsCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, marginBottom: 18 },
  settingRow: { minHeight: 70, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: "#E9EDEF" },
  settingIcon: { width: 36, height: 36, backgroundColor: colors.paleBlue, alignItems: "center", justifyContent: "center", marginRight: 10 },
  settingCopy: { flex: 1 },
  settingTitle: { color: colors.ink, fontSize: 10.5, fontWeight: "700" },
  settingSubtitle: { color: colors.muted, fontSize: 8.5, marginTop: 3 },
  retryText: { color: colors.blue, fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
  prototypeNotice: { backgroundColor: colors.paleOrange, borderLeftWidth: 3, borderLeftColor: colors.orange, padding: 13, flexDirection: "row", gap: 10 },
  modalSafe: { flex: 1, backgroundColor: colors.canvas },
  workflowHeader: { height: 62, paddingHorizontal: 14, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.line },
  workflowHeaderButton: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  workflowHeaderTitle: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  progress: { height: 3, backgroundColor: "#DCE4E9" },
  progressFill: { height: 3, backgroundColor: colors.cyan },
  workflowContent: { flexGrow: 1, padding: 20, maxWidth: 600, width: "100%", alignSelf: "center" },
  step: { width: "100%" },
  stepEyebrow: { color: colors.blue, fontSize: 8.5, fontWeight: "900", letterSpacing: 1.4, marginTop: 5 },
  stepTitle: { color: colors.ink, fontSize: 27, fontWeight: "800", letterSpacing: -0.7, marginTop: 7 },
  stepText: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 6, marginBottom: 22 },
  scanFrame: { height: 225, borderWidth: 1, borderColor: "#D2DCE3", backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", marginBottom: 22, position: "relative", overflow: "hidden" },
  scanCornerA: { position: "absolute", left: 22, top: 22, width: 35, height: 35, borderLeftWidth: 3, borderTopWidth: 3, borderColor: colors.cyan },
  scanCornerB: { position: "absolute", right: 22, top: 22, width: 35, height: 35, borderRightWidth: 3, borderTopWidth: 3, borderColor: colors.cyan },
  scanCornerC: { position: "absolute", left: 22, bottom: 22, width: 35, height: 35, borderLeftWidth: 3, borderBottomWidth: 3, borderColor: colors.cyan },
  scanCornerD: { position: "absolute", right: 22, bottom: 22, width: 35, height: 35, borderRightWidth: 3, borderBottomWidth: 3, borderColor: colors.cyan },
  scanLine: { position: "absolute", left: 42, right: 42, top: "51%", height: 2, backgroundColor: colors.cyan, opacity: 0.75 },
  orRow: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 12 },
  labelInput: { height: 52, backgroundColor: colors.surface, borderWidth: 1, borderColor: "#BFCBD3", paddingHorizontal: 15, color: colors.ink, fontSize: 15, fontWeight: "700", marginBottom: 13 },
  noteInput: { minHeight: 80, textAlignVertical: "top", paddingTop: 14, fontSize: 12, fontWeight: "400" },
  primaryButton: { minHeight: 53, backgroundColor: colors.blue, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, paddingHorizontal: 18 },
  primaryButtonText: { color: "white", fontSize: 11, fontWeight: "900", letterSpacing: 0.8 },
  testLabelButton: { alignItems: "center", padding: 15 },
  scannedContainer: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: 13, marginBottom: 17 },
  scannedIcon: { width: 39, height: 39, backgroundColor: colors.paleBlue, alignItems: "center", justifyContent: "center", marginRight: 11 },
  scannedLabel: { color: colors.ink, fontSize: 17, fontWeight: "800" },
  scannedType: { color: colors.muted, fontSize: 7.5, letterSpacing: 0.8, marginTop: 3 },
  actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  actionCard: { width: "48.5%", minHeight: 158, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: 15 },
  actionCardPressed: { borderColor: colors.blue, backgroundColor: "#F6FBFE" },
  actionIcon: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  actionTitle: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  actionText: { color: colors.muted, fontSize: 8.5, marginTop: 4, marginBottom: 12, flex: 1 },
  fieldLabel: { color: colors.muted, fontSize: 8, fontWeight: "900", letterSpacing: 1.1, marginBottom: 8, marginTop: 7 },
  choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 18 },
  choice: { paddingVertical: 11, paddingHorizontal: 15, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  choiceActive: { backgroundColor: colors.blue, borderColor: colors.blue },
  choiceText: { color: colors.ink, fontSize: 10, fontWeight: "700" },
  choiceTextActive: { color: "white" },
  destination: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: 13, marginBottom: 9 },
  destinationActive: { borderColor: colors.blue, backgroundColor: "#F7FBFE" },
  destinationIcon: { width: 38, height: 38, backgroundColor: colors.paleBlue, alignItems: "center", justifyContent: "center", marginRight: 10 },
  destinationCopy: { flex: 1 },
  destinationTitle: { color: colors.ink, fontSize: 11, fontWeight: "700" },
  destinationText: { color: colors.muted, fontSize: 8, textTransform: "capitalize", marginTop: 3 },
  confirmCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 15, marginBottom: 14 },
  confirmRow: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: "#E8ECEF", gap: 20 },
  confirmRowLast: { borderBottomWidth: 0 },
  confirmLabel: { color: colors.muted, fontSize: 9.5 },
  confirmValue: { color: colors.ink, fontSize: 10.5, fontWeight: "700", textAlign: "right", flex: 1 },
  auditNotice: { backgroundColor: colors.paleBlue, borderLeftWidth: 3, borderLeftColor: colors.cyan, padding: 13, flexDirection: "row", gap: 10, marginBottom: 17 },
  successStep: { alignItems: "center", paddingTop: 34 },
  successIcon: { width: 82, height: 82, borderRadius: 41, backgroundColor: colors.green, alignItems: "center", justifyContent: "center", marginBottom: 22 },
  successEyebrow: { color: colors.green, fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  successTitle: { color: colors.ink, fontSize: 28, fontWeight: "800", letterSpacing: -0.8, marginTop: 7 },
  successText: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: "center", maxWidth: 360, marginTop: 7, marginBottom: 22 },
  loadCodeBox: { width: "100%", backgroundColor: colors.navy, padding: 20, alignItems: "center", marginBottom: 18 },
  loadCodeLabel: { color: "#78BBD7", fontSize: 8, fontWeight: "900", letterSpacing: 1.3 },
  loadCodeValue: { color: "white", fontSize: 28, fontWeight: "900", letterSpacing: 0.5, marginVertical: 9 },
  loadCodeHelp: { color: "#AFC7D7", fontSize: 9 },
  anotherButton: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  wideNav: { width: 235, backgroundColor: colors.navy, padding: 22 },
  wideNavLocation: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#274B69", paddingVertical: 18, marginTop: 25 },
  wideNavLocationName: { color: "white", fontSize: 12, fontWeight: "700", marginTop: 4 },
  wideNavItems: { marginTop: 18 },
  wideNavFoot: { marginTop: "auto", flexDirection: "row", alignItems: "center", gap: 7 },
});
