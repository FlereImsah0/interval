import ActivityKit
import SwiftUI
import WidgetKit

@main
@MainActor
struct PhoneTimerApp: App {
    @StateObject private var model = WorkoutModel()
    @StateObject private var surfaces = AppleTimerSurfaces()
    @StateObject private var notifications = PhoneWorkoutNotifications()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            AppleRootView(model: model, notice: notifications.notice) { plan in
                await notifications.prepare()
                model.start(plan)
            }
            .onChange(of: model.presentation, initial: true) { _, state in
                surfaces.update(state)
            }
            .onChange(of: model.scheduleRevision) {
                notifications.update(plan: model.plan, snapshot: model.currentSnapshot())
            }
            .onChange(of: scenePhase) {
                guard scenePhase == .active else { return }
                model.refreshNow()
                surfaces.update(model.presentation)
                if let snapshot = model.currentSnapshot() {
                    notifications.update(plan: model.plan, snapshot: snapshot)
                }
            }
        }
    }
}

@MainActor
private final class AppleTimerSurfaces: ObservableObject {
    private var activity: Activity<IntervalActivityAttributes>?
    private var operation: Task<Void, Never>?

    func update(_ presentation: WorkoutPresentation?) {
        let prior = operation
        operation = Task { [weak self] in
            await prior?.value
            await self?.updateSurfaces(presentation)
        }
    }

    private func updateSurfaces(_ presentation: WorkoutPresentation?) async {
        let state = presentation.map {
            TimerSurfaceState(workoutEnd: $0.workoutEnd, workoutStart: $0.workoutStart, workoutDigits: $0.workoutDigits,
                paused: $0.paused, complete: $0.stage == .complete)
        }
        TimerSurfaceStore.write(state)
        WidgetCenter.shared.reloadTimelines(ofKind: TimerSurfaceStore.widgetKind)

        guard let state else {
            for item in Activity<IntervalActivityAttributes>.activities {
                await item.end(nil, dismissalPolicy: .immediate)
            }
            activity = nil
            return
        }
        let content = ActivityContent(state: state, staleDate: state.workoutEnd)
        if state.complete {
            await activity?.end(content, dismissalPolicy: .after(Date.now.addingTimeInterval(15)))
            activity = nil
        } else if let activity {
            await activity.update(content)
        } else if ActivityAuthorizationInfo().areActivitiesEnabled {
            activity = try? Activity.request(attributes: IntervalActivityAttributes(), content: content)
        }
    }
}
