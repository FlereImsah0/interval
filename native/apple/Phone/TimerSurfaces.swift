import ActivityKit
import Foundation

struct TimerSurfaceState: Codable, Hashable {
    let name: String
    let round: Int64
    let end: Date?
    let remaining: String
}

struct IntervalActivityAttributes: ActivityAttributes {
    typealias ContentState = TimerSurfaceState
}

enum TimerSurfaceStore {
    static let suite = "group.com.fleresjourney.intervaltimer"
    static let widgetKind = "IntervalTimerHome"
    static let openURL = URL(string: "intervaltimer://open")
    private static let key = "workout-snapshot"

    static func write(_ state: TimerSurfaceState?) {
        let defaults = UserDefaults(suiteName: suite)
        if let state, let data = try? JSONEncoder().encode(state) {
            defaults?.set(data, forKey: key)
        } else {
            defaults?.removeObject(forKey: key)
        }
    }

    static func read() -> TimerSurfaceState? {
        guard let data = UserDefaults(suiteName: suite)?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(TimerSurfaceState.self, from: data)
    }
}
