/**
 * Config plugin: retunes the Android back (close) transition for the
 * `ios_from_right` stack animation used by detail screens.
 *
 * react-native-screens ships both the open and close transitions at
 * config_shortAnimTime (200ms) with accelerate_decelerate — that curve peaks
 * in the middle, so the animation starts too fast and feels abrupt on back.
 *
 * A natural close animation needs:
 *   - foreground (screen leaving): ease-in (starts near-zero velocity, smoothly
 *     accelerates off-screen) — cubic-bezier(0.4, 0, 1, 1)
 *   - background (prev screen revealed): ease-out (settles gently into place) —
 *     cubic-bezier(0, 0, 0.6, 1)
 *
 * App-level anim/interpolator resources override the library's during Android
 * resource merging, so these replace the defaults without patching node_modules.
 * The open (forward) animations are intentionally left untouched.
 */
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const CLOSE_DURATION_MS = 350;

// Custom path interpolators (cubic bezier) written to res/interpolator/.
const INTERPOLATOR_OVERRIDES = {
  // Ease-in: very gentle start, accelerates toward the end. Foreground screen
  // leaving should feel like it's being drawn away, not shoved.
  "rns_back_ease_in.xml": `<?xml version="1.0" encoding="utf-8"?>
<pathInterpolator xmlns:android="http://schemas.android.com/apk/res/android"
    android:controlX1="0.4"
    android:controlY1="0"
    android:controlX2="1"
    android:controlY2="1" />
`,
  // Ease-out: starts at full speed, decelerates to rest. The background screen
  // slides back into place and settles smoothly.
  "rns_back_ease_out.xml": `<?xml version="1.0" encoding="utf-8"?>
<pathInterpolator xmlns:android="http://schemas.android.com/apk/res/android"
    android:controlX1="0"
    android:controlY1="0"
    android:controlX2="0.6"
    android:controlY2="1" />
`,
};

const ANIM_OVERRIDES = {
  "rns_ios_from_right_foreground_close.xml": `<?xml version="1.0" encoding="utf-8"?>
<translate xmlns:android="http://schemas.android.com/apk/res/android"
    android:duration="${CLOSE_DURATION_MS}"
    android:interpolator="@interpolator/rns_back_ease_in"
    android:fromXDelta="0%"
    android:toXDelta="100%" />
`,
  "rns_ios_from_right_background_close.xml": `<?xml version="1.0" encoding="utf-8"?>
<translate xmlns:android="http://schemas.android.com/apk/res/android"
    android:duration="${CLOSE_DURATION_MS}"
    android:interpolator="@interpolator/rns_back_ease_out"
    android:fromXDelta="-30%"
    android:toXDelta="0%" />
`,
};

module.exports = function withIosFromRightBackAnim(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const resDir = cfg.modRequest.platformProjectRoot + "/app/src/main/res";
      const animDir = path.join(resDir, "anim");
      const interpolatorDir = path.join(resDir, "interpolator");
      fs.mkdirSync(animDir, { recursive: true });
      fs.mkdirSync(interpolatorDir, { recursive: true });
      for (const [fileName, contents] of Object.entries(INTERPOLATOR_OVERRIDES)) {
        fs.writeFileSync(path.join(interpolatorDir, fileName), contents);
      }
      for (const [fileName, contents] of Object.entries(ANIM_OVERRIDES)) {
        fs.writeFileSync(path.join(animDir, fileName), contents);
      }
      return cfg;
    },
  ]);
};
