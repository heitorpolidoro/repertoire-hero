"use client";

import { ConfirmPanel } from "@/components/ui/ConfirmPanel";
import { CUSTOM_FIELD_NAME_MAX } from "@/lib/customFieldRules";
import {
  useCustomFieldSettings,
  type CustomFieldSettingsActions,
  type CustomFieldSettingsController,
} from "@/hooks/useCustomFieldSettings";
import type { CustomField } from "@/types/customField";

export interface CustomFieldsSettingsSectionProps {
  /** Injected by the page (F21); module-level so its identity is stable. */
  actions: CustomFieldSettingsActions;
  /** Every write control is disabled offline: each one crosses the network. */
  offline: boolean;
}

const BUTTON =
  "rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:hover:bg-transparent";
const ROW = "flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 shadow-sm px-3 py-2";

interface RowProps {
  field: CustomField;
  index: number;
  count: number;
  settings: CustomFieldSettingsController;
  disabled: boolean;
}

function RenameRow({ field, settings, disabled }: RowProps) {
  return (
    <div className={ROW}>
      <input
        aria-label={`New name for ${field.name}`}
        value={settings.renameDraft}
        maxLength={CUSTOM_FIELD_NAME_MAX}
        onChange={(e) => settings.setRenameDraft(e.target.value)}
        className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
      />
      <button type="button" className={BUTTON} disabled={disabled} onClick={() => void settings.saveRename()}>
        Save
      </button>
      <button type="button" className={BUTTON} onClick={settings.cancelRename}>
        Cancel
      </button>
    </div>
  );
}

function FieldRow(props: RowProps) {
  const { field, index, count, settings, disabled } = props;
  if (settings.renamingId === field.id) return <RenameRow {...props} />;
  return (
    <div className="flex flex-col gap-2">
      <div className={ROW}>
        <span className="flex-1 text-sm font-medium" data-testid="custom-field-name">
          {field.name}
        </span>
        <button
          type="button"
          className={BUTTON}
          aria-label={`Move ${field.name} up`}
          disabled={disabled || index === 0}
          onClick={() => void settings.move(field.id, "up")}
        >
          ↑
        </button>
        <button
          type="button"
          className={BUTTON}
          aria-label={`Move ${field.name} down`}
          disabled={disabled || index === count - 1}
          onClick={() => void settings.move(field.id, "down")}
        >
          ↓
        </button>
        <button
          type="button"
          className={BUTTON}
          aria-label={`Rename ${field.name}`}
          disabled={disabled}
          onClick={() => settings.startRename(field.id)}
        >
          Rename
        </button>
        <button
          type="button"
          className={`${BUTTON} text-red-600`}
          aria-label={`Delete ${field.name}`}
          disabled={disabled}
          onClick={() => settings.requestDelete(field.id)}
        >
          Delete
        </button>
      </div>
      {settings.pendingDelete?.id === field.id && (
        <ConfirmPanel
          message={`Delete "${field.name}" and its value on every song?`}
          confirmLabel="Delete"
          busy={settings.busy}
          onConfirm={() => void settings.confirmDelete()}
          onCancel={settings.cancelDelete}
        />
      )}
    </div>
  );
}

/**
 * The `/settings` "Custom fields" section (RH-186): the user's own field
 * definitions. While loading and after a failed load the list is unknown, not
 * empty, so the empty state is not shown.
 */
export function CustomFieldsSettingsSection({ actions, offline }: CustomFieldsSettingsSectionProps) {
  const settings = useCustomFieldSettings({ actions });
  const disabled = offline || settings.busy;
  const fields = settings.fields;

  return (
    <section className="flex flex-col gap-3 border-t border-gray-100 pt-6" aria-label="Custom fields">
      <div>
        <h2 className="text-sm font-semibold text-gray-700">Custom fields</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Your own notes on every song, like the pedalboard preset you use. Only you see them.
        </p>
      </div>

      {fields && fields.length === 0 && <p className="text-sm text-gray-500">No custom fields yet.</p>}
      {fields && fields.length > 0 && (
        <div className="flex flex-col gap-2">
          {fields.map((field, index) => (
            <FieldRow
              key={field.id}
              field={field}
              index={index}
              count={fields.length}
              settings={settings}
              disabled={disabled}
            />
          ))}
        </div>
      )}

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void settings.add();
        }}
      >
        <input
          value={settings.newName}
          onChange={(e) => settings.setNewName(e.target.value)}
          maxLength={CUSTOM_FIELD_NAME_MAX}
          placeholder="Field name, e.g. Preset"
          disabled={offline}
          className="flex-1 min-w-[12rem] rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={disabled || settings.newName.trim() === ""}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Add field
        </button>
      </form>

      {settings.error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {settings.error}
        </div>
      )}
    </section>
  );
}
