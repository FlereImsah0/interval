import HealthKit
import SwiftUI

private enum WorkoutSessionError: Error {
    case collectionNotStarted
}

@MainActor
final class WatchWorkoutSession: NSObject, ObservableObject, HKWorkoutSessionDelegate {
    @Published private(set) var notice: String?
    private let health = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var finishing: Task<Void, Never>?
    private var interrupted: (() -> Void)?

    func begin(interrupted: @escaping () -> Void) async -> Bool {
        if finishing != nil { end() }
        guard session == nil else { return false }
        notice = nil
        guard HKHealthStore.isHealthDataAvailable() else {
            notice = "Health access is needed to run the timer in the background on this watch."
            return false
        }

        do {
            let type = HKObjectType.workoutType()
            try await health.requestAuthorization(toShare: [type], read: [])
            guard health.authorizationStatus(for: type) == .sharingAuthorized else {
                notice = "Allow Workouts in Apple Watch Health settings to run the timer in the background."
                return false
            }
            let configuration = HKWorkoutConfiguration()
            configuration.activityType = .other
            configuration.locationType = .unknown
            let workout = try HKWorkoutSession(healthStore: health, configuration: configuration)
            let collection = workout.associatedWorkoutBuilder()
            workout.delegate = self
            self.interrupted = interrupted
            session = workout
            builder = collection

            let start = Date.now
            workout.startActivity(with: start)
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                collection.beginCollection(withStart: start) { started, error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else if started {
                        continuation.resume()
                    } else {
                        continuation.resume(throwing: WorkoutSessionError.collectionNotStarted)
                    }
                }
            }
            return session === workout
        } catch {
            end()
            notice = "The watch could not start the workout. End any other workout and try again."
            return false
        }
    }

    func update(_ presentation: WorkoutPresentation?) {
        guard let session else { return }
        guard let presentation else {
            end()
            return
        }
        if presentation.stage == .complete {
            guard finishing == nil else { return }
            finishing = Task { [weak self] in
                do { try await Task.sleep(for: .milliseconds(1600)) } catch { return }
                self?.end()
            }
        } else if presentation.paused && session.state == .running {
            session.pause()
        } else if !presentation.paused && session.state == .paused {
            session.resume()
        }
    }

    private func end() {
        finishing?.cancel()
        finishing = nil
        let active = session
        let collection = builder
        session = nil
        builder = nil
        interrupted = nil
        active?.end()
        collection?.discardWorkout()
    }

    private func failed(_ id: ObjectIdentifier) {
        guard let session, ObjectIdentifier(session) == id else { return }
        let stop = interrupted
        end()
        stop?()
        notice = "The watch session ended. You can start a new workout."
    }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState, date: Date) {
        guard toState == .ended else { return }
        let id = ObjectIdentifier(workoutSession)
        Task { @MainActor [weak self] in self?.failed(id) }
    }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        let id = ObjectIdentifier(workoutSession)
        Task { @MainActor [weak self] in self?.failed(id) }
    }
}
