# Interval Timer native prototypes

The [web timer](https://interval.fleresjourney.com/) is still the live production app. These native prototypes run the interval engine on the device that starts the workout. They use monotonic clocks, support a maximum of 24 hours per round, and use the same audio choices as the web app. Sound plays tones. Voice counts down 3–2–1. Vibration is independent.

| Device | Prepared in this repository | Status or platform boundary |
| --- | --- | --- |
| Android phone | Native timer, Home Screen widget, ongoing notification with Pause/Resume/End, and an optional floating timer above ordinary apps. | The floating timer requires the user to grant Display over other apps. The lock screen uses the notification and respects the device's notification privacy settings. |
| Wear OS | Standalone native timer, audio, vibration, and ongoing notification. The phone and watch builds share the same timer source. | A Wear OS device or emulator is still needed to validate sound routes, display layout, wrist haptics, and screen-off behavior. Tiles and phone/watch synchronization are future work. |
| iPhone | SwiftUI timer, Home Screen/Lock Screen WidgetKit configuration, and ActivityKit Live Activity on Lock Screen and Dynamic Island. | Requires building and signing in Xcode. iOS provides system-controlled Live Activity surfaces. Arbitrary persistent floating windows across apps are outside this approach. The prototype's Swift timer updates future phases while the app is running. Background phase scheduling and cues after app suspension still need implementation and device tests. |
| Apple Watch | Independent SwiftUI timer and native watch haptics. | Requires Xcode and watchOS verification. Dedicated background workout processing and a watch-face complication still need implementation. Test speaker/headphone routes and real wrist haptics on hardware. |

## Build Android and Wear OS

Use JDK 21 and Android SDK Platform 36. From `native/android`:

```text
gradlew.bat :app:assemblePhoneDebug :app:assembleWearDebug :app:testPhoneDebugUnitTest :app:testWearDebugUnitTest
```

Use `./gradlew` on macOS or Linux. Debug APKs appear in `app/build/outputs/apk/phone/debug/` and `app/build/outputs/apk/wear/debug/`. Use the phone APK on a phone and the wear APK on a Wear OS watch. These builds use the Android debug key. For an emulator with notification permission granted on Android 13+, run `:app:connectedPhoneDebugAndroidTest` to verify that a workout continues when its screen is no longer visible.

On an Android 36.1 phone emulator, the service advanced to the next round after the timer screen went to the background and in a separate test with the display off. The launcher registered the phone widget provider. The active Android workout uses a foreground service started by the user and releases its wake lock when paused or ended. Background timing, media, overlay visibility, and notification behaviors vary by device and need hardware validation. The special-use foreground service type and overlay permission need review before a store submission.

## Generate the Apple project

On macOS with Xcode and [XcodeGen](https://github.com/yonaskolb/XcodeGen), run `xcodegen generate` in `native/apple` and open `IntervalTimer.xcodeproj`. Use the `IntervalTimer` and `IntervalTimerWatch` schemes for iPhone and standalone Apple Watch. iPhone requires iOS 17.2 or later. Apple Watch requires watchOS 10 or later. Select a signing team and provision the App Group `group.com.fleresjourney.intervaltimer` for the iPhone app and its widget extension. The generated Xcode project and signing files are local.

Workout state belongs to one device. A future companion link should transfer presets and mirror session snapshots with explicit ownership. Clock changes must leave the elapsed workout untouched. System surfaces receive display deadlines and phase changes. They never drive the timer. Long sessions also need a plan for Live Activity lifetime limits.

Platform references: [Apple Live Activities](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities), [Apple WidgetKit](https://developer.apple.com/documentation/widgetkit/), [Apple Watch workout sessions](https://developer.apple.com/documentation/HealthKit/running-workout-sessions), [Android app widgets](https://developer.android.com/develop/ui/views/appwidgets/overview), [Android application overlays](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#TYPE_APPLICATION_OVERLAY), [Android foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types), and [Wear OS Tiles](https://developer.android.com/training/wearables/tiles).
