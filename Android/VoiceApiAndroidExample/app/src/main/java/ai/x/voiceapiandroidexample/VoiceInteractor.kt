package ai.x.voiceapiandroidexample

import ai.x.voiceapiandroidexample.capture.AudioCapture
import ai.x.voiceapiandroidexample.capture.VoiceAudioCapture
import ai.x.voiceapiandroidexample.connection.Connection
import ai.x.voiceapiandroidexample.connection.VoiceConnection
import ai.x.voiceapiandroidexample.model.VoiceClientEvent
import ai.x.voiceapiandroidexample.model.VoiceContent
import ai.x.voiceapiandroidexample.model.VoiceItem
import ai.x.voiceapiandroidexample.model.VoiceServerEvent
import ai.x.voiceapiandroidexample.model.VoiceSession
import ai.x.voiceapiandroidexample.playback.AudioPlayback
import ai.x.voiceapiandroidexample.playback.VoiceAudioPlayback
import android.annotation.SuppressLint
import android.util.Base64
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingCommand
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.shareIn
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class VoiceInteractor(
    private val connectionFactory: (token: String) -> Connection = { VoiceConnection(it) },
    private val audioCapture: AudioCapture = VoiceAudioCapture(),
    private val audioPlayback: AudioPlayback = VoiceAudioPlayback(),
    private val computation: CoroutineDispatcher = Dispatchers.Default,
) {
    enum class AudioFormat { PCM16 }

    data class State(
        val speakerEnabled: Boolean,
        val micEnabled: Boolean,
        val sessionConfig: VoiceSession,
    )

    @Volatile
    private var connection: Connection? = null

    fun connect(
        serverUrl: String,
        token: String,
        inputFormat: AudioFormat = PCM16,
        outputFormat: AudioFormat = PCM16,
        enableMicOnConnect: Boolean = false,
        states: SharedFlow<State>,
    ): Flow<Connection.Event> = channelFlow {
        val connectionForAudio = CompletableDeferred<Connection>()
        launch { awaitCapture(states, enableMicOnConnect, connectionForAudio, inputFormat) }


        val conn = connectionFactory(token)
        connection = conn

        val sessionConfig = states.first().sessionConfig
        conn.send(VoiceClientEvent.SessionUpdate(session = sessionConfig))
        connectionForAudio.complete(conn)

        launch { syncStateChanges(conn, states) }

        val startConnection = ManualStart()
        val wsEvents = conn.connect(serverUrl).shareIn(this, startConnection)

        launch { awaitPlayback(states, conn, wsEvents, outputFormat) }

        wsEvents
            .onStart { startConnection.start() }
            .collect(channel::send)
    }
        .onCompletion { connection = null }
        .flowOn(computation)

    suspend fun sendTextMessage(message: String): Result<Unit> {
        val conn = connection
            ?: return Result.failure(IllegalStateException("Not connected"))

        return runCatching {
            val item = VoiceItem(
                type = "message",
                role = "user",
                content = listOf(VoiceContent(type = "input_text", text = message)),
            )
            conn.send(VoiceClientEvent.ConversationItemCreate(item = item))
            conn.send(VoiceClientEvent.ResponseCreate)
        }
    }

    @SuppressLint("MissingPermission")//permission should be checked in the UI
    private suspend fun awaitCapture(
        states: SharedFlow<State>,
        enableMicOnConnect: Boolean,
        connectionForAudio: CompletableDeferred<Connection>,
        inputFormat: AudioFormat,
    ) = coroutineScope {
        val micMuted = states.map { !it.micEnabled }
            .stateIn(this, SharingStarted.Eagerly, !enableMicOnConnect)

        if (micMuted.value) micMuted.first { !it }

        val encoding = when (inputFormat) {
            PCM16 -> AudioCapture.Encoding.PCM16
        }

        audioCapture.capture(
            muted = micMuted,
            encoding = encoding,
            ringBufferLength = 3.seconds,
        ).collect { chunk ->
            val conn = connectionForAudio.await()
            when (inputFormat) {
                PCM16 -> {
                    val b64 = Base64.encodeToString(chunk, Base64.NO_WRAP)
                    conn.send(VoiceClientEvent.InputAudioBufferAppend(audio = b64))
                }
            }
        }
    }

    private suspend fun awaitPlayback(
        states: SharedFlow<State>,
        conn: Connection,
        wsEvents: SharedFlow<Connection.Event>,
        outputFormat: AudioFormat,
    ) = coroutineScope {
        val speakerMuted = states.map { !it.speakerEnabled }
            .stateIn(this, SharingStarted.Eagerly, false)

        val interrupts = wsEvents
            .filterIsInstance<Connection.Event.Realtime>()
            .filter { it.event is VoiceServerEvent.InputAudioBufferSpeechStarted }
            .map { Unit }

        audioPlayback.awaitPlayback(conn.binaryFrames, interrupts, speakerMuted, outputFormat)
    }
}

private suspend fun syncStateChanges(
    connection: Connection,
    states: Flow<VoiceInteractor.State>,
) = states
    .map { it.sessionConfig }
    .distinctUntilChanged()
    .filterNotNull()
    .collectLatest { config ->
        connection.send(VoiceClientEvent.SessionUpdate(session = config))
    }

private class ManualStart : SharingStarted {
    private val started = CompletableDeferred<Unit>()

    fun start() {
        started.complete(Unit)
    }

    override fun command(subscriptionCount: StateFlow<Int>): Flow<SharingCommand> = flow {
        started.await()
        emit(START)
    }
}
