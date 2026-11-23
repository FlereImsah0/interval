struct BackgroundCue: Equatable {
    let elapsed: Int64
    let title: String
    let sound: String
}

struct BackgroundCuePlan {
    let cues: [BackgroundCue]
    let partial: Bool
}

extension WorkoutPlan {
    var totalMilliseconds: Int64? {
        guard rounds > 0 else { return nil }
        return (Int64(rounds) * Int64(activeSeconds + restSeconds) - Int64(restSeconds)) * 1000
    }

    // Reserve the final notification, even when the whole sequence does not fit.
    func backgroundCues(after elapsed: Int64, capacity: Int) -> BackgroundCuePlan {
        let finish = totalMilliseconds.flatMap { end in
            end > elapsed ? BackgroundCue(elapsed: end, title: "Workout complete",
                sound: voice ? "complete.wav" : "cue-complete.wav") : nil
        }
        guard capacity > 0 else { return BackgroundCuePlan(cues: [], partial: true) }
        let available = capacity - (finish == nil ? 0 : 1)
        var cues: [BackgroundCue] = []
        var partial = false
        var phase = phase(at: elapsed)

        queue: while phase.stage != .complete {
            let next = self.phase(at: phase.end)
            let candidates: [BackgroundCue]
            if voice {
                candidates = (1...3).reversed().compactMap { seconds in
                    let deadline = phase.end - Int64(seconds) * 1000
                    guard deadline >= phase.start, deadline > elapsed else { return nil }
                    let unit = seconds == 1 ? "second" : "seconds"
                    return BackgroundCue(elapsed: deadline, title: "\(next.stage.label) in \(seconds) \(unit)",
                                         sound: ["one.wav", "two.wav", "three.wav"][seconds - 1])
                }
            } else if next.stage != .complete {
                candidates = [BackgroundCue(elapsed: phase.end, title: next.stage.label,
                                            sound: "cue-" + next.stage.rawValue + ".wav")]
            } else {
                candidates = []
            }
            for cue in candidates {
                if cues.count == available {
                    partial = true
                    break queue
                }
                cues.append(cue)
            }
            phase = next
        }
        if let finish { cues.append(finish) }
        return BackgroundCuePlan(cues: cues, partial: partial)
    }
}
