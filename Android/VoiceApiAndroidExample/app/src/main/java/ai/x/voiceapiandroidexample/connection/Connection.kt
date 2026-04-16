package ai.x.voiceapiandroidexample.connection

import ai.x.voiceapiandroidexample.model.VoiceClientEvent
import ai.x.voiceapiandroidexample.model.VoiceServerEvent
import kotlinx.coroutines.channels.ReceiveChannel
import kotlinx.coroutines.flow.Flow

interface Connection {

    sealed interface Event {
        data object Connecting : Event
        data object Connected : Event
        data class Reconnecting(val attempt: Int, val cause: Throwable?) : Event
        data class Disconnected(val attempts: Int, val cause: Throwable?) : Event
        data class Realtime(val event: VoiceServerEvent) : Event
        data class Idle(val tier: Int) : Event
    }

    val binaryFrames: ReceiveChannel<ByteArray>

    suspend fun send(event: VoiceClientEvent)
    suspend fun send(data: ByteArray)
    fun connect(url: String): Flow<Event>
}
