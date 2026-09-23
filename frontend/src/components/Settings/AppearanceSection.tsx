/**
 * Appearance: light, dark, or follow the system — the app's segmented choice.
 * Kept in this browser (next-themes' own storage). Members only: a guest
 * always follows the system (see `ui/provider.tsx`).
 */
import { useTheme } from "next-themes"
import { MdBrightnessAuto, MdDarkMode, MdLightMode } from "react-icons/md"

import {
  Segmented,
  type SegmentedOption,
  SettingsSection,
} from "./settings-controls"
import { sectionMeta } from "./settings-sections"

type ThemeChoice = "light" | "dark" | "system"

const THEME_OPTIONS: readonly SegmentedOption<ThemeChoice>[] = [
  { value: "light", label: "Light", icon: MdLightMode },
  { value: "dark", label: "Dark", icon: MdDarkMode },
  { value: "system", label: "System", icon: MdBrightnessAuto },
]

const isThemeChoice = (value: string | undefined): value is ThemeChoice =>
  THEME_OPTIONS.some((option) => option.value === value)

const AppearanceSection = () => {
  const { theme, setTheme } = useTheme()
  const meta = sectionMeta("appearance")

  return (
    <SettingsSection
      id="appearance"
      title="Appearance"
      icon={meta.icon}
      description="System follows your device's light or dark setting."
    >
      <div className="st-card">
        <div className="st-card__body">
          <Segmented
            options={THEME_OPTIONS}
            value={isThemeChoice(theme) ? theme : "system"}
            onChange={setTheme}
            label="Appearance"
            stretch
            large
          />
        </div>
      </div>
    </SettingsSection>
  )
}

export default AppearanceSection
