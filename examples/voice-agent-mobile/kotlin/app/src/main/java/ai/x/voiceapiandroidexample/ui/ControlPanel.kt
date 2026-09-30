package ai.x.voiceapiandroidexample.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ai.x.voiceapiandroidexample.VoiceViewModel.ConnectionState
import ai.x.voiceapiandroidexample.VoiceViewModel.Speaker

@Composable
@OptIn(ExperimentalLayoutApi::class)
fun ControlPanel(
    connection: ConnectionState,
    speaker: Speaker,
    micActive: Boolean,
    speakerEnabled: Boolean,
    selectedVoice: String,
    onSelectVoice: (String) -> Unit,
    onToggleMic: () -> Unit,
    onToggleSpeaker: () -> Unit,
    onConnect: () -> Unit,
    onDisconnect: () -> Unit,
) {
    val imeVisible = WindowInsets.isImeVisible
    val isDisconnected = connection == ConnectionState.DISCONNECTED
    if (!imeVisible) {
        FadeGradient()
        SpeakerIndicator(speaker)
        SessionControls(
            connection = connection,
            micActive = micActive,
            speakerEnabled = speakerEnabled,
            selectedVoice = selectedVoice,
            onSelectVoice = onSelectVoice,
            onToggleMic = onToggleMic,
            onToggleSpeaker = onToggleSpeaker,
            onConnect = { if (isDisconnected) onConnect() else onDisconnect() },
        )
    }
}

@Composable
private fun FadeGradient() {
    val bgColor = MaterialTheme.colorScheme.surface
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(24.dp)
            .background(
                Brush.verticalGradient(
                    colors = listOf(Color.Transparent, bgColor),
                )
            )
    )
}

@Composable
private fun SpeakerIndicator(speaker: Speaker) {
    if (speaker == Speaker.NONE) return

    val label = if (speaker == Speaker.USER) "You" else "xAi"
    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Text(
            text = label,
            fontSize = 11.sp,
            color = Color.Gray.copy(alpha = 0.7f),
            modifier = Modifier
                .clip(RoundedCornerShape(12.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                .padding(horizontal = 12.dp, vertical = 2.dp),
        )
    }
}
