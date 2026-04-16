package ai.x.voiceapiandroidexample.capture

import android.Manifest
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AudioEffect
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.util.Log
import androidx.annotation.RequiresPermission
import kotlin.time.Duration
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.launch

class VoiceAudioCapture(
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : AudioCapture {
    @RequiresPermission(Manifest.permission.RECORD_AUDIO)
    override fun capture(
        muted: StateFlow<Boolean>,
        encoding: AudioCapture.Encoding,
        ringBufferLength: Duration,
    ): Flow<ByteArray> = flowWithScope { scope ->
        val encoder = when (encoding) {
            AudioCapture.Encoding.PCM16 -> PassthroughEncoder(ringBufferLength)
        }

        scope.launch { drainRecord(encoder, muted) }
        emitAll(encoder.awaitPackets())
    }.flowOn(io)
}

private inline fun <T> flowWithScope(
    crossinline block: suspend FlowCollector<T>.(scope: CoroutineScope) -> Unit,
): Flow<T> = flow {
    coroutineScope { block(this) }
}

@RequiresPermission(Manifest.permission.RECORD_AUDIO)
private suspend fun drainRecord(
    encoder: AudioEncoder,
    muted: StateFlow<Boolean>,
) = coroutineScope {
    var record: AudioRecord? = null
    var effects: List<AudioEffect> = emptyList()
    try {
        record = createAudioRecord()
        record.startRecording()
        effects = attachAndEnableAudioEffects(record.audioSessionId)
        encoder.start()

        Log.d(AudioCapture.TAG, "Audio capture started")

        encoder.encodeEach { buffer ->
            if (muted.value) muted.first { !it }
            val bytesRead = record.read(buffer, AudioCapture.FRAME_SIZE_BYTES)
            buffer.position(bytesRead.coerceAtLeast(0))
            if (bytesRead < 0) {
                throw AudioCapture.AudioCaptureException(bytesRead)
            }
        }
    } finally {
        record?.release()
        encoder.release()
        effects.forEach(AudioEffect::release)
        Log.d(AudioCapture.TAG, "Audio capture cancelled")
    }
}

@RequiresPermission(Manifest.permission.RECORD_AUDIO)
private fun createAudioRecord(): AudioRecord {
    val bufferSize = AudioRecord.getMinBufferSize(
        AudioCapture.SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
    ).coerceAtLeast(AudioCapture.FRAME_SIZE_BYTES)

    return AudioRecord(
        MediaRecorder.AudioSource.VOICE_COMMUNICATION,
        AudioCapture.SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        bufferSize,
    )
}

private fun attachAndEnableAudioEffects(audioSessionId: Int): List<AudioEffect> = buildList {
    fun tryEnableEffect(factory: () -> AudioEffect?): AudioEffect? {
        val effect = try {
            factory()
        } catch (_: Exception) {
            null
        } ?: return null
        return try {
            effect.enabled = true
            effect
        } catch (_: Exception) {
            effect.release()
            null
        }
    }

    if (NoiseSuppressor.isAvailable()) {
        tryEnableEffect { NoiseSuppressor.create(audioSessionId) }?.let(::add)
    }
    if (AcousticEchoCanceler.isAvailable()) {
        tryEnableEffect { AcousticEchoCanceler.create(audioSessionId) }?.let(::add)
    }
    if (AutomaticGainControl.isAvailable()) {
        tryEnableEffect { AutomaticGainControl.create(audioSessionId) }?.let(::add)
    }
}


