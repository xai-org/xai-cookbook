@file:Suppress("PropertyName", "ConstructorParameterNaming")

package ai.x.voiceapiandroidexample.model

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class VoiceSession(
    val instructions: String? = null,
    val voice: String? = null,
    val turn_detection: VoiceTurnDetection? = null,
)

@Serializable
@OptIn(ExperimentalSerializationApi::class)
data class VoiceTurnDetection(
    @EncodeDefault val type: String? = "server_vad",
    val threshold: Double? = null,
    val silence_duration_ms: Int? = null,
    val prefix_padding_ms: Int? = null,
)

@Serializable
data class VoiceConversation(
    val id: String? = null,
)

@Serializable
data class VoiceResponse(
    val id: String? = null,
    @SerialName("object") val object_type: String? = null,
    val status: String? = null,
    val instructions: String? = null,
)

@Serializable
data class VoiceItem(
    val id: String? = null,
    val type: String? = null,
    val role: String? = null,
    val content: List<VoiceContent>? = null,
    val status: String? = null,
    val attachment_ids: List<String>? = null,
)

@Serializable
data class VoiceContent(
    val type: String? = null,
    val transcript: String? = null,
    val audio: String? = null,
    val text: String? = null,
)
