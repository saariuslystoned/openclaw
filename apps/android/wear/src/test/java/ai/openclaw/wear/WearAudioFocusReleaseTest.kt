package ai.openclaw.wear

import android.content.Context
import android.media.AudioManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class WearAudioFocusReleaseTest {
  @Test
  fun transientLossReleasesTheInterruptedRequest() {
    val context = RuntimeEnvironment.getApplication()
    val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val audio = shadowOf(manager)
    var stops = 0
    val focus = WearAudioFocusController(context) { stops += 1 }

    try {
      assertTrue(focus.request())
      val listener = audio.lastAudioFocusRequest.listener
      listener.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT)
      assertEquals(1, stops)
      assertSame(listener, audio.lastAbandonedAudioFocusListener)
    } finally {
      focus.abandon()
    }
  }

  @Test
  fun focusGainKeepsPlaybackAndNormalCompletionStillReleasesTheRequest() {
    val context = RuntimeEnvironment.getApplication()
    val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val audio = shadowOf(manager)
    var stops = 0
    val focus = WearAudioFocusController(context) { stops += 1 }

    try {
      assertTrue(focus.request())
      val listener = audio.lastAudioFocusRequest.listener
      listener.onAudioFocusChange(AudioManager.AUDIOFOCUS_GAIN)
      assertEquals(0, stops)
      assertNull(audio.lastAbandonedAudioFocusListener)
      focus.abandon()
      assertSame(listener, audio.lastAbandonedAudioFocusListener)
    } finally {
      focus.abandon()
    }
  }
}
