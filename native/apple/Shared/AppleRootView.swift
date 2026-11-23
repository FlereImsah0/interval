import SwiftUI

private enum TimerPage {
    case settings, welcome, terms, privacy
}

@MainActor
struct AppleRootView: View {
    @ObservedObject var model: WorkoutModel
    let notice: String?
    let startWorkout: (WorkoutPlan) async -> Void

    @AppStorage("welcomeSeen") private var welcomeSeen = false
    @State private var path: [TimerPage] = []

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button { goBack() } label: { navigationLabel("Back", icon: "chevron.left") }
                    .disabled(path.isEmpty)
                Button { goHome() } label: { navigationLabel("Home", icon: "house") }
                Spacer()
                if path.isEmpty {
                    Button { path.append(.settings) } label: { navigationLabel("Settings", icon: "gearshape") }
                }
            }
            .buttonStyle(.borderless)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)

            switch path.last {
            case .settings:
                Form {
                    Section("Settings") {
                        Button("Welcome") { path.append(.welcome) }
                        Button("Terms") { path.append(.terms) }
                        Button("Privacy") { path.append(.privacy) }
                    }
                }
            case .welcome:
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Image("welcome-runner.jpg", bundle: .main)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                            .accessibilityLabel("Runner training on a blue track at dusk")
                        Text("A timer for interval training").font(.headline)
                        Text("Set how long to move, how long to rest, and how many rounds to repeat.")
                        Text("A tone or spoken countdown tells you when to switch.")
                        Button("Set up a workout") { goHome() }
                            .buttonStyle(.borderedProminent)
                    }
                    .padding(10)
                }
            case .terms:
                legal("Terms", copy: [
                    "Interval Timer helps you time exercise and rest. Use it at your own pace and in a safe place.",
                    "The timer is a workout tool. For anything that needs an exact alert, use an appropriate alarm or timer.",
                    "Some features depend on your device and settings. You can stop using Interval Timer whenever you like."
                ])
            case .privacy:
                legal("Privacy", copy: [
                    "You can use the timer without an account. The app has no ads or analytics trackers.",
                    "Settings stay on your device. On iPhone, notification permission lets the timer deliver alerts.",
                    "On Apple Watch, Health permission lets the timer run during a workout. The timer discards the workout and does not send health data to us.",
                    "You can change permissions in your device settings. If you email us, we use your address and message to answer."
                ])
            case nil:
                TimerScreen(model: model, notice: notice, startWorkout: startWorkout)
            }
        }
        .onAppear {
            if !welcomeSeen && path.isEmpty { path = [.welcome] }
        }
    }

    private func goBack() {
        if path.last == .welcome { welcomeSeen = true }
        if !path.isEmpty { path.removeLast() }
    }

    private func goHome() {
        if path.contains(.welcome) { welcomeSeen = true }
        path.removeAll()
    }

    private func navigationLabel(_ title: String, icon: String) -> some View {
        Label(title, systemImage: icon)
            #if os(watchOS)
            .labelStyle(.iconOnly)
            #endif
            .accessibilityLabel(title)
    }

    private func legal(_ title: String, copy: [String]) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(title).font(.headline)
                ForEach(copy, id: \.self) { Text($0) }
                Text("Flere's Journey (Adriana Zubović)").font(.footnote.bold())
                if let email = URL(string: "mailto:flere4apps@gmail.com") {
                    Link("flere4apps@gmail.com", destination: email).font(.footnote)
                }
            }
            .padding(10)
        }
    }
}
