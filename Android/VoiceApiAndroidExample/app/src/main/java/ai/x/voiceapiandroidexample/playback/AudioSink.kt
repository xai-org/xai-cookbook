package ai.x.voiceapiandroidexample.playback

import java.io.Closeable

interface AudioSink : Closeable {
    fun feed(packet: ByteArray)
    fun flush()
    suspend fun awaitDrain()
}
