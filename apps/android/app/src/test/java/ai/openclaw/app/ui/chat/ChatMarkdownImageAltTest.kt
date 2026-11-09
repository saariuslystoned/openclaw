package ai.openclaw.app.ui.chat

import ai.openclaw.app.ui.design.ClawDesignTheme
import ai.openclaw.app.ui.design.ClawTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w360dp-h800dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ChatMarkdownImageAltTest {
  @get:Rule
  val composeRule = createComposeRule()

  @Test
  fun remoteImageAltRetainsCodeInsideEmphasis() {
    show("![Open **`setup.json`** now](https://example.com/diagram.png)")

    composeRule.onNodeWithText("Open setup.json now").assertIsDisplayed()
  }

  @Test
  fun codeOnlyAltDoesNotUseEmptyAltFallback() {
    show(
      """
      ![`setup.json`](https://example.com/config.png)

      ![Plain diagram](https://example.com/plain.png)

      ![](https://example.com/empty.png)
      """.trimIndent(),
    )

    composeRule.onNodeWithText("Plain diagram").assertIsDisplayed()
    composeRule.onNodeWithText("setup.json").assertIsDisplayed()
    composeRule.onNodeWithText("image").assertIsDisplayed()
  }

  private fun show(markdown: String) {
    composeRule.setContent {
      ClawDesignTheme(dark = true) {
        ChatMarkdown(text = markdown, textColor = ClawTheme.colors.text)
      }
    }
  }
}
