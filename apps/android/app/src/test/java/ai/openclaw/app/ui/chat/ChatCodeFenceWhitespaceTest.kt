package ai.openclaw.app.ui.chat

import ai.openclaw.app.ui.design.ClawDesignTheme
import ai.openclaw.app.ui.design.ClawTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.text.AnnotatedString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w360dp-h800dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ChatCodeFenceWhitespaceTest {
  @get:Rule
  val composeRule = createComposeRule()

  private val markdown = mutableStateOf("")
  private val streaming = mutableStateOf(false)
  private val code = "val count = 42"

  @Test
  fun tabSeparatedFenceAttributesKeepTheSameSyntaxColorsAsSpaces() {
    show(fence("kotlin linenums"))
    val spaceSeparated = renderedCode().spanStyles
    assertFalse("The known-language control must highlight", spaceSeparated.isEmpty())

    composeRule.runOnIdle { markdown.value = fence("kotlin\tlinenums") }

    assertEquals(spaceSeparated, renderedCode().spanStyles)
  }

  @Test
  fun openAndUnknownFencesStayPlainWhileClosedKnownFencesHighlight() {
    show(fence("kotlin\tlinenums", closed = false), isStreaming = true)
    assertTrue(renderedCode().spanStyles.isEmpty())

    composeRule.runOnIdle { markdown.value = fence("unknown\tlinenums") }
    assertTrue(renderedCode().spanStyles.isEmpty())

    composeRule.runOnIdle { markdown.value = fence("kotlin\tlinenums") }
    assertFalse("A closed known-language fence must highlight", renderedCode().spanStyles.isEmpty())
  }

  private fun show(
    source: String,
    isStreaming: Boolean = false,
  ) {
    markdown.value = source
    streaming.value = isStreaming
    composeRule.setContent {
      ClawDesignTheme(dark = true) {
        ChatMarkdown(
          text = markdown.value,
          textColor = ClawTheme.colors.text,
          isStreaming = streaming.value,
        )
      }
    }
  }

  private fun fence(
    info: String,
    closed: Boolean = true,
  ): String {
    val lines = mutableListOf("```$info", code)
    if (closed) lines += "```"
    return lines.joinToString("\n")
  }

  private fun renderedCode(): AnnotatedString {
    val node =
      composeRule
        .onNodeWithText(code, useUnmergedTree = true)
        .fetchSemanticsNode()
    return node.config[SemanticsProperties.Text].single()
  }
}
