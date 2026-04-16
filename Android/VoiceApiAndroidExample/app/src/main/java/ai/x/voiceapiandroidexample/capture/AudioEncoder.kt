package ai.x.voiceapiandroidexample.capture

import java.nio.ByteBuffer
import kotlinx.coroutines.channels.ReceiveChannel

internal interface AudioEncoder {
    suspend fun awaitPackets(): ReceiveChannel<ByteArray>
    suspend fun encodeEach(block: suspend (ByteBuffer) -> Unit)
    fun start()
    fun release()
}
