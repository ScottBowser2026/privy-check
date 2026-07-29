# Privy Check

Multi-site privy (restroom) condition tracker for PARF / SRF / KRF / GARF, built on the standard Lancelot tracker architecture.

## Current state (scaffold — v1)

- **Firebase**: Uses the existing `faire-food-qc` project, pointed at the separate `privy-check` Realtime Database instance (`https://privy-check.firebaseio.com`). Shares the project's Web App config; data is fully isolated in its own database instance.
- **PIN login**: 4-digit PIN screen matching QC Tracker's layout. Looks up `/users` by PIN, checks `active` flag, routes to role-based dashboard.
- **Roles implemented (routing only, no data binding yet)**:
  - Superadmin — all sites, sees Pre-Event / During-Event / Closing / Out-of-Order / Admin Panel tabs
  - Super User — site-scoped, same tabs as Superadmin minus cross-site view
  - User (attendant) — Pre-Event / During-Event / Closing / Flag a Unit
  - Maintenance — Flagged Units only (minimal view)
- **Site selector**: Superadmin gets "All Sites" + individual sites; other roles locked to their assigned site.
- **Tab content**: currently placeholder shells — real data binding (task lists, unit checklists, photo upload, out-of-order flagging + SMS) comes in the next build pass.

## Not yet built

- `/users` records (need to be bootstrapped manually in Firebase console for first Superadmin, per standard process)
- Task list CRUD (Pre-Event / During-Event / Closing) and CSV unit import
- Condition check flow with photo upload (Firebase Storage, path convention: `/privy-check/{site}/{unitId}/...`)
- Out-of-order flagging flow with suggested-reason typeahead + free text, and status changes
- Cloud Function: SMS to maintenance tech on out-of-order flag, via existing Twilio toll-free number (+1 833 749-1031) — pending Twilio Account SID / Auth Token
- Firebase security rules for the `privy-check` database (currently locked / deny-all)
- Admin Panel: unit management, task list editor, user management, maintenance recipient list per site
- GitHub repo + Cloudflare custom domain (privycheck.lancelotbiz.com or similar)

## Data structure (planned)

```
/users/{uid}: { firstName, lastName, email, phone, pin, role, site, active }
/sites/{siteId}/units/{unitId}: { name, zone, status, notes }
/sites/{siteId}/taskLists/{preEvent|duringEvent|closing}/{taskId}: { text, order }
/sites/{siteId}/checks/{checkId}: { unitId, type, completedBy, timestamp, photoURL, notes }
/sites/{siteId}/outOfOrder/{flagId}: { unitId, reason, notes, flaggedBy, timestamp, status, photoURL, resolvedBy, resolvedAt }
/outOfOrderReasons: [ ... suggested reasons, editable by Superadmin ]
```

## Suggested out-of-order reasons (default list, editable later)

1. Clogged / won't flush
2. No running water
3. No power / lights out
4. Door lock broken
5. Overflow / sewage backup
6. Structural damage
7. Vandalism
8. Out of supplies (TP/soap/towels)
9. Severe odor / sewage smell
10. Locked / inaccessible
11. Ventilation/HVAC issue
12. Other (free text)
