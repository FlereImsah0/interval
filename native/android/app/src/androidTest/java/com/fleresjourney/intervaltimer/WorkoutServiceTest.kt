package com.fleresjourney.intervaltimer

import android.content.Intent
import android.os.ParcelFileDescriptor
import android.os.PowerManager
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkoutServiceTest {
    @Test
    fun foregroundWorkoutKeepsTimeWhenTheActivityLeavesTheScreen() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        ActivityScenario.launch(TimerActivity::class.java).use { activity ->
            activity.onActivity { screen ->
                val views = screen.window.decorView.descendants().toList()
                views.filterIsInstance<EditText>().zip(listOf("1", "1", "10"))
                    .forEach { (field, text) -> field.setText(text) }
                views.filterIsInstance<Button>().first { it.text == "Start workout" }.performClick()
            }
            instrumentation.waitForIdleSync()
            activity.moveToState(Lifecycle.State.CREATED)
            var snapshot: TimerSnapshot? = null
            val limit = android.os.SystemClock.elapsedRealtime() + 6_000
            do {
                instrumentation.runOnMainSync { snapshot = WorkoutService.current?.snapshot() }
                if (snapshot?.phase?.round?.let { it >= 2 } == true) break
                Thread.sleep(100)
            } while (android.os.SystemClock.elapsedRealtime() < limit)
            assertNotNull("The foreground service kept the workout running", snapshot)
            assertTrue("The second round began without the app screen", snapshot!!.phase.round >= 2)

            activity.moveToState(Lifecycle.State.RESUMED)
            activity.onActivity { screen ->
                val buttons = screen.window.decorView.descendants().filterIsInstance<Button>().toList()
                buttons.first { it.text == "End workout" }.performClick()
            }
            instrumentation.waitForIdleSync()
            instrumentation.runOnMainSync { assertEquals(null, WorkoutService.current) }
        }
    }

    @Test
    fun foregroundWorkoutKeepsTimeWithTheDisplayOff() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val power = checkNotNull(context.getSystemService(PowerManager::class.java))
        ActivityScenario.launch(TimerActivity::class.java).use { activity ->
            activity.onActivity { screen ->
                val intent = Intent(screen, WorkoutService::class.java).setAction(WorkoutService.START)
                    .putExtra("active", 1).putExtra("rest", 1).putExtra("rounds", 10)
                screen.startForegroundService(intent)
            }
            instrumentation.waitForIdleSync()
            try {
                shell("input keyevent KEYCODE_SLEEP")
                val deadline = SystemClock.elapsedRealtime() + 6000
                var passedRound = false
                do {
                    instrumentation.runOnMainSync {
                        passedRound = WorkoutService.current?.snapshot()?.phase?.round?.let { it >= 2 } == true
                    }
                    if (passedRound && !power.isInteractive) break
                    Thread.sleep(100)
                } while (SystemClock.elapsedRealtime() < deadline)
                assertFalse("The screen went to sleep", power.isInteractive)
                assertTrue("The second round began with the display off", passedRound)
            } finally {
                shell("input keyevent KEYCODE_WAKEUP")
                context.stopService(Intent(context, WorkoutService::class.java))
                instrumentation.waitForIdleSync()
            }
        }
    }

    private fun shell(command: String) {
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand(command)).use { stream ->
            stream.readBytes()
        }
    }

    private fun View.descendants(): Sequence<View> = sequence {
        yield(this@descendants)
        if (this@descendants is ViewGroup) {
            for (index in 0 until childCount) yieldAll(getChildAt(index).descendants())
        }
    }
}
