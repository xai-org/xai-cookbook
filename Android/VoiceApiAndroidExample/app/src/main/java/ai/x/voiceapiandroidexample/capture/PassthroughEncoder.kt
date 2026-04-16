package ai.x.voiceapiandroidexample.capture

import java.nio.ByteBuffer
import kotlin.time.Duration
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.isActive

internal class PassthroughEncoder(
    ringBufferLength: Duration,
    frameDurationMs: Double = AudioCapture.FRAME_DURATION_MS,
    private val frameSizeBytes: Int = AudioCapture.FRAME_SIZE_BYTES,
) : AudioEncoder {

    private val packets = Channel<ByteArray>(
        (ringBufferLength.inWholeMilliseconds / frameDurationMs).toInt().coerceAtLeast(1),
        BufferOverflow.DROP_OLDEST,
    )

    override suspend fun awaitPackets(): Channel<ByteArray> = packets

    override suspend fun encodeEach(block: suspend (ByteBuffer) -> Unit) = coroutineScope {
        val buffer = ByteBuffer.allocateDirect(frameSizeBytes)
        while (isActive) {
            buffer.clear()
            block(buffer)
            val bytesWritten = buffer.position()
            if (bytesWritten > 0) {
                val chunk = ByteArray(bytesWritten)
                buffer.flip()
                buffer.get(chunk)
                packets.send(chunk)
            }
        }
    }

    override fun start() = Unit
    override fun release() {
        packets.close()
    }
}
