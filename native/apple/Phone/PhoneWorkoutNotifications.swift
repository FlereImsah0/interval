import Foundation
import SwiftUI
import UIKit
import UserNotifications

private let workoutNotificationPrefix = "interval-workout-"

@MainActor
final class PhoneWorkoutNotifications: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    @Published private(set) var notice: String?
    private let center = UNUserNotificationCenter.current()
    private let clock = ContinuousClock()
    private var operation: Task<Void, Never>?
    private var generation = 0

    override init() {
        super.init()
        center.delegate = self
    }

    func prepare() async {
        let settings = await center.notificationSettings()
        if settings.authorizationStatus == .notDetermined {
            _ = try? await center.requestAuthorization(options: [.alert, .sound])
        }
    }

    func update(plan: WorkoutPlan?, snapshot: WorkoutSnapshot?) {
        generation += 1
        let current = generation
        let capturedAt = clock.now
        let prior = operation
        operation = Task { [weak self] in
            await prior?.value
            guard let self, current == self.generation else { return }
            let application = UIApplication.shared
            var backgroundTask = UIBackgroundTaskIdentifier.invalid
            func endBackgroundTask() {
                guard backgroundTask != .invalid else { return }
                application.endBackgroundTask(backgroundTask)
                backgroundTask = .invalid
            }
            backgroundTask = application.beginBackgroundTask(withName: "Schedule workout cues") {
                if self.generation == current { self.operation?.cancel() }
                endBackgroundTask()
            }
            defer { endBackgroundTask() }
            await self.replace(plan: plan, snapshot: snapshot, capturedAt: capturedAt, generation: current)
        }
    }

    private func replace(plan: WorkoutPlan?, snapshot: WorkoutSnapshot?, capturedAt: ContinuousClock.Instant, generation current: Int) async {
        let pending = await center.pendingNotificationRequests()
        guard current == generation, !Task.isCancelled else { return }
        let owned = pending.map(\.identifier).filter { $0.hasPrefix(workoutNotificationPrefix) }
        center.removePendingNotificationRequests(withIdentifiers: owned)
        guard let plan, let snapshot, !snapshot.paused, snapshot.phase.stage != .complete else {
            notice = nil
            let delivered = await center.deliveredNotifications()
            guard current == generation, !Task.isCancelled else { return }
            center.removeDeliveredNotifications(withIdentifiers: delivered.map { $0.request.identifier }
                .filter { $0.hasPrefix(workoutNotificationPrefix) })
            return
        }

        let settings = await center.notificationSettings()
        guard current == generation, !Task.isCancelled else { return }
        guard settings.authorizationStatus == .authorized && settings.soundSetting == .enabled else {
            notice = "Allow notifications and sounds in iPhone Settings for cues while the screen is locked."
            return
        }

        let capacity = max(0, 63 - (pending.count - owned.count))
        let scheduled = plan.backgroundCues(after: snapshot.elapsed, capacity: capacity)
        notice = scheduled.partial ? "For a long workout, reopen the timer before the queued background cues run out." : nil
        for cue in scheduled.cues {
            guard current == generation, !Task.isCancelled else { return }
            let remaining = Double(cue.elapsed - snapshot.elapsed) / 1000
            let offset = capturedAt.duration(to: clock.now).components
            let delay = remaining - Double(offset.seconds) - Double(offset.attoseconds) / 1e18
            if delay <= 0 { continue }
            let content = UNMutableNotificationContent()
            content.title = cue.title
            content.sound = UNNotificationSound(named: UNNotificationSoundName(rawValue: cue.sound))
            content.threadIdentifier = "interval-timer"
            let request = UNNotificationRequest(identifier: workoutNotificationPrefix + String(cue.elapsed),
                content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false))
            do { try await center.add(request) }
            catch {
                if current == generation { notice = "Some background cues could not be scheduled." }
            }
        }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // The foreground timer plays this cue directly.
        let owned = notification.request.identifier.hasPrefix(workoutNotificationPrefix)
        completionHandler(owned ? [] : [.banner, .sound])
    }
}
