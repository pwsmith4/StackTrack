# StackTrack discovery questions for Goodwill

These questions are ordered by when the answer affects implementation. Short or approximate answers are useful; the goal is to expose operational rules before software silently invents them.

## Needed for the next implementation phase

1. **Container labels:** Can you provide clear photos and the exact encoded value from at least one label of every container type? Are `B...`, `C...`, and any other prefixes globally unique and permanent?
2. **Container types:** What are the names and operational differences between every reusable-container type? Can every type follow the same workflow?
3. **Physical workflow:** For each container type, walk through one normal trip and state the exact physical moment when employees mark it full, send it out, receive it, and mark it empty.
4. **Allowed transitions:** Which shortcuts are legitimate—for example receive without send-out, empty without receive, partial processing, rerouting in transit, or refilling before the prior load is empty?
5. **Load-code ownership:** Which production system will ultimately own load codes? Can it expose an API or file feed, what exact format is required, and must codes be unique forever or only for a location/day?
6. **Load-code timing:** Should StackTrack create the code when a container is marked full, or reserve/validate a code from the production system first? When does a code expire?
7. **Conflicting scans:** If two devices report incompatible events, should “latest” mean the physical observation time, the server receipt time, or a manager-reviewed decision? Are there cases where the most recently received scan is known to be wrong?
8. **Shared-device identity:** Is recording only the physical device acceptable for the pilot, or must every scan identify the employee by badge, PIN, or Entra login?
9. **Target hardware:** What exact handheld model and Android version will be used? Does its scanner act like a keyboard, use an Android intent, or require a vendor SDK?
10. **Pilot locations:** Which two locations will test first, what location types are they, and which warehouse or destination will participate in their workflow?

## Needed before a two-location live pilot

11. **Correction authority:** Which changes can a store manager make with a required reason, and which require corporate approval? Who is the named corporate owner for unresolved data?
12. **Material corrections:** Does changing location, load code, goods type, processed quantity, or already-reported data count as a major correction?
13. **Offline expectation:** How often do devices lose connectivity, what is the longest realistic outage, and may multiple offline devices handle the same container during one outage?
14. **Network access:** Can pilot devices reach an Azure-hosted API over normal internet, or will Goodwill require VPN, private networking, certificates, or mobile-device-management configuration?
15. **Scale:** Approximate total containers, scans per day at a busy store and warehouse, devices per location, and the busiest expected synchronization burst.
16. **Reference-data owner:** Who maintains locations, devices, container types, goods types, and allowed classifications? How quickly must changes reach offline devices?
17. **Reports:** Which daily or weekly reports are required, who receives them, and what totals must reconcile with the production system?
18. **Pilot success:** What measurable result decides whether the pilot succeeds—scan accuracy, fewer missing containers, reconciliation variance, time saved, sync delay, or employee adoption?
19. **Support:** Who at Goodwill IT handles device/network issues and first-response support when the developer is unavailable?

## Needed before production architecture is finalized

20. **Microsoft environment:** Which Azure subscription, tenant, region, and naming/tagging standards must the project use?
21. **Authentication:** Which Microsoft Entra groups map to employee, store-manager, corporate-reviewer, administrator, and read-only roles?
22. **Data location and analytics:** Is Microsoft Fabric/Data Lake already in use? If so, who owns the workspace and what exact files or tables should StackTrack publish?
23. **Retention:** How long must immutable scan history, correction evidence, audit logs, and exports be retained?
24. **Recovery targets:** After a failure, how much data loss is acceptable (RPO) and how quickly must service return (RTO)?
25. **Security review:** What Goodwill security, privacy, penetration-testing, logging, and vendor-review requirements apply?
26. **Environments:** Does Goodwill require separate development, test, pilot, and production subscriptions or resource groups?
27. **Deployment ownership:** Who approves releases, provisions handhelds, rotates credentials, monitors alerts, and owns cloud costs after go-live?
