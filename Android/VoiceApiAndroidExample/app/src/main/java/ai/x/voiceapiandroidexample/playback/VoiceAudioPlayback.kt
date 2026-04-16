package ai.x.voiceapiandroidexample.playback

import ai.x.voiceapiandroidexample.VoiceInteractor
import android.util.Log
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.channels.Channel.Factory.UNLIMITED
import kotlinx.coroutines.channels.ReceiveChannel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.buffer
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalCoroutinesApi::class)
class VoiceAudioPlayback(
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) : AudioPlayback {

    override suspend fun awaitPlayback(
        audioFrames: ReceiveChannel<ByteArray>,
        interrupts: Flow<Unit>,
        muted: StateFlow<Boolean>,
        outputFormat: VoiceInteractor.AudioFormat,
    ) = withContext(ioDispatcher) {
        val sink = when (outputFormat) {
            VoiceInteractor.AudioFormat.PCM16 -> PcmAudioSink()
        }

        sink.use { s ->
            val mergedInterrupts = merge(
                interrupts,
                muted.drop(1).filter { it }, // drop initial
            )

            launch {
                mergedInterrupts
                    .onEach {
                        s.flush()
                        Log.d(AudioPlayback.Companion.TAG, "Audio playback interrupted")
                    }
                    .onStart { emit(Unit) }
                    .flatMapLatest { audioFrames.receiveAsFlow().buffer(UNLIMITED) }
                    .filter { !muted.value }
                    .collect { s.feed(it) }
            }

            launch { s.awaitDrain() }

            awaitCancellation()
        }
    }
}
