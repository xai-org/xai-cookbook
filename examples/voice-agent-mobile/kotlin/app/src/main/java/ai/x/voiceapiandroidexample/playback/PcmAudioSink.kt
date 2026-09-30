package ai.x.voiceapiandroidexample.playback

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.util.Log

class PcmAudioSink : AudioSink {

    private val track by lazy {
        val channelMask = AudioFormat.CHANNEL_OUT_MONO
        val encoding = AudioFormat.ENCODING_PCM_16BIT
        val bufferSize = AudioTrack.getMinBufferSize(SAMPLE_RATE, channelMask, encoding)

        AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(SAMPLE_RATE)
                    .setChannelMask(channelMask)
                    .setEncoding(encoding)
                    .build(),
            )
            .setBufferSizeInBytes(bufferSize)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
            .also { it.play() }
    }

    private var trackInitialized = false

    override fun feed(packet: ByteArray) {
        if (!trackInitialized) {
            trackInitialized = true
            Log.d(AudioPlayback.Companion.TAG, "PCM playback started")
        }
        track.write(packet, 0, packet.size, AudioTrack.WRITE_BLOCKING)
    }

    override fun flush() {
        if (trackInitialized) {
            track.pause()
            track.flush()
            track.play()
        }
    }

    override suspend fun awaitDrain() = Unit

    override fun close() {
        if (trackInitialized) track.release()
        Log.d(AudioPlayback.Companion.TAG, "PCM sink closed")
    }

    companion object {
        private const val SAMPLE_RATE = 24000
    }
}
