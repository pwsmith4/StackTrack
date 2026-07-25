# Decision register

The baseline can proceed without these answers. Items marked **pilot gate** must be resolved before a live store handles real inventory.

| Decision | Current safe default | Needed by |
|---|---|---|
| Exact asset/container workflow | Four events from v8.3 specification | Pilot gate |
| Barcode format and ownership | Treat scan as opaque tenant-unique text | Hardware prototype |
| Load-code source and format | Allow internal UUID plus optional external reference | Pilot gate |
| Unitech device model and scanner integration | Scanner adapter with simulated/keyboard input | Hardware prototype |
| Employee identity on shared devices | Physical device identity only | Pilot gate |
| Device clock management | Warn over 10 minutes; review over 24 hours | Pilot gate |
| Offline conflict resolution | Preserve both; freeze ambiguous projection; admin review | Pilot gate |
| Routine correction authority | Store manager with mandatory reason | Pilot gate |
| Material correction authority | Corporate data steward; separate approver | Pilot gate |
| What counts as material | Location, processed percentage, post-reporting changes, conflict resolution | Pilot gate |
| Stale reference data limit | Accept with warning and review telemetry | Pilot gate |
| Pilot store and success measures | Not selected | Pilot planning |
| Peak scan volume and device count | Unknown; test above expected volume once measured | Load testing |
| Retention and recovery objectives | Keep event ledger indefinitely; decide backup RPO/RTO | Production gate |
| Entra groups and admin roles | Adapter only; no hard-coded tenant groups | Production gate |
| Support ownership outside developer availability | Goodwill IT/MSP owns first response | Contract gate |

## Questions to resolve during discovery

1. Walk through a container from empty through loading, transport, receipt, processing, and reuse. At which physical moment is each scan performed?
2. Which errors currently occur on paper, how often, and which cause financial or reporting consequences?
3. Can the same container legitimately be handled by two devices within a few minutes? If so, in which workflows?
4. What information makes an observation trustworthy: employee, device, location, photo, supervisor, or another system?
5. Which corrections can a store manager make, and which change already-reported corporate numbers?
6. Who is the named corporate data owner who decides ambiguous cases?
7. What are the actual barcode symbologies, label materials, damage rates, and scanning distances?
8. What existing system creates load codes, and is an API, file export, or manual scan available?
9. How many containers, scans per day, concurrent devices, and peak batch size exist at a busy store and warehouse?
10. What does a successful pilot mean in measurable terms: scan accuracy, reconciliation variance, time saved, sync delay, and adoption?

