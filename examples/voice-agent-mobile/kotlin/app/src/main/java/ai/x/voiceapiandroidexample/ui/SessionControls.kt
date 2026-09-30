package ai.x.voiceapiandroidexample.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ai.x.voiceapiandroidexample.VoiceViewModel.ConnectionState

val VOICES = listOf("eve", "ara", "rex", "sal", "leo")

private val VOICE_LABELS = mapOf(
    "eve" to "Eve",
    "ara" to "Ara",
    "rex" to "Rex",
    "sal" to "Sal",
    "leo" to "Leo",
)

@Composable
fun SessionControls(
    connection: ConnectionState,
    micActive: Boolean,
    speakerEnabled: Boolean,
    selectedVoice: String,
    onSelectVoice: (String) -> Unit,
    onToggleMic: () -> Unit,
    onToggleSpeaker: () -> Unit,
    onConnect: () -> Unit,
) {
    val pillShape = RoundedCornerShape(50)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        VoiceSelector(
            selectedVoice = selectedVoice,
            onSelect = onSelectVoice,
            modifier = Modifier.weight(1f),
        )

        ToggleButton(
            active = micActive,
            activeIcon = Icons.Filled.Mic,
            inactiveIcon = Icons.Filled.MicOff,
            contentDescription = if (micActive) "Mute" else "Unmute",
            onClick = onToggleMic,
            modifier = Modifier.weight(1f),
        )

        ToggleButton(
            active = speakerEnabled,
            activeIcon = Icons.AutoMirrored.Filled.VolumeUp,
            inactiveIcon = Icons.AutoMirrored.Filled.VolumeOff,
            contentDescription = if (speakerEnabled) "Mute speaker" else "Unmute speaker",
            onClick = onToggleSpeaker,
            modifier = Modifier.weight(1f),
        )

        val connectColor = when (connection) {
            ConnectionState.DISCONNECTED -> Color(0xFF4CAF50)
            ConnectionState.CONNECTING -> Color(0xFFFFA000)
            ConnectionState.CONNECTED -> MaterialTheme.colorScheme.error
        }
        val isDisconnected = connection == ConnectionState.DISCONNECTED
        Button(
            onClick = onConnect,
            shape = pillShape,
            colors = ButtonDefaults.buttonColors(containerColor = connectColor),
            modifier = Modifier.weight(1f),
        ) {
            Icon(
                imageVector = if (isDisconnected) Icons.Filled.Call else Icons.Filled.CallEnd,
                contentDescription = if (isDisconnected) "Connect" else "Disconnect",
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

@Composable
private fun VoiceSelector(
    selectedVoice: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    val pillShape = RoundedCornerShape(50)

    Button(
        onClick = { expanded = true },
        shape = pillShape,
        modifier = modifier,
    ) {
        Text(VOICE_LABELS[selectedVoice] ?: selectedVoice, fontSize = 12.sp)
    }

    DropdownMenu(
        expanded = expanded,
        onDismissRequest = { expanded = false },
    ) {
        VOICES.forEach { voice ->
            DropdownMenuItem(
                text = { Text(VOICE_LABELS[voice] ?: voice) },
                onClick = {
                    onSelect(voice)
                    expanded = false
                },
            )
        }
    }
}

@Composable
private fun ToggleButton(
    active: Boolean,
    activeIcon: ImageVector,
    inactiveIcon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val pillShape = RoundedCornerShape(50)
    Button(
        onClick = onClick,
        shape = pillShape,
        colors = if (active) ButtonDefaults.filledTonalButtonColors()
        else ButtonDefaults.buttonColors(containerColor = Color(0xFFCF6679)),
        modifier = modifier,
    ) {
        Icon(
            imageVector = if (active) activeIcon else inactiveIcon,
            contentDescription = contentDescription,
            modifier = Modifier.size(18.dp),
        )
    }
}
