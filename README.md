# taka-server-resident

Backend for the Taka resident sign-up flow used by the Expo app in `../taka-app-resident`.

TypeScript + [Hono](https://hono.dev) + Prisma/Neon Postgres + Zod, deployed to Vercel as a
serverless function. Images are uploaded straight to Cloudflare R2 using presigned PUT URLs.

## Endpoints

All routes are served under `/api/v1`.

| Method | Path | Auth | Body | Response |
| --- | --- | --- | --- | --- |
| POST | `/auth/otp/request` | — | `{ phone }` | `{ expires_in, resend_after, dev_code? }` |
| POST | `/auth/otp/verify` | — | `{ phone, code }` | `{ verification_token, expires_in }` |
| POST | `/auth/register-resident` | Bearer verification token | `ResidentPayload` | `{ token?, status, user }` |
| POST | `/auth/register-reporter` | Bearer verification token | `ReporterPayload` | `{ token?, status, user }` |
| POST | `/auth/register-commercial` | Bearer verification token | `CommercialPayload` | `{ token?, status, user }` |
| POST | `/uploads/presign` | Bearer verification **or** access token | `{ purpose, content_type }` | `{ uploadUrl, publicUrl, key }` |
| PATCH | `/users/me` | Bearer access token | `{ picture_url }` | `{ status, user }` |
| POST | `/luku/lookup` | Bearer verification token | `{ luku_meter }` | `{ luku_meter, utility_code, status, active, owner_name, reason, checked_at }` |
| GET | `/health` | — | — | `{ status, time }` |

Errors always use `{ message, errors? }`, where `errors` is keyed by payload field name. This is
what the app's `ApiError.fieldErrors` reads.

### Token flow

1. `otp/verify` returns a short-lived **verification token** (subject = phone).
2. That token is sent as `Authorization: Bearer …` to `uploads/presign` **and** to `register-*`.
3. `register-*` returns a long-lived **access token** (subject = user id), which the app stores.

When `REGISTRATION_AUTO_APPROVE=false` the register response omits `token` and reports
`status: "PENDING"`, which drives the app's pending-approval screen.

## Local development

```bash
cp .env.example .env.local   # fill in the values
pnpm install                 # runs prisma generate via postinstall
pnpm prisma:migrate          # create/apply migrations against your Neon dev branch
pnpm dev                     # http://localhost:3000
```

`http://localhost:3000` is the default base URL of the app client
(`taka-app-resident/src/api/client.ts`), so no app-side config is needed for local work.

Editing `.env` does not affect a running server: `pnpm dev` reads the file once at startup,
and `tsx watch` reloads on source changes only. Stop and start the process after changing a
variable, then check the `otp:` line printed at boot to confirm the values in use.

### OTP delivery

Codes are delivered by [Africa's Talking](https://africastalking.com). Set
`OTP_PROVIDER=africastalking` and provide `AT_USERNAME` and `AT_API_KEY`; `AT_SENDER_ID`
is optional and falls back to the shared shortcode. The adapter lives in
`src/lib/providers/africastalking.ts` and implements the `OtpProvider` interface in
`src/lib/otp.ts`.

The sandbox is free and simulates delivery: use `AT_USERNAME=sandbox` with a sandbox API
key, keep `AT_SMS_ENDPOINT` on `https://api.sandbox.africastalking.com/version1/messaging`,
and add your test numbers in the Africa's Talking dashboard first. For production set
`AT_USERNAME` to your account username and point `AT_SMS_ENDPOINT` at
`https://api.africastalking.com/version1/messaging`. Environment validation refuses to
start if the sandbox host is used while `NODE_ENV` is `production`.

`OTP_PROVIDER=log` (the default) sends nothing and writes the code to the server log
instead; it exists for tests and offline work. `OTP_MESSAGE_TEMPLATE` controls the
message text and supports `{{code}}` and `{{minutes}}`.

`OTP_DEV_MODE=true` additionally echoes the code as `dev_code` in the `otp/request`
response and accepts the fixed `OTP_DEV_CODE` (default `000000`) at `otp/verify`.
Environment validation refuses to start when `OTP_DEV_MODE=true` and `NODE_ENV` is
`production`.

When the provider rejects a send, the challenge row is deleted and the request returns
`503`, so no unusable code is left behind and the resend cooldown is not tripped. Stale
challenges are pruned on each request according to `OTP_RETENTION_SECONDS`.

### Uploads without R2

If the `R2_*` variables are empty, `presign` responds `503 File storage is not configured`.
Everything else keeps working, so you can develop the sign-up flow except the photo step.

### LUKU meter lookups

`POST /luku/lookup` confirms a LUKU meter before a resident saves it to their profile:
who the meter is registered to, and whether it is live. It is gated on the verification
token, so the app calls it after `otp/verify` and before `register-resident`.

It is a thin wrapper over nTZS's `POST /api/v1/lookup/merchant-name` with
`{ kind: "bill", utilityCode: "LUKU", utilityRef: <meter> }` — see
<https://www.ntzs.co.tz/developers#lookup>. Only the meter is sent: nTZS also accepts an
optional `amountTzs`, because biller validation is amount-aware, but a registration-time
owner check has no amount to offer, so that field belongs on the bill-payment quote
instead. Both failure and success cases are described in `src/lib/providers/ntzs.ts`.

The response reports one of three states, because nTZS never exposes a plain "active"
flag and `name: null` is explicitly **not** an error — a slow or down utility and an
unregistered meter look identical from outside:

| `status` | `active` | `owner_name` | Meaning |
| --- | --- | --- | --- |
| `active` | `true` | set | The utility returned a registered owner: the meter is real and live. |
| `rejected` | `false` | `null` | The utility answered and refused the reference (`reason` carries its result code). |
| `unconfirmed` | `null` | `null` | No answer — utility slow, down, or `lookup_unavailable`. Never block the resident on this. |

Anything unrecognised is reported as `unconfirmed`: a diagnostic we cannot interpret must
never be rendered to a resident as "your meter is inactive". `reason` is the raw upstream
string, kept for support tickets and not meant to be displayed.

Notes for callers and deployment:

- The enquiry is forwarded to the utility and can take **~25s**. Debounce — never call it
  per keystroke — and show a spinner. `vercel.json` raises the function's `maxDuration` to
  60s so the request is not killed mid-enquiry and returned as a 504.
- nTZS rate limits lookups to 60/min per partner and audits every one, so the endpoint
  must stay behind the verification token; a `429` is passed through when the limit is hit.
- `ntzs_live_…` keys make real enquiries (audited, rate limited, nothing charged).
  `ntzs_test_…` keys answer instantly with deterministic placeholder names, no upstream
  call and no quota — use one locally, then swap in the live key for production. Environment
  validation refuses to start with a test key while `NODE_ENV` is `production`.
- The meter is checked locally first: a value that is not 11 digits is rejected with a
  field-level `400` before any upstream call is made.
- If `NTZS_API_KEY` is empty the route answers `503 Meter lookups are not configured on
  this server.` Everything else keeps working, so the rest of the sign-up flow can be
  developed without nTZS credentials.

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Local server with reload |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest suite |
| `pnpm prisma:migrate` | Create/apply a dev migration |
| `pnpm prisma:deploy` | Apply migrations in CI/Vercel |
| `pnpm build` | `prisma generate` (used by Vercel) |

## Database

- `DATABASE_URL` — Neon **pooled** connection string, used at runtime.
- `DIRECT_URL` — Neon **direct** connection string, used only by `prisma migrate`.

Migrations are committed under `prisma/migrations`. Apply them in CI or with
`pnpm prisma:deploy` before promoting a deployment.

## Deploying to Vercel

1. Create the project from this repository and set the root directory to it.
2. Add every variable from `.env.example` to each environment (Development, Preview,
   Production) in the Vercel dashboard.
3. Deploy. `vercel.json` rewrites all paths to `api/index.ts`, which wraps the Hono app with
   the Vercel adapter on the Node.js runtime (Prisma does not support the Edge runtime).
4. Point the app at the deployment with `EXPO_PUBLIC_API_URL` in `taka-app-resident`.

### Postgres

`User.phone`, `ResidentProfile.lukuMeter`, and `CommercialProfile.taxId` are unique. Violations
come back as `409` with `errors` keyed to the offending field. `CommercialProfile.wasteTier` is
stored as a string because the tier list is still provisional — finalise it before production.

## Testing

The suite covers JWT behaviour, OTP hashing and comparison, payload schemas, and the route
guards (auth, validation, phone/token match) using Hono's `app.request()` — no database or
bucket required.

## Not yet implemented

- Login, refresh, and passwordless sessions for existing users.
- Rate limiting beyond the DB-backed resend cooldown (serverless instances do not share memory).
- Delivery-receipt handling and sender ID management for Africa's Talking.
- Integration with `taka-ai` (Python service on Koyeb).
