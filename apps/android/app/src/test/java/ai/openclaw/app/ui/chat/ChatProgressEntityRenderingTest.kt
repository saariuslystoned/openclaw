package ai.openclaw.app.ui.chat

import ai.openclaw.app.ui.design.ClawDesignTheme
import ai.openclaw.app.ui.design.ClawTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w360dp-h800dp-mdpi")
class ChatProgressEntityRenderingTest {
  @get:Rule
  val composeRule = createComposeRule()

  @Test
  fun progressLabelDecodesCharacterReferencesForVisibleAndAccessibleText() {
    show(
      """
      Working

      <progress aria-label="Build &amp; test &#34;ready&#34;" value="2" max="5"></progress>

      Still running
      """.trimIndent(),
    )

    composeRule.onNodeWithText("Build & test \"ready\"").assertIsDisplayed()
    composeRule
      .onNodeWithContentDescription("Build & test \"ready\"")
      .assert(
        SemanticsMatcher.expectValue(
          SemanticsProperties.ProgressBarRangeInfo,
          ProgressBarRangeInfo(0.4f, 0f..1f),
        ),
      )
    composeRule.onNodeWithText("Working").assertIsDisplayed()
    composeRule.onNodeWithText("Still running").assertIsDisplayed()
  }

  @Test
  fun encodedMarkupStaysLiteralAndPlainProgressStillRenders() {
    show(
      """
      <progress aria-label="&lt;b&gt; &amp;amp;" value="1" max="4"></progress>

      <progress aria-label="Plain label" value="3" max="4"></progress>
      """.trimIndent(),
    )

    composeRule.onNodeWithText("<b> &amp;").assertIsDisplayed()
    composeRule
      .onNodeWithContentDescription("<b> &amp;")
      .assert(
        SemanticsMatcher.expectValue(
          SemanticsProperties.ProgressBarRangeInfo,
          ProgressBarRangeInfo(0.25f, 0f..1f),
        ),
      )
    composeRule.onNodeWithText("Plain label").assertIsDisplayed()
    composeRule
      .onNodeWithContentDescription("Plain label")
      .assert(
        SemanticsMatcher.expectValue(
          SemanticsProperties.ProgressBarRangeInfo,
          ProgressBarRangeInfo(0.75f, 0f..1f),
        ),
      )
  }

  private fun show(source: String) {
    composeRule.setContent {
      ClawDesignTheme(dark = true) {
        Box(Modifier.size(360.dp, 800.dp)) {
          ChatMarkdown(text = source, textColor = ClawTheme.colors.text, progressBars = true)
        }
      }
    }
  }
}
