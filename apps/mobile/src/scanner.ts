export interface ScanObservation {
  readonly rawValue: string;
  readonly symbology?: string;
  readonly observedAt: string;
}

export type ScanListener = (observation: ScanObservation) => void;

export interface ScannerAdapter {
  start(listener: ScanListener): Promise<void>;
  stop(): Promise<void>;
}

export function normalizeScan(rawValue: string): string {
  return rawValue.trim();
}

