@main
struct CuePlanChecks {
    static func main() {
        let sound = WorkoutPlan(activeSeconds: 30, restSeconds: 10, rounds: 10, voice: false, vibration: true)!
        let tones = sound.backgroundCues(after: 0, capacity: 63)
        precondition(tones.cues.count == 19 && !tones.partial)
        precondition(tones.cues.first == BackgroundCue(elapsed: 30_000, title: "Rest", sound: "cue-rest.wav"))
        precondition(tones.cues.last?.elapsed == 390_000)

        let voice = WorkoutPlan(activeSeconds: 30, restSeconds: 10, rounds: 10, voice: true, vibration: true)!
        let countdown = voice.backgroundCues(after: 0, capacity: 63)
        precondition(countdown.cues.count == 58 && !countdown.partial)
        precondition(countdown.cues.prefix(3).map(\.sound) == ["three.wav", "two.wav", "one.wav"])
        precondition(countdown.cues.last?.sound == "complete.wav")
        let resumed = voice.backgroundCues(after: 29_300, capacity: 63)
        precondition(resumed.cues.first?.elapsed == 37_000)

        let long = WorkoutPlan(activeSeconds: 30, restSeconds: 10, rounds: 100, voice: true, vibration: false)!
        let partial = long.backgroundCues(after: 0, capacity: 63)
        precondition(partial.cues.count == 63 && partial.partial)
        precondition(partial.cues.last?.elapsed == long.totalMilliseconds)
        precondition(partial.cues.last?.sound == "complete.wav")

        let unlimited = WorkoutPlan(activeSeconds: 1, restSeconds: 0, rounds: 0, voice: false, vibration: false)!
        precondition(unlimited.totalMilliseconds == nil)
        precondition(unlimited.backgroundCues(after: 0, capacity: 3).cues.map(\.elapsed) == [1000, 2000, 3000])
        print("Apple timer cue plans verified")
    }
}
