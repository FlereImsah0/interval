package com.fleresjourney.intervaltimer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkoutTest {
    @Test
    fun deadlineArithmeticDoesNotAccumulateDrift() {
        val plan = WorkoutPlan(1, 1, 9999, false, false)
        for (index in 0L until 9999L) {
            val beginning = index * 2000
            assertEquals(Phase(Stage.ACTIVE, index + 1, beginning, beginning + 1000), plan.phaseAt(beginning))
        }
        assertEquals(Stage.COMPLETE, plan.phaseAt(19_997_000L).stage)
    }

    @Test
    fun pauseDoesNotMoveTheNextPhase() {
        var time = 0L
        val workout = Workout(WorkoutPlan(3, 2, 0, true, false)) { time }
        assertEquals(3, countdownAt(workout.snapshot(), -1))
        time = 1200
        workout.pause()
        time += 20_000
        assertEquals(1800L, workout.snapshot().remaining)
        assertNull(countdownAt(workout.snapshot(), 0))
        workout.resume()
        time += 1800
        assertEquals(Stage.REST, workout.snapshot().phase.stage)
        assertEquals(2, countdownAt(workout.snapshot(), 2999))
    }

    @Test
    fun roundLimitIncludesRest() {
        assertTrue(runCatching { WorkoutPlan(86_399, 1, 1, false, false) }.isSuccess)
        assertTrue(runCatching { WorkoutPlan(86_399, 12, 1, false, false) }.isFailure)
    }
}
