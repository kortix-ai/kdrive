# Sign up and sign in with Google

KDRIVE shows a Google button on `/signin` ("Continue with Google") and on
`/signup` ("Sign up with Google") as soon as the API has a Google client id and
secret. The first Google sign-in creates the account. Later ones sign in to the
same account. This page covers the Google Cloud setup and the server settings.

## How it works

1. The browser asks the API (`POST /api/auth/sign-in/social`) for Google's
   authorize URL, then goes to Google.
2. Google sends the browser back to **`<BETTER_AUTH_URL>/api/auth/callback/google`**.
   The web app proxies `/api/*` to the API, so this URL is on the web origin,
   the same address you open KDRIVE at.
3. The API exchanges the code (with PKCE) and reads the name, email and
   `email_verified` claim from Google's ID token. Then one of these happens:
   - **New address:** the account is created with the email marked verified
     (when Google says it is verified) and a welcome mail goes out. The default
     drive is created on the first `GET /api/me`, which is when the app opens.
   - **Existing Google account:** the user is signed in.
   - **Existing password account with the same address:** Google is linked to
     that account only if Google verified the address *and* the account's
     address was already verified here. Otherwise the browser comes back with
     "This email already has a password account…". The owner signs in with the
     password, or resets it (a reset also verifies the address). After that,
     Google sign-in links on its own, or they can use Settings → Profile →
     Connect Google.
   - **Sign-ups not open** (`VOLUMES_SIGNUP_MODE=invite-only` or `closed`):
     an address that may not sign up is refused before anything is created.
     The page shows the same "Sign-ups are invite-only right now…" message as
     an email sign-up. Existing accounts always sign in.

The exact redirect URI the app sends is `BETTER_AUTH_URL` +
`/api/auth/callback/google`. Google compares it character for character with
the client's list: scheme, host, port, path, and no trailing slash.

| Where | `BETTER_AUTH_URL` | Redirect URI sent to Google |
|---|---|---|
| Local dev | `http://localhost:4100` | `http://localhost:4100/api/auth/callback/google` |
| Live server | `https://51-158-242-94.sslip.io` | `https://51-158-242-94.sslip.io/api/auth/callback/google` |

To check what your instance sends, run this with the app running. It does not
sign anyone in:

```bash
curl -s -X POST http://localhost:4100/api/auth/sign-in/social \
  -H 'origin: http://localhost:4100' -H 'content-type: application/json' \
  -d '{"provider":"google","callbackURL":"http://localhost:4100/drive"}' \
  | python3 -c 'import sys,json,urllib.parse as u; print(u.parse_qs(u.urlparse(json.load(sys.stdin)["url"]).query)["redirect_uri"][0])'
```

## 1. Google Cloud Console

Use one Google Cloud project for KDRIVE. One OAuth client can serve both local
dev and the live server, or you can create one client for each.

### Consent screen ("Google Auth Platform" → Branding / Audience / Data access)

1. Go to <https://console.cloud.google.com/auth/overview> (older consoles call
   this **APIs & Services → OAuth consent screen**). If it asks, click
   **Get started**.
2. **Branding:** set the app name to `KDRIVE` and a support email. Under
   **Authorized domains**, add the live server's domain (see the note on
   sslip.io below). `localhost` needs no entry.
3. **Audience:** choose **External** (any Google account), unless every user is
   in your own Google Workspace, in which case choose Internal.
4. **Data access (scopes):** KDRIVE asks only for `openid`, `email` and
   `profile`. These are non-sensitive scopes, so Google's app verification
   review is not needed for them.
5. **Publishing status:**
   - **Testing:** only the Google accounts listed under **Audience → Test
     users** can sign in (up to 100). Everyone else sees an "access blocked"
     error from Google. Add each tester's Gmail address here.
   - **In production:** click **Publish app** so any Google account can sign
     in. With only the three basic scopes this takes effect right away, with
     no review.

   KDRIVE's own sign-up mode still applies on top of this. With
   `VOLUMES_SIGNUP_MODE=invite-only`, a Google account that Google lets through
   must still be on `VOLUMES_SIGNUP_ALLOWLIST` (or `VOLUMES_ADMIN_EMAILS`) to
   create an account.

### OAuth client ("Clients" → Create client)

1. **Application type:** **Web application**. Do not choose Desktop, iOS or
   Android: the code exchange happens on our server with the client secret.
2. **Name:** for example `KDRIVE web`.
3. **Authorized JavaScript origins:**
   - `http://localhost:4100`
   - `https://51-158-242-94.sslip.io`
4. **Authorized redirect URIs:**
   - `http://localhost:4100/api/auth/callback/google`
   - `https://51-158-242-94.sslip.io/api/auth/callback/google`
5. Click **Create**, then copy the **Client ID** (`…apps.googleusercontent.com`)
   and the **Client secret** (`GOCSPX-…`). Newer consoles show the secret only
   once, so download the JSON or store the secret in a password manager.

To fix an existing client that fails with `Error 400: redirect_uri_mismatch`,
open it under **Clients** and add the two redirect URIs and origins above.
Google says changes can take five minutes, sometimes longer, to apply.

Other local ports need their own entries. For example, a checkout on port 4600
with `BETTER_AUTH_URL=http://localhost:4600` sends
`http://localhost:4600/api/auth/callback/google`, which must be added too. Open
the app at `localhost`, not `127.0.0.1`: the origin must match `BETTER_AUTH_URL`
and the entries above.

**About sslip.io.** `51-158-242-94.sslip.io` is a wildcard DNS name that
resolves to the server's IP. Google accepts https redirect URIs on such
hostnames. Google refuses raw IP addresses, which is why the live server uses
the sslip.io name. However, the consent screen's **Authorized domains** wants a
domain you control. If the console will not accept `sslip.io` or
`51-158-242-94.sslip.io` there, or Google asks for domain verification before
you publish, point a real domain (for example `drive.example.com`) at the
server instead. Then change `BETTER_AUTH_URL` and the Caddy site to that
domain, and use it in the origins and redirect URIs above.

## 2. Local development

In `apps/api/.env` (git-ignored, never committed):

```bash
BETTER_AUTH_URL=http://localhost:4100
GOOGLE_CLIENT_ID=<client id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<client secret>
```

Then run `bun run dev` and open <http://localhost:4100/signup>. The API logs
`auth providers=google` at startup, and `GET /api/config` returns
`"providers":["google"]`. While the consent screen is in Testing, sign in with
an account listed as a test user.

## 3. Live server (Scaleway, systemd + Caddy)

On the server, edit `/etc/kdrive/kdrive.env` as root:

```bash
BETTER_AUTH_URL=https://51-158-242-94.sslip.io   # already set; must match the redirect URI exactly
GOOGLE_CLIENT_ID=<client id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<client secret>
# Who may create an account (Google sign-ups included):
#   open | invite-only (VOLUMES_SIGNUP_ALLOWLIST + admins) | closed (admins only)
VOLUMES_SIGNUP_MODE=invite-only
VOLUMES_SIGNUP_ALLOWLIST=ada@gmail.com,@example.com
```

Keep the file readable only by root and the service user (`chmod 600` or
`640`). Then restart both services and check:

```bash
sudo systemctl restart kdrive-api kdrive-web
journalctl -u kdrive-api -n 20 --no-pager | grep 'auth providers'   # → auth providers=google
curl -s https://51-158-242-94.sslip.io/api/config                    # → "providers":["google"]
```

Then open <https://51-158-242-94.sslip.io/signup> and click
**Sign up with Google**.

## Troubleshooting

| What you see | Cause and fix |
|---|---|
| No Google button | `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` is empty, or the API was not restarted. Check `/api/config`. |
| Google: `Error 400: redirect_uri_mismatch` | The redirect URI above is not in the client's **Authorized redirect URIs**, or `BETTER_AUTH_URL` is different from the address you opened (wrong port, `127.0.0.1`, http vs https, trailing slash). |
| Google: `Error 403: access_denied` / "has not completed the Google verification process" | The consent screen is in Testing and this account is not a test user. Add it, or publish the app. |
| Google: `invalid_client` / `unauthorized_client` | The client id or secret is wrong, or the client is not of type Web application. |
| KDRIVE: "Sign-ups are invite-only right now…" | `VOLUMES_SIGNUP_MODE` refused the address. Add it to `VOLUMES_SIGNUP_ALLOWLIST` (or set the mode to `open`), then restart the API. |
| KDRIVE: "This email already has a password account…" | A password account with this address exists but its address was never verified (or Google has not verified it). Sign in with the password or reset it, then use Google. |
| KDRIVE: "Sign-in failed. Try again." | Usually an expired or reused callback (the back button, or a slow consent screen). Start again from the page. The API log has the exact better-auth error. |
