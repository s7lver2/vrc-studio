import { useEffect, useState } from 'react'

// ── Lanyard types ─────────────────────────────────────────────
interface LanyardActivity {
  name: string
  details?: string
  state?: string
  type: number
}

interface LanyardData {
  discord_status: 'online' | 'idle' | 'dnd' | 'offline'
  activities: LanyardActivity[]
  discord_user: {
    username: string
    global_name: string | null
    avatar: string | null
    id: string
  }
}

// ── IDs stored as base64 (same as app) ────────────────────────
function decodeId(b64: string): string {
  try { return atob(b64) } catch { return '' }
}

interface CreatorDef {
  discordIdB64: string
  fallbackName: string
  fallbackAvatar: string
  role: string
  github?: string
}

interface CollaboratorDef {
  name: string
  role: string
  discordIdB64?: string
}

const CREATORS: CreatorDef[] = [
  {
    discordIdB64:   'MTAyMzYyODY0NDIxMzU4Nzk5OA==',
    fallbackName:   's7lver',
    fallbackAvatar: 'https://github.com/s7lver.png',
    role:           'Lead developer & designer · VRC Studio',
    github:         'https://github.com/s7lver',
  },
  {
    discordIdB64:   'MTE1MjkzMTU4MjU2NzUyNjQzMQ==',
    fallbackName:   'Reokiy',
    fallbackAvatar: 'https://ui-avatars.com/api/?name=Reokiy&background=dc2626&color=fff&size=256',
    role:           'Emotional support · VRC Studio',
  },
]

const COLLABORATORS: CollaboratorDef[] = [
  { name: 'Panda',   role: 'Tester', discordIdB64: 'MTAxNzEyNzgwMDI5MDk1NTQ3NA==' },
  { name: 'Specu',   role: 'Tester', discordIdB64: 'MjQ5ODU3NjQ0Nzk2NDQ0Njcy' },
  { name: 'Mel',     role: 'Tester', discordIdB64: 'MzE3Mzg3NjgyNDYyNDMzMjgw' },
  { name: 'Pancake', role: 'Tester', discordIdB64: 'NzE3ODc1ODc0Mzg4NjM5Nzk0' },
]

// ── Lanyard WebSocket hook ────────────────────────────────────
function useLanyardStatus(discordId: string) {
  const [data, setData] = useState<LanyardData | null>(null)
  const [error, setError] = useState(false)
  const isPlaceholder = !discordId

  useEffect(() => {
    if (isPlaceholder) return
    let heartbeat: ReturnType<typeof setInterval>
    const ws = new WebSocket('wss://api.lanyard.rest/socket')

    ws.onopen = () =>
      ws.send(JSON.stringify({ op: 2, d: { subscribe_to_id: discordId } }))

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.op === 1)
        heartbeat = setInterval(() => ws.send(JSON.stringify({ op: 3 })), msg.d.heartbeat_interval)
      if (msg.op === 0 && msg.d) setData(msg.d)
    }

    ws.onerror = () => setError(true)
    ws.onclose = () => clearInterval(heartbeat)

    return () => { clearInterval(heartbeat); ws.close() }
  }, [discordId, isPlaceholder])

  return { data, error, isPlaceholder }
}

// ── Status helpers ────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  online:  '#22c55e',
  idle:    '#f59e0b',
  dnd:     '#ef4444',
  offline: '#52525b',
}
const STATUS_TEXT: Record<string, string> = {
  online:  'Online',
  idle:    'Idle',
  dnd:     'Do Not Disturb',
  offline: 'Offline',
}

function StatusDot({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? STATUS_COLOR.offline
  return (
    <span className="status-dot-wrap">
      {status === 'online' && <span className="status-ping" style={{ background: color }} />}
      <span className="status-dot" style={{ background: color }} />
    </span>
  )
}

// ── Creator card ──────────────────────────────────────────────
function CreatorCard({ creator }: { creator: CreatorDef }) {
  const discordId = decodeId(creator.discordIdB64)
  const { data: lanyard, error, isPlaceholder } = useLanyardStatus(discordId)

  const status      = lanyard?.discord_status ?? 'offline'
  const displayName = lanyard?.discord_user?.global_name
                   ?? lanyard?.discord_user?.username
                   ?? creator.fallbackName
  const avatarHash  = lanyard?.discord_user?.avatar
  const userId      = lanyard?.discord_user?.id ?? discordId

  const avatarUrl = avatarHash && !isPlaceholder
    ? `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.webp?size=256`
    : creator.fallbackAvatar

  const activity = lanyard?.activities?.find((a) => a.type !== 4)

  return (
    <div className="creator-card">
      <div className="creator-avatar-wrap">
        <img
          src={avatarUrl}
          alt={creator.fallbackName}
          className="creator-avatar"
          onError={(e) => {
            (e.target as HTMLImageElement).src =
              `https://ui-avatars.com/api/?name=${encodeURIComponent(creator.fallbackName)}&background=dc2626&color=fff&size=144`
          }}
        />
        {!isPlaceholder && (
          <span
            className="creator-status-badge"
            style={{ background: STATUS_COLOR[status] ?? STATUS_COLOR.offline }}
          />
        )}
      </div>

      <div className="creator-info">
        <div className="creator-name-row">
          <div className="creator-name">{isPlaceholder ? creator.fallbackName : displayName}</div>
          {!isPlaceholder && !error && (
            <div className="creator-status-pill">
              <StatusDot status={status} />
              <span className="creator-status-label">{STATUS_TEXT[status]}</span>
            </div>
          )}
        </div>

        <div className="creator-role">{creator.role}</div>

        {activity && (
          <p className="creator-activity">
            <span className="creator-activity-type">
              {activity.type === 0 ? 'Playing' : 'Listening to'}
            </span>
            {activity.name}
            {activity.details && <span className="creator-activity-detail"> — {activity.details}</span>}
          </p>
        )}

        <div className="creator-links">
          {creator.github && (
            <a
              href={creator.github}
              className="creator-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 98 96" fill="currentColor">
                <path fillRule="evenodd" clipRule="evenodd" d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"/>
              </svg>
              GitHub
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Collaborator chip ─────────────────────────────────────────
function CollaboratorChip({ collab }: { collab: CollaboratorDef }) {
  const discordId  = collab.discordIdB64 ? decodeId(collab.discordIdB64) : ''
  const hasDiscord = discordId !== ''
  const { data: lanyard, error } = useLanyardStatus(discordId)

  const status = hasDiscord && !error ? (lanyard?.discord_status ?? 'offline') : null
  const displayName =
    (hasDiscord && !error && (lanyard?.discord_user?.global_name ?? lanyard?.discord_user?.username))
    || collab.name

  const avatarHash = lanyard?.discord_user?.avatar
  const userId     = lanyard?.discord_user?.id ?? discordId

  const avatarUrl = hasDiscord && avatarHash
    ? `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.webp?size=64`
    : `https://ui-avatars.com/api/?name=${encodeURIComponent(collab.name)}&background=27272a&color=a1a1aa&size=64`

  return (
    <div className="contributor-chip" title={`${displayName} · ${collab.role}`}>
      <div className="collab-avatar-wrap">
        <img
          src={avatarUrl}
          alt={displayName}
          className="collab-avatar"
          onError={(e) => {
            (e.target as HTMLImageElement).src =
              `https://ui-avatars.com/api/?name=${encodeURIComponent(collab.name)}&background=27272a&color=a1a1aa&size=64`
          }}
        />
        {status && (
          <span
            className="collab-status-dot"
            style={{ background: STATUS_COLOR[status] ?? STATUS_COLOR.offline }}
          />
        )}
      </div>
      <span>{displayName}</span>
      <span className="role-tag">{collab.role}</span>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────
export default function Credits() {
  return (
    <div className="credits-section" id="credits">
      <div className="credits-inner">
        <div className="fade-up" style={{ textAlign: 'center' }}>
          <span className="section-tag">Credits</span>
          <h2 className="section-title">The people behind<br />VRC Studio.</h2>
          <p className="section-sub" style={{ margin: '20px auto 0' }}>
            Made with love for the VRChat creator community.
          </p>
        </div>

        <div className="creator-cards fade-up stagger">
          {CREATORS.map((c, i) => (
            <div key={c.discordIdB64} style={{ '--i': i } as React.CSSProperties}>
              <CreatorCard creator={c} />
            </div>
          ))}
        </div>

        <p className="contributors-header">Contributors</p>

        <div className="contributors fade-up stagger">
          {COLLABORATORS.map((c, i) => (
            <div key={c.name} style={{ '--i': i } as React.CSSProperties}>
              <CollaboratorChip collab={c} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
