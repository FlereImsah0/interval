import ActivityKit
import SwiftUI
import WidgetKit

@main
@MainActor
struct PhoneTimerApp: App {
    @StateObject private var model = WorkoutModel()
    @StateObject private var surfaces = AppleTimerSurfaces()

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                TimerScreen(model: model)
                    .navigationTitle("Interval Timer")
            }
            .onChange(of: model.presentation, initial: true) { _, state in
                surfaces.update(state)
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
            let name = $0.paused ? "Paused · " + $0.stage.label : $0.stage.label
            return TimerSurfaceState(name: name, round: $0.round, end: $0.end, remaining: $0.remaining)
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
        let content = ActivityContent(state: state, staleDate: state.end)
        if presentation?.stage == .complete {
            await activity?.end(content, dismissalPolicy: .after(Date.now.addingTimeInterval(15)))
            activity = nil
        } else if let activity {
            await activity.update(content)
        } else if ActivityAuthorizationInfo().areActivitiesEnabled {
            activity = try? Activity.request(attributes: IntervalActivityAttributes(), content: content)
        }
    }
}
