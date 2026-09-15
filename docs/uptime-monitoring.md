# Uptime monitoring — batmatch.app

External uptime monitoring via **UptimeRobot**, alerting via **mobile app push**.

## Why external

The June 2026 outage was a Cloudflare **521**: the app (`ezebat.lan:3000`) and the
reverse proxy (`172.16.88.251`, openresty/NPM) both returned `200` the whole time —
the break was the router no longer forwarding WAN `:443` to the proxy, visible **only
from the public internet**. Any monitor inside the LAN would have seen everything as
healthy. So the monitor must run on UptimeRobot's external probes, hitting the public
URL through Cloudflare.

## Current state (as configured)

A monitor for batmatch.app **already exists** on the UptimeRobot account
(`edd.bkk@gmail.com`):

| Field        | Value                                  |
| ------------ | -------------------------------------- |
| Monitor id   | `803345487`                            |
| Type         | HTTP(s) (`type=1`)                      |
| URL          | `https://batmatch.app`                 |
| Interval     | 300 s (5 min — free-tier floor)        |
| Down when    | non-2xx / timeout / SSL failure (catches the `521`) |
| Alert via    | Mobile app push contact `6562657` (type 13) |

An HTTP monitor flags the `521` outage (any non-2xx = down). It does **not** catch a
"loads but broken" 200 — that needs a **Keyword** monitor, which is a **paid** UptimeRobot
feature on the current plan (see Limitations).

## Free-plan API limitations (verified 2026-06-21)

- **Monitor creation via the v2 API is blocked** (`newMonitor` → `access_denied`),
  even for a bare HTTP monitor. New monitors must be created in the dashboard/app UI.
- **Keyword monitors** (`type=2`) and **sub-5-min intervals** are paid-only.
- `editMonitor`, `getMonitors`, `getAlertContacts` **do** work with the Main API key.

## Verifying / managing alerting

The Main API key (`u…`, from **My Settings → API**) is write-capable; it is **not**
stored in this repo. Export it for the commands below:

```bash
export UR_API_KEY='u…'
```

### Confirm push delivery (the real completion step — do this in the app/UI)

Monitoring being "configured" is not the same as alerts reaching your phone. Verify it:

1. Install the **UptimeRobot mobile app** and log in (this registers/activates the
   push device for contact `6562657`).
2. In the app or dashboard → that alert contact → **Send test notification**.
3. Confirm the push actually lands on the phone. Until it does, alerting is unverified.

### Inspect the monitor and its contacts

```bash
curl -s -X POST https://api.uptimerobot.com/v2/getMonitors \
  -d "api_key=$UR_API_KEY" -d 'format=json' \
  -d 'monitors=803345487' -d 'alert_contacts=1' | jq '.monitors[0] | {interval, status, alert_contacts}'

curl -s -X POST https://api.uptimerobot.com/v2/getAlertContacts \
  -d "api_key=$UR_API_KEY" -d 'format=json' | jq '.alert_contacts[] | {id, type, status, value}'
```

Alert-contact `status`: `0` not activated, `1` paused, `2` active. Only active
contacts deliver. (Manage these in the dashboard, not via API.)

### Change which contacts a monitor alerts (API)

`editMonitor` **replaces the entire contact set** — always pass every contact you want
to keep, or you will silently drop one. Format: `id_threshold_recurrence`, joined by `-`.

```bash
# Example: app-push (6562657) + active email (01206934) as a backup
curl -s -X POST https://api.uptimerobot.com/v2/editMonitor \
  -d "api_key=$UR_API_KEY" -d 'format=json' \
  -d 'id=803345487' \
  -d 'alert_contacts=6562657_0_0-01206934_0_0' | jq
```

## Notes

- Free tier: 5-min interval → detection lag up to ~5 min.
- Optional future add-on: a second signal (origin heartbeat) to distinguish
  "inbound path broke" from "app died". Not currently configured.
