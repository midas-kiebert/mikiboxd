/**
 * Going & interested: the app's "Clear 'interested' when you go" switch. Kept
 * in this browser (see `interested-elsewhere-reminder.ts`).
 */
import {
  setRemoveInterestedReminderEnabled,
  useRemoveInterestedReminderEnabled,
} from "@/features/showtimes/interested-elsewhere-reminder"

import { SettingsRow, SettingsSection, Switch } from "./settings-controls"
import { sectionMeta } from "./settings-sections"

const TITLE = "Clear “interested” when you go"

const StatusesSection = () => {
  const isEnabled = useRemoveInterestedReminderEnabled()
  const meta = sectionMeta("statuses")

  return (
    <SettingsSection id="statuses" title={meta.label} icon={meta.icon}>
      <div className="st-card">
        <SettingsRow
          title={TITLE}
          description="When you mark a screening “going”, ask to remove “interested” from other screenings of the same film."
        >
          <Switch
            checked={isEnabled}
            onChange={setRemoveInterestedReminderEnabled}
            label={TITLE}
          />
        </SettingsRow>
      </div>
    </SettingsSection>
  )
}

export default StatusesSection
