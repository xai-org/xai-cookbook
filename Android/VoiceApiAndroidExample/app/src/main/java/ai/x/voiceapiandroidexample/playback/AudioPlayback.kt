package ai.x.voiceapiandroidexample.playback

import ai.x.voiceapiandroidexample.VoiceInteractor
import kotlinx.coroutines.channels.ReceiveChannel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

interface AudioPlayback {
    suspend fun awaitPlayback(
        audioFrames: ReceiveChannel<ByteArray>,
        interrupts: Flow<Unit>,
        muted: StateFlow<Boolean>,
        outputFormat: VoiceInteractor.AudioFormat,
    )

    companion object {
        internal const val TAG = "AudioPlayback"
    }
}
