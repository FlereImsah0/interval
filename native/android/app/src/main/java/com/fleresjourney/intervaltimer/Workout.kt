package com.fleresjourney.intervaltimer

internal const val MAX_ROUND_SECONDS = 86_400

internal data class WorkoutPlan(
    val activeSeconds: Int,
    val restSeconds: Int,
    val rounds: Int,
    val hasVoice: Boolean,
    val vibration: Boolean,
) {
    init {
        require(activeSeconds in 1..MAX_ROUND_SECONDS)
        require(restSeconds in 0..MAX_ROUND_SECONDS - activeSeconds)
        require(rounds in 0..9999)
    }

    fun phaseAt(elapsed: Long): Phase {
        val active = activeSeconds * 1000L
        val rest = restSeconds * 1000L
        val total = rounds * (active + rest) - rest
        if (rounds != 0 && elapsed >= total) return Phase(Stage.COMPLETE, rounds.toLong(), total, total)
        val index = elapsed / (active + rest)
        val start = index * (active + rest)
        val activeEnd = start + active
        return if (elapsed < activeEnd) Phase(Stage.ACTIVE, index + 1, start, activeEnd)
        else Phase(Stage.REST, index + 1, activeEnd, start + active + rest)
    }
}

internal enum class Stage(val label: String) { ACTIVE("Active"), REST("Rest"), COMPLETE("Workout complete") }

internal data class Phase(val stage: Stage, val round: Long, val start: Long, val end: Long)

internal data class TimerSnapshot(val phase: Phase, val elapsed: Long, val paused: Boolean) {
    val remaining: Long get() = (phase.end - elapsed).coerceAtLeast(0)
}

internal class Workout(private val plan: WorkoutPlan, private val clock: () -> Long) {
    private var origin = clock()
    private var pausedAt: Long? = null

    fun snapshot(): TimerSnapshot {
        val elapsed = (pausedAt ?: clock()) - origin
        return TimerSnapshot(plan.phaseAt(elapsed), elapsed, pausedAt != null)
    }

    fun pause() {
        if (pausedAt == null) pausedAt = clock()
    }

    fun resume() {
        val paused = pausedAt ?: return
        origin += clock() - paused
        pausedAt = null
    }
}

internal fun countdownAt(snapshot: TimerSnapshot, previous: Long): Int? {
    if (snapshot.paused || snapshot.phase.stage == Stage.COMPLETE) return null
    return (1..3).firstOrNull { seconds ->
        val elapsed = snapshot.phase.end - seconds * 1000L
        elapsed >= snapshot.phase.start && elapsed > previous && snapshot.elapsed - elapsed in 0L..300L
    }
}
