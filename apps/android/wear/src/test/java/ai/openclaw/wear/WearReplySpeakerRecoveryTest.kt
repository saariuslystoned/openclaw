package ai.openclaw.wear

import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import android.speech.tts.TextToSpeech
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowTextToSpeech
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], shadows = [RecoveringWearTextToSpeech::class])
class WearReplySpeakerRecoveryTest {
  @Before
  fun resetEngineFixture() {
    RecoveringWearTextToSpeech.createdCount = 0
  }

  @Test
  fun freshReplyRetriesAnEngineThatFailedInitialization() {
    val speaker = WearReplySpeaker(RuntimeEnvironment.getApplication())
    try {
      speaker.awaitWork()
      val failedEngine = ShadowTextToSpeech.getLastTextToSpeechInstance()
      speaker.speak("First reply")
      speaker.awaitWork()
      shadowOf(failedEngine).onInitListener.onInit(TextToSpeech.ERROR)
      speaker.awaitWork()
      assertTrue(speaker.failed.value)
      assertFalse(speaker.isSpeaking.value)

      speaker.speak("Recovered reply")
      speaker.awaitWork()
      speaker.awaitWork()
      val recoveredEngine = ShadowTextToSpeech.getLastTextToSpeechInstance()
      assertEquals("Recovered reply", shadowOf(recoveredEngine).lastSpokenText)
      assertTrue(shadowOf(failedEngine).isShutdown)
      assertFalse(speaker.failed.value)
      assertEquals(2, RecoveringWearTextToSpeech.createdCount)

      speaker.speak("Another reply")
      speaker.awaitWork()
      assertSame(recoveredEngine, ShadowTextToSpeech.getLastTextToSpeechInstance())
      assertEquals("Another reply", shadowOf(recoveredEngine).lastSpokenText)
    } finally {
      speaker.shutdownAndJoin()
    }
  }

  @Test
  fun healthyInitializationKeepsTheExistingEngineForLaterReplies() {
    val speaker = WearReplySpeaker(RuntimeEnvironment.getApplication())
    try {
      speaker.awaitWork()
      val engine = ShadowTextToSpeech.getLastTextToSpeechInstance()
      shadowOf(engine).onInitListener.onInit(TextToSpeech.SUCCESS)
      speaker.speak("Healthy reply")
      speaker.awaitWork()
      assertEquals("Healthy reply", shadowOf(engine).lastSpokenText)
      assertFalse(speaker.failed.value)
      speaker.stop()
      speaker.speak("Later reply")
      speaker.awaitWork()
      assertSame(engine, ShadowTextToSpeech.getLastTextToSpeechInstance())
      assertEquals("Later reply", shadowOf(engine).lastSpokenText)
      assertEquals(1, RecoveringWearTextToSpeech.createdCount)
    } finally {
      speaker.shutdownAndJoin()
    }
  }

  private fun WearReplySpeaker.awaitWork() {
    val completed = CountDownLatch(1)
    assertTrue((talkTestField("handler") as Handler).post { completed.countDown() })
    assertTrue("speech worker did not finish", completed.await(5, TimeUnit.SECONDS))
  }

  private fun WearReplySpeaker.shutdownAndJoin() {
    val worker = talkTestField("worker") as HandlerThread
    shutdown()
    worker.join(5_000)
    assertFalse("speech worker must exit after shutdown", worker.isAlive)
  }
}

@Implements(TextToSpeech::class)
class RecoveringWearTextToSpeech : ShadowTextToSpeech() {
  @Implementation
  override fun __constructor__(
    context: Context,
    listener: TextToSpeech.OnInitListener,
    engine: String?,
    packageName: String?,
    useFallback: Boolean,
  ) {
    super.__constructor__(context, listener, engine, packageName, useFallback)
    createdCount += 1
    if (createdCount > 1) listener.onInit(TextToSpeech.SUCCESS)
  }

  companion object {
    var createdCount = 0
  }
}
