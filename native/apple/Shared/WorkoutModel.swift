import AVFoundation
import SwiftUI
#if os(watchOS)
import WatchKit
#elseif os(iOS)
import UIKit
#endif

struct WorkoutPresentation: Equatable {
    let stage: WorkoutStage
    let round: Int64
    let end: Date?
    let remaining: String
    let paused: Bool
    let workoutEnd: Date?
    let workoutStart: Date
    let workoutDigits: String
}

@MainActor
final class WorkoutModel: ObservableObject {
    @Published private(set) var snapshot: WorkoutSnapshot?
    @Published private(set) var scheduleRevision = 0
    @Published private(set) var presentation: WorkoutPresentation?
    private let clock = ContinuousClock()
    private var workout: Workout?
    private var loop: Task<Void, Never>?
    private var lastPhase: WorkoutPhase?
    private var lastElapsed: Int64 = -1
    private var player: AVAudioPlayer?

    var plan: WorkoutPlan? { workout?.plan }

    func currentSnapshot() -> WorkoutSnapshot? { workout?.snapshot() }

    func refreshNow() { refresh() }

    func start(_ plan: WorkoutPlan) {
        stop()
        let origin = clock.now
        workout = Workout(plan: plan) { [clock] in
            let parts = origin.duration(to: clock.now).components
            return parts.seconds * 1000 + parts.attoseconds / 1_000_000_000_000_000
        }
        refresh()
        scheduleRevision += 1
        run()
    }

    func togglePause() {
        guard let state = snapshot, state.phase.stage != .complete else { return }
        if state.paused {
            workout?.resume()
            refresh()
            run()
        } else {
            workout?.pause()
            loop?.cancel()
            player?.stop()
            refresh()
        }
        scheduleRevision += 1
    }

    func stop() {
        loop?.cancel()
        loop = nil
        player?.stop()
        workout = nil
        snapshot = nil
        presentation = nil
        lastPhase = nil
        lastElapsed = -1
        scheduleRevision += 1
    }

    private func run() {
        loop?.cancel()
        loop = Task { [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(for: .milliseconds(100)) }
                catch { return }
                guard let self else { return }
                self.refresh()
                if self.snapshot?.phase.stage == .complete { return }
            }
        }
    }

    private func refresh() {
        guard let workout else { return }
        let state = workout.snapshot()
        let entered = state.phase != lastPhase
        if entered || state.paused != snapshot?.paused {
            let timerEnd = state.paused || state.phase.stage == .complete ? nil
                : Date.now.addingTimeInterval(Double(state.remaining) / 1000)
            let now = Date.now
            let totalRemaining = workout.plan.totalMilliseconds.map { max(0, $0 - state.elapsed) }
            let workoutEnd = totalRemaining.map { now.addingTimeInterval(Double($0) / 1000) }
            presentation = WorkoutPresentation(stage: state.phase.stage, round: state.phase.round,
                end: timerEnd, remaining: formatRemaining(state.remaining), paused: state.paused,
                workoutEnd: workoutEnd, workoutStart: now.addingTimeInterval(-Double(state.elapsed) / 1000),
                workoutDigits: formatRemaining(totalRemaining ?? state.elapsed))
        }
        #if os(iOS)
        let playsHere = UIApplication.shared.applicationState == .active
        #else
        let playsHere = true
        #endif
        if !state.paused && playsHere {
            if entered && state.elapsed - state.phase.start <= 300 {
                if workout.plan.voice {
                    if state.phase.stage == .complete { play("complete", folder: "voice") }
                } else {
                    play("cue-" + state.phase.stage.rawValue, folder: "audio")
                }
                if workout.plan.vibration { vibrate(state.phase.stage) }
            }
            if workout.plan.voice,
               let seconds = state.countdown(after: entered ? state.phase.start - 1 : lastElapsed) {
                play(["one", "two", "three"][seconds - 1], folder: "voice")
            }
        }
        snapshot = state
        lastPhase = state.phase
        lastElapsed = state.elapsed
    }

    private func play(_ cue: String, folder: String) {
        guard let file = Bundle.main.url(forResource: cue, withExtension: "wav", subdirectory: folder)
                ?? Bundle.main.url(forResource: cue, withExtension: "wav") else { return }
        player?.stop()
        player = try? AVAudioPlayer(contentsOf: file)
        player?.play()
    }

    private func vibrate(_ stage: WorkoutStage) {
        #if os(watchOS)
        let cue: WKHapticType = stage == .active ? .start : stage == .rest ? .stop : .success
        WKInterfaceDevice.current().play(cue)
        #elseif os(iOS)
        UINotificationFeedbackGenerator().notificationOccurred(stage == .rest ? .warning : .success)
        #endif
    }
}
