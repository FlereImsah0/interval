# Interval Timer native prototypes

The [web timer](https://interval.fleresjourney.com/) is still the live production app. These native prototypes run the interval engine on the device that starts the workout. They use monotonic clocks, support a maximum of 24 hours per round, and use the same audio choices as the web app. Sound plays tones. Voice counts down 3–2–1. Vibration is independent.

| Device | Prepared in this repository | Status or platform boundary |
| --- | --- | --- |
| Android phone | Native timer, Home Screen widget, ongoing notification with Pause/Resume/End, and an optional floating timer above ordinary apps. | The floating timer requires the user to grant Display over other apps. The lock screen uses the notification and respects the device's notification privacy settings. |
| Wear OS | Standalone native timer, audio, vibration, and ongoing notification. The phone and watch builds share the same timer source. | A Wear OS device or emulator is still needed to validate sound routes, display layout, wrist haptics, and screen-off behavior. Tiles and phone/watch synchronization are future work. |
| iPhone | SwiftUI timer, Home Screen and Lock Screen widgets, an ActivityKit countdown on the Lock Screen and Dynamic Island, and scheduled local notifications for background Sound or Voice cues. | Notification permission, sound settings and Focus affect delivery. The Live Activity shows overall workout time and iOS can end it after eight hours. |
| Apple Watch | Standalone SwiftUI timer, sound and native haptics, with a HealthKit workout session for background execution. The app discards the session when it ends. | Requires workout permission and real watch testing of the speaker, headphones and wrist haptics. |

## Build Android and Wear OS

Use JDK 21 and Android SDK Platform 36. From `native/android`:

```text
gradlew.bat :app:assemblePhoneDebug :app:assembleWearDebug :app:testPhoneDebugUnitTest :app:testWearDebugUnitTest
```

Use `./gradlew` on macOS or Linux. Debug APKs appear in `app/build/outputs/apk/phone/debug/` and `app/build/outputs/apk/wear/debug/`. Use the phone APK on a phone and the wear APK on a Wear OS watch. These builds use the Android debug key. For an emulator with notification permission granted on Android 13+, run `:app:connectedPhoneDebugAndroidTest` to verify that a workout continues when its screen is no longer visible.

On an Android 36.1 phone emulator, the service advanced to the next round after the timer screen went to the background and in a separate test with the display off. The launcher registered the phone widget provider. The active Android workout uses a foreground service started by the user and releases its wake lock when paused or ended. Background timing, media, overlay visibility, and notification behaviors vary by device and need hardware validation. The special-use foreground service type and overlay permission need review before a store submission.

## Generate the Apple project

On macOS with Xcode and [XcodeGen](https://github.com/yonaskolb/XcodeGen), run `xcodegen generate` in `native/apple` and open `IntervalTimer.xcodeproj`. Use the `IntervalTimer` and `IntervalTimerWatch` schemes for iPhone and standalone Apple Watch. iPhone requires iOS 17.2 or later. Apple Watch requires watchOS 10 or later. Select a signing team and provision the App Group `group.com.fleresjourney.intervaltimer` for the iPhone app and its widget extension. The generated Xcode project and signing files are local.

Workout state belongs to the device that starts the timer. The engine uses elapsed time from a monotonic clock. The iPhone queues the upcoming cues and refreshes them on return to the app and after timer controls are used. Long or unlimited workouts may need the app to be reopened to queue more cues.

On a physical iPhone, check Sound and Voice separately with the screen locked and with another app open. Check that pause and end clear pending cues, that resume schedules fresh cues, and that the Live Activity continues updating its overall time. On a physical Apple Watch, lower your wrist and switch apps during a short workout to check the phase changes, audio and haptics. Check the permission-denied state and verify that finishing does not save a workout in Health.

Platform references: [Apple Live Activities](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities), [Apple WidgetKit](https://developer.apple.com/documentation/widgetkit/), [Apple Watch workout sessions](https://developer.apple.com/documentation/HealthKit/running-workout-sessions), [Android app widgets](https://developer.android.com/develop/ui/views/appwidgets/overview), [Android application overlays](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#TYPE_APPLICATION_OVERLAY), [Android foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types), and [Wear OS Tiles](https://developer.android.com/training/wearables/tiles).
