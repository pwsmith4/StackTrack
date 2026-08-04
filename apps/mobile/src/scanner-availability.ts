/**
 * A scanner may continue capturing when the approved container list is
 * temporarily unavailable. The server will validate those labels when the
 * device reconnects. Only an explicit administrative stop, a denied role, or
 * an unresolved assignment blocks a new capture.
 */
export interface ScannerAvailabilityInput {
  readonly scannerEnabled: boolean;
  readonly recordingAllowed: boolean;
  readonly referenceDataReady: boolean;
  readonly assignmentResolved: boolean;
}

export function canStartScanner(input: ScannerAvailabilityInput): boolean {
  if (!input.scannerEnabled || !input.recordingAllowed) return false;
  return input.referenceDataReady || input.assignmentResolved;
}
