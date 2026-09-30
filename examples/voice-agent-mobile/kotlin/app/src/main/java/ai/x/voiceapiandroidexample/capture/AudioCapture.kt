package ai.x.voiceapiandroidexample.capture

import android.Manifest
import android.media.AudioRecord
import androidx.annotation.RequiresPermission
import kotlin.time.Duration
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

interface AudioCapture {

    enum class Encoding { PCM16 }

    @RequiresPermission(Manifest.permission.RECORD_AUDIO)
    fun capture(
        muted: StateFlow<Boolean>,
        encoding: Encoding,
        ringBufferLength: Duration,
    ): Flow<ByteArray>

    class AudioCaptureException(val reason: Reason) : Exception("AudioRecord.read failed: $reason") {
        constructor(errorCode: Int) : this(
            when (errorCode) {
                AudioRecord.ERROR_INVALID_OPERATION -> Reason.INVALID_OPERATION
                AudioRecord.ERROR_BAD_VALUE -> Reason.BAD_VALUE
                AudioRecord.ERROR_DEAD_OBJECT -> Reason.DEAD_OBJECT
                else -> Reason.UNKNOWN
            },
        )

        enum class Reason {
            INVALID_OPERATION,
            BAD_VALUE,
            DEAD_OBJECT,
            UNKNOWN,
        }
    }

    companion object {
        internal const val SAMPLE_RATE = 24000
        internal const val FRAME_DURATION_MS = 20.0
        private const val BYTES_PER_SAMPLE = 2
        internal const val FRAME_SIZE_BYTES = (SAMPLE_RATE * FRAME_DURATION_MS / 1000 * BYTES_PER_SAMPLE).toInt()
        internal const val TAG = "AudioCapture"
    }
}
