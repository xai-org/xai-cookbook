@file:Suppress("PropertyName", "ConstructorParameterNaming")

package ai.x.voiceapiandroidexample.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

@Serializable
sealed class VoiceServerEvent {

    @Serializable
    @SerialName("session.created")
    data class SessionCreated(
        val event_id: String? = null,
        val session: VoiceSession? = null,
    ) : VoiceServerEvent()

    @Serializable
    @SerialName("session.updated")
    data class SessionUpdated(
        val event_id: String? = null,
        val session: VoiceSession? = null,
    ) : VoiceServerEvent()

    @Serializable
    @SerialName("conversation.created")
    data class ConversationCreated(
        val event_id: String? = null,
        val conversation: VoiceConversation? = null,
    ) : VoiceServerEvent()

    @Serializable
    @SerialName("conversation.item.added")
    data class ConversationItemAdded(
        val event_id: String? = null,
        val item: JsonElement? = null,
    ) : VoiceServerEvent()

    @Serializable
    @SerialName("conversation.item.deleted")
    data class ConversationItemDeleted(
        val event_id: String? = null,
        val item_id: String? = null,
    ) : VoiceServerEvent()

    @Serializable
    @SerialName("input_audio_buffer.speech_started")
    data class InputAudioBufferSpeechStarted(
        val event_id: String? = null,
        val item_id: String? = null,
        val audio_start_ms: Long? = null,
    ) : VoiceServerEvent()

    @Serializable
    @SerialName("input_audio_buffer.speech_stopped")
    data class InputAudioBufferSpeechStopped(
        val event_id: String? = null,
        val item_id: String? = null,
        val audio_end_ms: Long? = null,
    ) : VoiceServerEvent()

    @Serializable
    @SerialName("input_audio_buffer.committed")
    data class InputAudioBufferCommitted(
        val event_id: String? = null,
        val item_id: String? = null,
    ) : VoiceServerEvent()

    @Serializable
    @SerialName("conversation.item.input_audio_transcription.completed")
    data class InputAudioTranscriptionCompleted(
        val event_id: String? = null,
        val item_id: String? = null,
        val transcript: String? = null,
    ) : VoiceServerEvent()

    @Serializable
    @SerialName("response.created")
    data class ResponseCreated(
        val event_id: String? = null,
        val response: VoiceResponse? = null,
    ) : VoiceServerEvent()

    @Serializable
    @SerialName("response.done")
    data class ResponseDone(
        val event_id: String? = null,
        val response: VoiceResponse? = null,
    ) : VoiceServerEvent()

    @Serializable
    @SerialName("response.output_audio.delta")
    data class ResponseOutputAudioDelta(
        val event_id: String? = null,
        val response_id: String? = null,
        val item_id: String? = null,
        val delta: String? = null,
    ) : VoiceServerEvent()

    @Serializable
    @SerialName("response.output_audio.done")
    data class ResponseOutputAudioDone(
        val event_id: String? = null,
        val response_id: String? = null,
    ) : VoiceServerEvent()

    @Serializable
    @SerialName("response.output_audio_transcript.delta")
    data class ResponseOutputAudioTranscriptDelta(
        val event_id: String? = null,
        val response_id: String? = null,
        val delta: String? = null,
    ) : VoiceServerEvent()

    @Serializable
    @SerialName("response.output_audio_transcript.done")
    data class ResponseOutputAudioTranscriptDone(
        val event_id: String? = null,
        val response_id: String? = null,
    ) : VoiceServerEvent()

    @Serializable
    @SerialName("response.text.delta")
    data class ResponseTextDelta(
        val event_id: String? = null,
        val response_id: String? = null,
        val delta: String? = null,
    ) : VoiceServerEvent()

    @Serializable
    @SerialName("response.function_call_arguments.delta")
    data class ResponseFunctionCallArgumentsDelta(
        val event_id: String? = null,
        val response_id: String? = null,
        val call_id: String? = null,
        val delta: String? = null,
    ) : VoiceServerEvent()

    @Serializable
    @SerialName("response.function_call_arguments.done")
    data class ResponseFunctionCallArgumentsDone(
        val event_id: String? = null,
        val response_id: String? = null,
        val call_id: String? = null,
        val name: String? = null,
        val arguments: String? = null,
    ) : VoiceServerEvent()

    @Serializable
    @SerialName("ping")
    data class Ping(
        val timestamp: Long? = null,
    ) : VoiceServerEvent()

    @Serializable
    @SerialName("error")
    data class Error(
        val event_id: String? = null,
        val error: String? = null,
        val code: String? = null,
        val message: String? = null,
    ) : VoiceServerEvent()

    @Serializable(with = UnknownEventSerializer::class)
    data class Unknown(val raw: JsonObject) : VoiceServerEvent()
}

internal object UnknownEventSerializer : KSerializer<VoiceServerEvent.Unknown> {
    override val descriptor: SerialDescriptor = JsonObject.serializer().descriptor

    override fun deserialize(decoder: Decoder): VoiceServerEvent.Unknown {
        val raw = decoder.decodeSerializableValue(JsonObject.serializer())
        return VoiceServerEvent.Unknown(raw)
    }

    override fun serialize(encoder: Encoder, value: VoiceServerEvent.Unknown) {
        encoder.encodeSerializableValue(JsonObject.serializer(), value.raw)
    }
}
