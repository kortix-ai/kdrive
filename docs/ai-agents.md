# Connect an AI agent

KDRIVE is an MCP server. Any agent or client that speaks the Model Context
Protocol over Streamable HTTP can read your drive and, if you allow it, change
it. Every change an agent makes is a version in the timeline, attributed to the
agent, and can be undone.

This page uses placeholders: `https://<your-kdrive-host>` is the web address
you open KDRIVE at, and `your-agent` is your client's own command.

## The MCP URL

```
https://<your-kdrive-host>/mcp
```

Settings → AI agents shows the exact URL for your server with a Copy button.
It is always the web origin plus `/mcp` (locally: `http://localhost:4100/mcp`).
The endpoint is stateless: every request is a `POST` with a bearer credential.
There are two ways to get one.

## Option 1: sign in with OAuth (recommended)

Add the server to your client with only the URL:

```json
{
  "mcpServers": {
    "kdrive": { "type": "http", "url": "https://<your-kdrive-host>/mcp" }
  }
}
```

or, for clients with a command line:

```bash
your-agent mcp add --transport http kdrive https://<your-kdrive-host>/mcp
```

On the first request the server answers `401` with a
`WWW-Authenticate: Bearer resource_metadata="…"` challenge. A compliant client
then:

1. reads `/.well-known/oauth-protected-resource` and the authorization server
   metadata at `/.well-known/oauth-authorization-server`;
2. registers itself (dynamic client registration; public clients only, PKCE
   S256 is required);
3. opens your browser at the sign-in page, then at the consent page.

On the consent page you choose what the app may do (see "Access and review
mode") and which workspace it may use. A new connection starts at "Suggest
changes"; picking more is up to you. The app receives a short-lived access
token for the `/mcp` resource and a refresh token.

Connected apps are listed under Settings → AI agents. "Change access…" lowers
an app's access or switches whether its changes wait for review;
"Disconnect" stops it on its next request. To give an app more access than it
has, disconnect it and connect again.

## Option 2: an agent token

For scripts and agents that cannot open a browser, create a token under
Settings → AI agents → New agent token. Choose a name, the access level, the
review mode, a workspace (or all of them) and an expiry (30 days, 90 days or
1 year).

The token looks like `vx_pat_<43 characters>` and is shown once. The dialog
does not close on a stray click; copy the token before you close it. Then send
it as a bearer token:

```json
{
  "mcpServers": {
    "kdrive": {
      "type": "http",
      "url": "https://<your-kdrive-host>/mcp",
      "headers": { "Authorization": "Bearer <your token>" }
    }
  }
}
```

Revoke a token from the same list; it stops working on the next request.
Never commit a token to a repository or paste it into a shared document.

## Access and review mode

| Access | What the agent can do |
|---|---|
| **Read only** (`drive:read`) | See files, folders, versions and history. |
| **Suggest changes** (`drive:propose`) | Read, and propose changes. Every change waits for your review. |
| **Make changes** (`drive:write`) | Read, and write, move and delete files. |

"Make changes" comes with a second choice, **when it changes files**:

- **Changes need my review**: each `write_changes` call becomes a proposal.
  Nothing in the drive changes until you accept it under Proposals. In this
  mode the agent has the same tools as "Suggest changes": it cannot restore,
  undo or save checkpoints.
- **Apply directly**: each call lands at once as one version, attributed to
  the agent, and can be undone. The agent can also save checkpoints, restore
  earlier versions and undo its changes.

### Reviewing proposals

Proposals lists what agents suggested. Open one to compare each file with what
the drive holds now, then accept or discard all of it, a selection, or one file
at a time. A change that builds on another one in the same proposal (a move of
a file the proposal adds) is accepted together with it. If someone changed a
file after the agent read it, the review says so; "Accept anyway" replaces the
newer change. Accepted changes land as one undoable version. Proposals expire
after 30 days.

## Tools

| Tool | Read | Suggest / review | Apply directly | What it does |
|---|:-:|:-:|:-:|---|
| `list_workspaces` | ✓ | ✓ | ✓ | The workspaces this connection may use. |
| `open_workspace` | ✓ | ✓ | ✓ | Head commit id, counts and a bounded manifest of paths. |
| `read_files` | ✓ | ✓ | ✓ | Metadata, folder entries and paged text (or base64) of files. |
| `search_files` | ✓ | ✓ | ✓ | Find files and folders by name. |
| `get_history` | ✓ | ✓ | ✓ | The timeline: versions, who made them and what they touched. |
| `file_versions` | ✓ | ✓ | ✓ | Every kept version of one file. |
| `diff` | ✓ | ✓ | ✓ | What changed between two versions, with small text diffs. |
| `get_links` | ✓ | ✓ | ✓ | Browser links to paths and proposals. |
| `write_changes` | | ✓ | ✓ | One ordered batch of write, mkdir, move, copy and delete. |
| `list_proposals` | | ✓ | ✓ | Whether you accepted or discarded the agent's proposals. |
| `create_checkpoint` | | | ✓ | Save a named version that is kept until you remove it. |
| `restore` | | | ✓ | Bring files, folders or the drive back to an earlier version. |
| `undo` | | | ✓ | Undo one change (by default the connection's latest). |

Versions are named by a commit id (`vc_…`) from `open_workspace`,
`read_files`, `get_history` or `file_versions`, or by a checkpoint's name.
`write_changes` needs the commit id the agent read as `last_seen_commit_id`:
if someone changed the same files since, the call is refused with the
conflicting paths and the agent re-reads and merges instead of overwriting.

## Limits

- `write_changes`: 200 ops, 10 MiB per file and 24 MiB per call.
- `read_files`: 50 paths and up to 1 MiB of text per call; folder listings
  return at most 1,000 entries per call (page one folder with `offset`).
- Requests: 120 a minute per token or connected app (burst 60), and 30
  `write_changes` calls a minute. Failed sign-ins are limited per address.
- Proposals: 50 open at a time and 256 MiB of staged content.
- Writes count against your storage quota like any upload.

## For operators

- `VOLUMES_MCP_ENABLED=0` turns off `/mcp` and the OAuth discovery documents.
- `VOLUMES_MCP_ORIGINS` adds browser origins allowed to call `/mcp` (native
  clients send no `Origin` and are not affected).
- All URLs derive from `BETTER_AUTH_URL`, the public web origin. Put the web
  app behind HTTPS so tokens never travel in the clear.
