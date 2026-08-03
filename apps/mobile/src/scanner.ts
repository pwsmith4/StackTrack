export interface ScanObservation {
  readonly rawValue: string;
  readonly symbology?: string;
  readonly observedAt: string;
}

export type ScanListener = (observation: ScanObservation) => void;

export type ScannerAdapterKind = "keyboard_wedge" | "unitech_intent";

export interface ScannerAdapter {
  readonly kind: ScannerAdapterKind;
  start(listener: ScanListener): Promise<void>;
  stop(): Promise<void>;
}

export function normalizeScan(rawValue: string): string {
  return rawValue.trim();
}

abstract class PushScannerAdapter implements ScannerAdapter {
  protected listener: ScanListener | null = null;
  protected started = false;

  public constructor(public readonly kind: ScannerAdapterKind) {}

  public async start(listener: ScanListener): Promise<void> {
    this.listener = listener;
    this.started = true;
  }

  public async stop(): Promise<void> {
    this.started = false;
    this.listener = null;
  }

  protected emit(rawValue: string, symbology?: string): void {
    const normalized = normalizeScan(rawValue);
    if (!this.started || !normalized || !this.listener) return;
    this.listener({
      rawValue: normalized,
      ...(symbology ? { symbology } : {}),
      observedAt: new Date().toISOString()
    });
  }
}

/**
 * Adapter for handheld scanners configured as a keyboard wedge. The native
 * input layer can call `feed` when it receives a completed barcode. Keeping
 * this seam separate lets the pilot use typed labels while the Unitech model
 * is being confirmed.
 */
export class KeyboardWedgeScannerAdapter extends PushScannerAdapter {
  public constructor() {
    super("keyboard_wedge");
  }

  public feed(rawValue: string, symbology?: string): void {
    this.emit(rawValue, symbology);
  }
}

/**
 * Adapter for Unitech Android intent broadcasts. The Android bridge should
 * pass the intent's decoded value to `handleIntent`; StackTrack does not guess
 * at a vendor SDK or silently accept arbitrary broadcast actions.
 */
export class UnitechIntentScannerAdapter extends PushScannerAdapter {
  public constructor() {
    super("unitech_intent");
  }

  public handleIntent(rawValue: string, symbology?: string): void {
    this.emit(rawValue, symbology);
  }
}

export function createScannerAdapter(kind: ScannerAdapterKind): ScannerAdapter {
  return kind === "unitech_intent"
    ? new UnitechIntentScannerAdapter()
    : new KeyboardWedgeScannerAdapter();
}
