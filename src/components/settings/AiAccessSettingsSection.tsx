'use client'

import { useState } from 'react'
import { ConfirmPanel } from '@/components/ui/ConfirmPanel'
import {
  useApiTokenSettings,
  type ApiTokenSettingsActions,
} from '@/hooks/useApiTokenSettings'
import type { ApiTokenExpiryOption } from '@/lib/apiTokenRules'
import type { ApiTokenRecord } from '@/lib/apiTokens'

export interface AiAccessSettingsSectionProps {
  actions: ApiTokenSettingsActions
  offline: boolean
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function resolveOrigin(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }
  return 'http://localhost:3000'
}

interface TokenRevealCardProps {
  reveal: { tokenName: string; plaintext: string }
  origin: string
  skillUrl: string
  copied: boolean
  onCopy: (text: string) => void
  onDone: () => void
}

function TokenRevealCard({
  reveal,
  origin,
  skillUrl,
  copied,
  onCopy,
  onDone,
}: TokenRevealCardProps) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4 flex flex-col gap-3">
      <p className="text-sm font-semibold text-emerald-900">
        Token &quot;{reveal.tokenName}&quot; created
      </p>
      <div className="flex items-center gap-2">
        <code
          id="reveal-token"
          className="flex-1 min-w-0 break-all rounded-md bg-white border border-emerald-200 px-3 py-2 text-xs font-mono"
        >
          {reveal.plaintext}
        </code>
        <button
          type="button"
          id="copy-token"
          onClick={() => onCopy(reveal.plaintext)}
          className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-md bg-emerald-600 text-white text-xs hover:bg-emerald-700"
        >
          <span id="copy-label">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <p className="text-xs font-medium text-amber-800 flex items-center gap-1">
        ⚠ You will not see this token again.
      </p>
      <div>
        <p className="text-xs text-gray-600 mb-1">Set these in the shell your agent runs in:</p>
        <pre className="rounded-md bg-gray-900 text-gray-100 text-xs px-3 py-2 overflow-x-auto">
{`export REPERTOIRE_HERO_URL=${origin}
export REPERTOIRE_HERO_TOKEN=${reveal.plaintext}`}
        </pre>
      </div>
      <p className="text-xs text-gray-600">
        Then point your agent at the skill:{' '}
        <a href={skillUrl} className="text-emerald-700 underline font-mono">
          {skillUrl}
        </a>
      </p>
      <div>
        <button
          type="button"
          id="reveal-done"
          onClick={onDone}
          className="px-3 py-1.5 rounded-md border border-gray-200 bg-white text-xs text-gray-700 hover:bg-gray-50"
        >
          Done
        </button>
      </div>
    </div>
  )
}

interface TokenCreateFormProps {
  settings: ReturnType<typeof useApiTokenSettings>
  disabled: boolean
}

function TokenCreateForm({ settings, disabled }: TokenCreateFormProps) {
  return (
    <form
      id="create-form"
      className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-4 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void settings.submitCreate()
      }}
    >
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
        Name
        <input
          id="token-name-input"
          value={settings.nameDraft}
          onChange={(e) => settings.setNameDraft(e.target.value)}
          maxLength={50}
          placeholder="e.g. Claude Code"
          className={`rounded-md border ${
            settings.error ? 'border-red-300' : 'border-gray-200'
          } bg-white px-3 py-2 text-sm font-normal`}
        />
      </label>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-xs font-medium text-gray-700 mb-1">Scopes</legend>
        <label className="text-sm text-gray-700 flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.scopesDraft.includes('read')}
            onChange={() => settings.toggleScopeDraft('read')}
          />
          <span className="font-mono text-xs">read</span> — search and read your songs and custom fields
        </label>
        <label className="text-sm text-gray-700 flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.scopesDraft.includes('write:songs')}
            onChange={() => settings.toggleScopeDraft('write:songs')}
          />
          <span className="font-mono text-xs">write:songs</span> — set tunings and custom-field values
        </label>
        <label className="text-sm text-gray-700 flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.scopesDraft.includes('write:tabs')}
            onChange={() => settings.toggleScopeDraft('write:tabs')}
          />
          <span className="font-mono text-xs">write:tabs</span> — upload tab files
        </label>
      </fieldset>

      <label className="flex flex-col gap-1 text-xs font-medium text-gray-700 w-48">
        Expires
        <select
          value={settings.expiryDraft === null ? 'never' : String(settings.expiryDraft)}
          onChange={(e) => {
            const val = e.target.value
            settings.setExpiryDraft(val === 'never' ? null : (Number(val) as ApiTokenExpiryOption))
          }}
          className="rounded-md border border-gray-200 bg-white px-2 py-2 text-sm font-normal"
        >
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="365">1 year</option>
          <option value="never">Never</option>
        </select>
      </label>

      {settings.error && (
        <p className="text-xs text-red-600" role="alert">
          {settings.error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={disabled}
          className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"
        >
          Create token
        </button>
        <button
          type="button"
          id="cancel-create"
          onClick={settings.cancelCreate}
          className="px-3 py-1.5 rounded-md border border-gray-200 bg-white text-xs text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

interface TokenListItemProps {
  token: ApiTokenRecord
  disabled: boolean
  isPendingRevoke: boolean
  busy: boolean
  onRequestRevoke: (id: string) => void
  onConfirmRevoke: () => void
  onCancelRevoke: () => void
}

function TokenListItem({
  token,
  disabled,
  isPendingRevoke,
  busy,
  onRequestRevoke,
  onConfirmRevoke,
  onCancelRevoke,
}: TokenListItemProps) {
  return (
    <li className="px-4 py-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800">
            {token.name}{' '}
            <span className="ml-1 font-mono text-xs text-gray-400">
              {token.tokenPrefix}…
            </span>
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {token.scopes.map((scope) => (
              <span
                key={scope}
                className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[11px] font-mono"
              >
                {scope}
              </span>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Created {formatDate(token.createdAt)} ·{' '}
            {token.lastUsedAt ? `Last used ${formatDate(token.lastUsedAt)}` : 'Never used'} ·{' '}
            {token.expiresAt ? `Expires ${formatDate(token.expiresAt)}` : 'Never expires'}
          </p>
        </div>
        <button
          type="button"
          data-revoke={token.id}
          disabled={disabled}
          onClick={() => onRequestRevoke(token.id)}
          className="text-xs text-red-600 hover:text-red-700 border border-red-200 rounded-md px-2.5 py-1 disabled:opacity-50"
        >
          Revoke
        </button>
      </div>

      {isPendingRevoke && (
        <ConfirmPanel
          message={`Revoke "${token.name}"? Agents using it stop working immediately.`}
          confirmLabel="Revoke"
          busy={busy}
          onConfirm={onConfirmRevoke}
          onCancel={onCancelRevoke}
        />
      )}
    </li>
  )
}

function TokenListContent({
  settings,
  disabled,
}: {
  settings: ReturnType<typeof useApiTokenSettings>
  disabled: boolean
}) {
  if (settings.tokens === null) {
    return (
      <div className="rounded-lg border border-gray-100 bg-white px-4 py-6 text-center text-sm text-gray-400">
        Loading tokens…
      </div>
    )
  }

  if (settings.tokens.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
        No tokens yet. Create one to let an AI agent work on your songs.
      </div>
    )
  }

  return (
    <ul className="rounded-lg border border-gray-100 bg-white shadow-sm divide-y divide-gray-100">
      {settings.tokens.map((token: ApiTokenRecord) => (
        <TokenListItem
          key={token.id}
          token={token}
          disabled={disabled}
          isPendingRevoke={settings.pendingRevokeId === token.id}
          busy={settings.busy}
          onRequestRevoke={settings.requestRevoke}
          onConfirmRevoke={() => void settings.confirmRevoke()}
          onCancelRevoke={settings.cancelRevoke}
        />
      ))}
    </ul>
  )
}

export function AiAccessSettingsSection({ actions, offline }: AiAccessSettingsSectionProps) {
  const settings = useApiTokenSettings({ actions })
  const disabled = offline || settings.busy
  const [copied, setCopied] = useState(false)

  const origin = resolveOrigin()
  const skillUrl = `${origin}/agent-skill/repertoire-hero/SKILL.md`

  const handleCopy = async (text: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch {
      // Fallback or ignore
    }
  }

  return (
    <section className="flex flex-col gap-3 border-t border-gray-100 pt-6" aria-label="AI access">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">AI access</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Personal access tokens let an AI agent read your songs, set tunings and custom fields, and upload tabs.{' '}
            <a href="/agent-skill/repertoire-hero/SKILL.md" className="text-emerald-700 underline">
              Agent skill
            </a>
          </p>
        </div>
        {!settings.isCreating && !settings.reveal && (
          <button
            type="button"
            id="open-create"
            onClick={settings.startCreate}
            disabled={disabled}
            className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium disabled:opacity-50"
          >
            + New token
          </button>
        )}
      </div>

      {settings.reveal && (
        <TokenRevealCard
          reveal={settings.reveal}
          origin={origin}
          skillUrl={skillUrl}
          copied={copied}
          onCopy={(text) => void handleCopy(text)}
          onDone={settings.dismissReveal}
        />
      )}

      {settings.isCreating && (
        <TokenCreateForm settings={settings} disabled={disabled} />
      )}

      {settings.error && !settings.isCreating && (
        <p className="text-xs text-red-600 mb-2" role="alert">
          {settings.error}
        </p>
      )}

      {!settings.reveal && !settings.isCreating && (
        <TokenListContent settings={settings} disabled={disabled} />
      )}
    </section>
  )
}
