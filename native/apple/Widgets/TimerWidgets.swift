import ActivityKit
import SwiftUI
import WidgetKit

@main
struct TimerWidgets: WidgetBundle {
    var body: some Widget {
        TimerHomeWidget()
        IntervalLiveActivity()
    }
}

private struct TimerEntry: TimelineEntry {
    let date: Date
    let state: TimerSurfaceState?
}

private struct TimerTimeline: TimelineProvider {
    func placeholder(in context: Context) -> TimerEntry { TimerEntry(date: .now, state: nil) }

    func getSnapshot(in context: Context, completion: @escaping (TimerEntry) -> Void) {
        completion(entry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TimerEntry>) -> Void) {
        let current = entry()
        var entries = [current]
        if let state = current.state, !state.paused, let end = state.workoutEnd, end > current.date {
            entries.append(TimerEntry(date: end, state: nil))
        }
        completion(Timeline(entries: entries, policy: .never))
    }

    private func entry() -> TimerEntry {
        let now = Date.now
        let state = TimerSurfaceStore.read()
        if let state, !state.paused, !state.complete, let end = state.workoutEnd, end <= now {
            return TimerEntry(date: now, state: nil)
        }
        return TimerEntry(date: now, state: state)
    }
}

private struct TimerHomeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: TimerSurfaceStore.widgetKind, provider: TimerTimeline()) { entry in
            VStack(alignment: .leading, spacing: 5) {
                Text("Interval Timer").font(.caption).fontWeight(.semibold)
                if let state = entry.state {
                    Text(state.workoutLabel).font(.caption)
                    WorkoutDigits(state: state)
                } else {
                    Label("Open timer", systemImage: "timer")
                        .font(.headline)
                }
            }
            .containerBackground(.fill.tertiary, for: .widget)
            .widgetURL(TimerSurfaceStore.openURL)
        }
        .configurationDisplayName("Interval Timer")
        .description("See the workout time or open the timer.")
        .supportedFamilies([.systemSmall, .accessoryRectangular])
    }
}

private struct WorkoutDigits: View {
    let state: TimerSurfaceState

    var body: some View {
        Group {
            if state.paused || state.complete {
                Text(state.workoutDigits)
            } else if let end = state.workoutEnd {
                let now = Date.now
                if end > now {
                    Text(timerInterval: now...end, countsDown: true)
                } else {
                    Text("00:00")
                }
            } else {
                Text(state.workoutStart, style: .timer)
            }
        }
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }
}

private struct IntervalLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: IntervalActivityAttributes.self) { context in
            HStack {
                VStack(alignment: .leading) {
                    Text(context.state.workoutLabel).font(.headline)
                    Text("Interval Timer").font(.caption)
                }
                Spacer()
                WorkoutDigits(state: context.state).font(.title2.weight(.bold))
            }
            .padding(16)
            .widgetURL(TimerSurfaceStore.openURL)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.state.workoutLabel)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    WorkoutDigits(state: context.state)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text("Interval Timer").font(.caption)
                }
            } compactLeading: {
                Image(systemName: "timer")
            } compactTrailing: {
                WorkoutDigits(state: context.state)
            } minimal: {
                Image(systemName: "timer")
            }
            .widgetURL(TimerSurfaceStore.openURL)
        }
    }
}
