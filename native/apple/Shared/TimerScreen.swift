import SwiftUI

@MainActor
struct TimerScreen: View {
    @ObservedObject var model: WorkoutModel
    let notice: String?
    let startWorkout: (WorkoutPlan) async -> Void
    @State private var starting = false
    @AppStorage("activeSeconds") private var active = 30
    @AppStorage("restSeconds") private var rest = 10
    @AppStorage("rounds") private var rounds = 10
    @AppStorage("voice") private var voice = false
    @AppStorage("vibration") private var vibration = true
    @State private var invalid = false

    var body: some View {
        Form {
            if let snapshot = model.snapshot {
                Section(snapshot.paused ? "Paused" : snapshot.phase.stage.label) {
                    Text(formatRemaining(snapshot.remaining))
                        .font(.system(.title, design: .rounded, weight: .bold))
                        .monospacedDigit()
                        .minimumScaleFactor(0.55)
                    if snapshot.phase.stage != .complete {
                        Text("Round \(snapshot.phase.round)")
                        Button(snapshot.paused ? "Resume" : "Pause") { model.togglePause() }
                    }
                    Button(snapshot.phase.stage == .complete ? "Done" : "End workout") { model.stop() }
                }
            } else {
                Section("Workout setup") {
                    duration("Active (seconds)", value: $active, increment: 1, range: 1...86_400)
                    duration("Rest (seconds)", value: $rest, increment: 1, range: 0...86_400)
                    duration("Rounds (0 for unlimited)", value: $rounds, increment: 1, range: 0...9999)
                    Picker("Audio", selection: $voice) {
                        Text("Sound").tag(false)
                        Text("Voice").tag(true)
                    }
                    Toggle("Vibration", isOn: $vibration)
                    if invalid {
                        Text("Set an active interval and keep active time plus rest within 24 hours.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    Button("Start workout") {
                        let plan = WorkoutPlan(activeSeconds: active, restSeconds: rest, rounds: rounds,
                                               voice: voice, vibration: vibration)
                        invalid = plan == nil
                        if let plan {
                            starting = true
                            Task {
                                await startWorkout(plan)
                                starting = false
                            }
                        }
                    }
                    .disabled(starting)
                }
            }
            if let notice {
                Section { Text(notice).font(.footnote).foregroundStyle(.secondary) }
            }
        }
    }

    @ViewBuilder
    private func duration(_ label: String, value: Binding<Int>, increment: Int, range: ClosedRange<Int>) -> some View {
        #if os(watchOS)
        Stepper(value: value, in: range, step: increment) {
            Text("\(label): \(value.wrappedValue)")
        }
        #else
        TextField(label, value: value, format: .number.grouping(.never))
            .keyboardType(.numberPad)
        #endif
    }
}
