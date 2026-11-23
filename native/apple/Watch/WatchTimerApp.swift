import SwiftUI

@main
@MainActor
struct WatchTimerApp: App {
    @StateObject private var model = WorkoutModel()
    @StateObject private var session = WatchWorkoutSession()

    var body: some Scene {
        WindowGroup {
            AppleRootView(model: model, notice: session.notice) { plan in
                if await session.begin(interrupted: { model.stop() }) { model.start(plan) }
            }
            .onChange(of: model.presentation) { _, state in session.update(state) }
        }
    }
}
