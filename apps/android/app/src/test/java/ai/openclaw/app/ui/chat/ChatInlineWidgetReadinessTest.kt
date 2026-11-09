package ai.openclaw.app.ui.chat

import ai.openclaw.app.chat.ChatWidgetPreview
import ai.openclaw.app.ui.design.ClawDesignTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import kotlinx.coroutines.awaitCancellation
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31], qualifiers = "en-rUS-w360dp-h800dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ChatInlineWidgetReadinessTest {
  @get:Rule
  val composeRule = createComposeRule()

  private val preview =
    ChatWidgetPreview(
      title = "Release chart",
      path = "/__openclaw__/canvas/documents/release-chart/index.html",
      preferredHeight = null,
      sandbox = "strict",
    )
  private val progress = SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo)

  @Test
  fun offlineWidgetIsUnavailableWithoutStartingAReadAndRetriesOnReconnect() {
    val ready = mutableStateOf(false)
    var reads = 0
    composeRule.setContent {
      ClawDesignTheme {
        ChatInlineWidget(preview, ready.value) { _, _ ->
          reads += 1
          null
        }
      }
    }

    composeRule.onNodeWithText("Widget unavailable").assertIsDisplayed()
    composeRule.onNode(progress).assertDoesNotExist()
    composeRule.runOnIdle {
      assertEquals(0, reads)
      ready.value = true
    }
    composeRule.onNodeWithText("Widget unavailable").assertIsDisplayed()
    composeRule.runOnIdle { assertEquals(1, reads) }
  }

  @Test
  fun disconnectCancelsAnActiveReadAndStopsItsLoadingIndicator() {
    val ready = mutableStateOf(true)
    var reads = 0
    var cancellations = 0
    composeRule.setContent {
      ClawDesignTheme {
        ChatInlineWidget(preview, ready.value) { _, _ ->
          reads += 1
          try {
            awaitCancellation()
          } finally {
            cancellations += 1
          }
        }
      }
    }

    composeRule.onNode(progress).assertIsDisplayed()
    composeRule.onNodeWithText("Widget unavailable").assertDoesNotExist()
    composeRule.runOnIdle { ready.value = false }
    composeRule.onNodeWithText("Widget unavailable").assertIsDisplayed()
    composeRule.onNode(progress).assertDoesNotExist()
    composeRule.runOnIdle {
      assertEquals(1, reads)
      assertEquals(1, cancellations)
      ready.value = true
    }
    composeRule.onNode(progress).assertIsDisplayed()
    composeRule.onNodeWithText("Widget unavailable").assertDoesNotExist()
    composeRule.runOnIdle {
      assertEquals(2, reads)
      ready.value = false
    }
    composeRule.onNodeWithText("Widget unavailable").assertIsDisplayed()
    composeRule.runOnIdle { assertEquals(2, cancellations) }
  }
}
