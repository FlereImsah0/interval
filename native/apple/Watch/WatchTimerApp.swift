import SwiftUI

@main
@MainActor
struct WatchTimerApp: App {
    @StateObject private var model = WorkoutModel()

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                TimerScreen(model: model)
                    .navigationTitle("Interval Timer")
            }
        }
    }
}
