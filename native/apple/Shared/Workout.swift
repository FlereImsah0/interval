import Foundation

struct WorkoutPlan {
    static let maxRoundSeconds = 86_400
    let activeSeconds: Int
    let restSeconds: Int
    let rounds: Int
    let voice: Bool
    let vibration: Bool

    init?(activeSeconds: Int, restSeconds: Int, rounds: Int, voice: Bool, vibration: Bool) {
        guard (1...Self.maxRoundSeconds).contains(activeSeconds),
              (0...(Self.maxRoundSeconds - activeSeconds)).contains(restSeconds),
              (0...9999).contains(rounds) else { return nil }
        self.activeSeconds = activeSeconds
        self.restSeconds = restSeconds
        self.rounds = rounds
        self.voice = voice
        self.vibration = vibration
    }

    func phase(at elapsed: Int64) -> WorkoutPhase {
        let active = Int64(activeSeconds) * 1000
        let rest = Int64(restSeconds) * 1000
        let cycle = active + rest
        let total = Int64(rounds) * cycle - rest
        if rounds != 0, elapsed >= total {
            return WorkoutPhase(stage: .complete, round: Int64(rounds), start: total, end: total)
        }
        let index = elapsed / cycle
        let start = index * cycle
        let activeEnd = start + active
        if elapsed < activeEnd {
            return WorkoutPhase(stage: .active, round: index + 1, start: start, end: activeEnd)
        }
        return WorkoutPhase(stage: .rest, round: index + 1, start: activeEnd, end: start + cycle)
    }
}

enum WorkoutStage: String {
    case active
    case rest
    case complete

    var label: String {
        switch self {
        case .active: "Active"
        case .rest: "Rest"
        case .complete: "Workout complete"
        }
    }
}

struct WorkoutPhase: Equatable {
    let stage: WorkoutStage
    let round: Int64
    let start: Int64
    let end: Int64
}

struct WorkoutSnapshot {
    let phase: WorkoutPhase
    let elapsed: Int64
    let paused: Bool

    var remaining: Int64 { max(0, phase.end - elapsed) }

    func countdown(after previous: Int64) -> Int? {
        guard !paused, phase.stage != .complete else { return nil }
        return (1...3).first { seconds in
            let threshold = phase.end - Int64(seconds) * 1000
            return threshold >= phase.start && threshold > previous && (0...300).contains(elapsed - threshold)
        }
    }
}

struct Workout {
    let plan: WorkoutPlan
    private let clock: () -> Int64
    private var origin: Int64
    private var pausedAt: Int64?

    init(plan: WorkoutPlan, clock: @escaping () -> Int64) {
        self.plan = plan
        self.clock = clock
        self.origin = clock()
    }

    func snapshot() -> WorkoutSnapshot {
        let elapsed = (pausedAt ?? clock()) - origin
        return WorkoutSnapshot(phase: plan.phase(at: elapsed), elapsed: elapsed, paused: pausedAt != nil)
    }

    mutating func pause() {
        if pausedAt == nil { pausedAt = clock() }
    }

    mutating func resume() {
        guard let pausedAt else { return }
        origin += clock() - pausedAt
        self.pausedAt = nil
    }
}

func formatRemaining(_ milliseconds: Int64) -> String {
    let seconds = (milliseconds + 999) / 1000
    if seconds >= 3600 {
        return String(format: "%02lld:%02lld:%02lld", seconds / 3600, seconds / 60 % 60, seconds % 60)
    }
    return String(format: "%02lld:%02lld", seconds / 60, seconds % 60)
}
