# Interval Timer

## Product blueprint

The first release is a static, installable web timer for phones and desktop browsers. It validates the workout flow and deadline arithmetic. Native phone and watch targets will be required for dependable locked-screen cues and independent swimming workouts. The web release uses English, stores preferences and favorites on the device, and caches the app shell after an online visit.

### Platform decisions

| Platform | Clock and execution | Audio and haptics |
| --- | --- | --- |
| Web | `performance.now()` and absolute deadlines. Browser scheduling can be throttled or suspended. OS sleep behavior needs device validation. | Web Audio and browser speech when available. Vibration is optional and device dependent. Screen Wake Lock is a foreground convenience. |
| iOS | SwiftUI and Swift `ContinuousClock`. Validate lock-screen behavior with eligible native audio or workout execution mechanisms on target OS versions. | AVAudioSession for route and interruption handling. Core Haptics on supported hardware. Respect system settings and audio routes. |
| watchOS | Dedicated SwiftUI target. Use an active HealthKit workout session for supported activities and recover when offered by the operating system. The watch owns its clock and runs independently. | Use documented WatchKit haptic types. Test start and stop for recognizability in water, with Water Lock on. Validate audio routes and avoid driving closely spaced haptic calls. |
| Android | Kotlin and Compose. Use `SystemClock.elapsedRealtimeNanos()` and an eligible user-visible foreground service for an active workout. | Use `VibrationEffect` with supported primitives and waveform fallback. Manage audio focus and handle route changes. |
| Wear OS | Dedicated Compose for Wear OS UI. Use an eligible foreground-service workflow and Health Services ExerciseClient where the workout needs it. The watch owns its local clock. | Test vibrator availability, water lock, off-wrist behavior, and Bluetooth audio on representative devices. Use ordinary audio routing for headphones. |

Native Swift and Kotlin targets give direct access to workout lifecycles and hardware. Flutter and React Native can share phone UI, but native modules and watch targets would still own the timing and feedback. Share state-machine fixtures and a versioned workout format across implementations. Send workout configurations via Watch Connectivity or Wear OS Data Layer. The device that starts a session owns its UUID, timeline, and cues. A companion may mirror its state using sequenced snapshots. A disconnect leaves the owner running. A reboot or unrecoverable clock change ends the session explicitly.

References: [Swift ContinuousClock](https://developer.apple.com/documentation/swift/continuousclock), [HealthKit workouts](https://developer.apple.com/documentation/healthkit/hkworkoutsession), [WatchKit haptics](https://developer.apple.com/documentation/watchkit/wkinterfacedevice/play(_:)), [Watch Connectivity](https://developer.apple.com/documentation/watchconnectivity), [Android clock](https://developer.android.com/reference/android/os/SystemClock), [Wear OS exercise](https://developer.android.com/health-and-fitness/health-services/active-data), [Wear OS Data Layer](https://developer.android.com/training/wearables/data/overview), and [High Resolution Time](https://www.w3.org/TR/hr-time-3/).

### Workout and interface

Setup has three primary controls: Active, Rest, and Rounds. A single Start action enters the workout. The workout view shows time, phase, round, progress, Pause/Resume, and Stop. Completion returns to setup or repeats the workout. Preparation and rest may be zero. A finite session finishes after its last active interval. Unlimited sessions continue until stopped. Walking through setup requires no account, tutorial, or network.

The timer maps elapsed monotonic time directly to its phase and absolute deadline. Pausing freezes elapsed time. Resuming shifts the reference by the pause duration. A delayed callback recomputes the current state and skips stale cues. The UI announces phase changes and leaves per-second announcements off. Sound, speech, and vibration are independently configurable. General, running, swimming, stretching, HIIT and custom cues share the same timer. The swimming preset offers different vibration patterns only on capable browsers and remains a prototype until watch testing.

Use large tabular digits, high contrast, and written state names. Lime marks Active, cyan marks Rest, and neutral tones mark preparation or pause. Color provides a redundant signal. Treat color as a readability and differentiation choice. Research on a red advantage in combat sport does not establish a general performance benefit from interface color. See [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and [Barba et al., Scientific Reports](https://www.nature.com/articles/s41598-024-81373-3).

### Validation and release gates

- Automated arithmetic gate: zero cumulative deadline error in 10,000 one-second active/rest rounds and exact phase selection at boundaries, after stalls, and on pause/resume.
- Web foreground target: p95 transition callback lateness at most 100 ms and p95 audible onset at most 200 ms in a 300-transition test on each target browser. Use clock logs for callbacks and an external recording for cue onset. These are targets pending measurements.
- Native target: p95 onset at most 150 ms on each supported cue route while the workout app is eligible to run, measured separately for audio and haptics. Record Bluetooth latency by device and publish measured ranges before making promises.
- Validate lock screen, notifications, calls, low-power mode, Bluetooth route changes, airplane mode, network loss, manual clock changes, time-zone changes, system sleep, app suspension, and watch disconnection. Validate haptic recognition in water, touch prevention, and independent watch use on hardware.
- Run screen-reader and font-scaling checks on iOS and Android. Verify large touch targets and color contrast in light and dark modes. Native release preparation also needs signing, entitlement and service review, privacy disclosures, and companion/store submissions.

## Run locally

Serve the `web/` directory with a static HTTP server. HTTPS or localhost is required for the service worker. Run `node --test` from the repository root for automated timing checks. The deployable package is the contents of `web/`, with no build step.
