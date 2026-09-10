---
name: customer-domains
description: rcity.co.il = customer company site (Cloudflare); dashboard production domain unknown; agency domain nf-digital.net
metadata: 
  node_type: memory
  type: reference
  originSessionId: 129a8761-8a7c-46b4-b284-caefc0d8abb1
  modified: 2026-07-30T15:45:06.285Z
---

- Customer (רהיטי הסיטי) company domain: **rcity.co.il** — behind Cloudflare (104.21.x / 172.67.x). No `live/dashboard/calls/app/...` subdomains exist (checked 2026-07-30).
- **Dashboard production URL: https://zend-shirot.rc-info.org** (confirmed 2026-07-30). `rc-info.org` is on Hostinger nameservers (ns1/ns2.dns-parking.com), served via Hostinger CDN → LiteSpeed origin; see [[hosting-deploy-reality]].
- The user's agency domain: nf-digital.net (92.113.x hosting, used for other projects).
- App users' auth emails: mostly `@gmail.com`, one `@rcity.co.il`.
