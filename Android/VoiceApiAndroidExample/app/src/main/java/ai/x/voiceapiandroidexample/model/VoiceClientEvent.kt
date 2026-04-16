@file:Suppress("PropertyName", "ConstructorParameterNaming")

package ai.x.voiceapiandroidexample.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
sealed class VoiceClientEvent {

    @Serializable
    @SerialName("session.update")
    data class SessionUpdate(
        val session: VoiceSession,
    ) : VoiceClientEvent()

    @Serializable
    @SerialName("input_audio_buffer.append")
    data class InputAudioBufferAppend(
        val audio: String,
    ) : VoiceClientEvent()

    @Serializable
    @SerialName("input_audio_buffer.commit")
    data object InputAudioBufferCommit : VoiceClientEvent()

    @Serializable
    @SerialName("input_audio_buffer.clear")
    data object InputAudioBufferClear : VoiceClientEvent()

    @Serializable
    @SerialName("conversation.item.create")
    data class ConversationItemCreate(
        val item: VoiceItem,
    ) : VoiceClientEvent()

    @Serializable
    @SerialName("conversation.item.delete")
    data class ConversationItemDelete(
        val item_id: String,
    ) : VoiceClientEvent()

    @Serializable
    @SerialName("response.create")
    data object ResponseCreate : VoiceClientEvent()

    @Serializable
    @SerialName("response.cancel")
    data class ResponseCancel(
        val response_id: String? = null,
    ) : VoiceClientEvent()
}
