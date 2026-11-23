import SwiftUI

private enum TimerPage: Hashable {
    case settings, welcome, terms, privacy
}

@MainActor
struct AppleRootView: View {
    @ObservedObject var model: WorkoutModel
    let notice: String?
    let startWorkout: (WorkoutPlan) async -> Void

    @AppStorage("welcomeSeen") private var welcomeSeen = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage("voice") private var voice = false
    @AppStorage("vibration") private var vibration = true
    @State private var path: [TimerPage] = []
    private var isWelcome: Bool { path.last == .welcome }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Image("icon-192.png", bundle: .main)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 34, height: 34)
                    .accessibilityHidden(true)
                Text("INTERVAL TIMER")
                    .font(.custom("BarlowCondensed-Bold", size: 22, relativeTo: .title3))
                    .tracking(1)
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)
                    .accessibilityAddTraits(.isHeader)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)

            page
                .id(path.last)
                .transition(reduceMotion ? .identity : .opacity.combined(with: .offset(y: 8)))

            if !isWelcome || path.count > 1 {
                HStack {
                    if path.isEmpty {
                        Button { path.append(.settings) } label: { navigationLabel("Settings", icon: "slider.horizontal.3") }
                    } else {
                        Button { goBack() } label: { navigationLabel("Back", icon: "chevron.left") }
                        Button { goHome() } label: { navigationLabel("Home", icon: "house") }
                    }
                }
                .buttonStyle(.borderless)
                .padding(6)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
                .padding(.horizontal, 8)
                .padding(.bottom, 4)
            }
        }
        .environment(\.colorScheme, .dark)
        .background {
            LinearGradient(colors: [Color(red: 0.05, green: 0.08, blue: 0.13),
                                    Color(red: 0.08, green: 0.15, blue: 0.23)],
                           startPoint: .bottomLeading, endPoint: .topTrailing)
                .ignoresSafeArea()
        }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.22), value: path)
        .onAppear {
            if !welcomeSeen && path.isEmpty { path = [.welcome] }
        }
    }

    @ViewBuilder
    private var page: some View {
        switch path.last {
        case .settings:
            Form {
                Section("Workout cues") {
                    Picker("Audio", selection: $voice) {
                        Text("Sound").tag(false)
                        Text("Voice").tag(true)
                    }
                    Toggle("Vibration", isOn: $vibration)
                }
                Section("About") {
                    Button("Welcome") { path.append(.welcome) }
                    Button("Terms") { path.append(.terms) }
                    Button("Privacy") { path.append(.privacy) }
                }
            }
            #if os(iOS)
            .scrollContentBackground(.hidden)
            #endif
        case .welcome:
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Image("welcome-sports.jpg", bundle: .main)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .accessibilityLabel("Four athletes run, swim, stretch and lift a kettlebell")
                    Text("A timer for interval training")
                        .font(.custom("BarlowCondensed-Bold", size: 27, relativeTo: .title2))
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
            .frame(maxWidth: .infinity, minHeight: 44)
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
