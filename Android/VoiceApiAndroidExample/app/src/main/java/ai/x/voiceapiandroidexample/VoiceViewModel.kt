package ai.x.voiceapiandroidexample

import ai.x.voiceapiandroidexample.VoiceViewModel.ChatMessage
import ai.x.voiceapiandroidexample.VoiceViewModel.ConnectionState.DISCONNECTED
import ai.x.voiceapiandroidexample.VoiceViewModel.State
import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import ai.x.voiceapiandroidexample.VoiceInteractor.AudioFormat
import ai.x.voiceapiandroidexample.connection.Connection
import ai.x.voiceapiandroidexample.model.VoiceServerEvent
import ai.x.voiceapiandroidexample.model.VoiceServerEvent.ResponseTextDelta
import ai.x.voiceapiandroidexample.model.VoiceSession
import ai.x.voiceapiandroidexample.model.VoiceTurnDetection
import android.util.Log
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.transformLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

@OptIn(ExperimentalCoroutinesApi::class)
class VoiceViewModel(application: Application) : AndroidViewModel(application) {

    enum class ConnectionState { DISCONNECTED, CONNECTING, CONNECTED }
    enum class Speaker { NONE, USER, ASSISTANT }

    data class State(
        val connection: ConnectionState = DISCONNECTED,
        val speaker: Speaker = NONE,
        val conversationId: String? = null,
        val micActive: Boolean = true,
        val micGranted: Boolean = false,
        val micRequested: Boolean = false,
        val requestMic: Boolean = false,
        val speakerEnabled: Boolean = true,
        val inputFormat: AudioFormat = PCM16,
        val outputFormat: AudioFormat = PCM16,
        val sessionConfig: VoiceSession = VoiceSession(
            voice = "eve",
            instructions = "You are a helpful assistant.",
            turn_detection = VoiceTurnDetection(type = "server_vad"),
        ),
        val pendingTextMessage: String? = null,
        val chatMessages: List<ChatMessage> = emptyList(),
        val logLines: List<String> = emptyList(),
        val isApiKeyConfigured: Boolean = true,
    ) {
        val effectiveMicActive: Boolean get() = micActive && micGranted
    }

    data class ChatMessage(val role: Speaker, val text: String = "")

    private val voiceInteractor = VoiceInteractor()
    private val authService = AuthService()
    val state: StateFlow<State>
        field = MutableStateFlow(State())

    init {
        viewModelScope.launch { observeSession() }
    }

    fun connect() {
        if (state.value.connection != DISCONNECTED) return

        val s = state.value
        if (!s.micGranted && !s.micRequested) {
            updateState { copy(requestMic = true, micRequested = true) }
            return
        }

        updateState { copy(connection = CONNECTING) }
    }
    fun disconnect() = updateState { copy(connection = DISCONNECTED) }

    fun onMicPermissionResult(granted: Boolean) = updateState { copy(micGranted = granted, requestMic = false) }
    fun toggleMic() {
        if (!state.value.micGranted && !state.value.micRequested) {
            updateState { copy(requestMic = true) }
            return
        }
        updateState { copy(micActive = !micActive) }
    }
    fun toggleSpeaker() = updateState { copy(speakerEnabled = !speakerEnabled) }
    fun setVoice(voice: String) = updateState {
        copy(sessionConfig = sessionConfig.copy(voice = voice))
    }

    fun sendTextMessage(message: String) {
        if (message.isBlank()) return
        updateState { copy(chatMessages = addMessage(USER, message)) }
        if (state.value.connection == DISCONNECTED) {
            updateState { copy(pendingTextMessage = message) }
            connect()
        } else {
            viewModelScope.launch {
                voiceInteractor.sendTextMessage(message)
                    .onFailure { updateState { copy(logLines = log(it)) } }
            }
        }
    }

    private suspend fun observeSession() = coroutineScope {
        val voiceStates = state.map {
            VoiceInteractor.State(
                speakerEnabled = it.speakerEnabled,
                micEnabled = it.effectiveMicActive,
                sessionConfig = it.sessionConfig,
            )
        }.stateIn(this)

        val token = authService.getEphemeralToken()
        if (token.isBlank()) {
            updateState { copy(isApiKeyConfigured = false) }
            return@coroutineScope
        }

        state
            .map {
                data class SessionKey(
                    val active: Boolean,
                    val inputFormat: AudioFormat,
                    val outputFormat: AudioFormat,
                )
                
                SessionKey(
                    active = it.connection != DISCONNECTED,
                    inputFormat = it.inputFormat,
                    outputFormat = it.outputFormat,
                )
            }
            .distinctUntilChanged()
            .transformLatest {
                if (!it.active) return@transformLatest

                val events = voiceInteractor.connect(
                    serverUrl = "wss://api.x.ai/v1/realtime",
                    token = token,
                    inputFormat = it.inputFormat,
                    outputFormat = it.outputFormat,
                    enableMicOnConnect = state.value.micGranted,
                    states = voiceStates,
                )
                    .catch {
                        updateState {
                            copy(connection = DISCONNECTED, logLines = log(it))
                        }
                    }
                emitAll(events)
            }
            .onEach { Log.d("VoiceViewModel", it.toString()) }
            .collect(::onEvent)
    }

    private fun onEvent(event: Connection.Event) = updateState {
        when (event) {
            is Connected -> copy(connection = CONNECTED, logLines = log(event))
            is Reconnecting -> copy(connection = CONNECTING, logLines = log(event))
            is Disconnected -> copy(connection = DISCONNECTED, logLines = log(event))
            is Realtime -> onServerEvent(event.event)
            is Idle, is Connecting, -> this
        }
    }

    private fun State.onServerEvent(event: VoiceServerEvent): State = when (event) {
        is ConversationCreated -> {
            pendingTextMessage?.let { msg ->
                viewModelScope.launch {
                    voiceInteractor.sendTextMessage(msg)
                        .onFailure { updateState { copy(logLines = log(it)) } }
                }
            }
            copy(
                conversationId = event.conversation?.id,
                pendingTextMessage = null,
                logLines = log(event),
            )
        }
        is InputAudioBufferSpeechStarted -> copy(speaker = USER)
        is InputAudioBufferSpeechStopped -> copy(speaker = NONE)
        is ResponseOutputAudioDone -> copy(speaker = NONE, logLines = log(event))
        is ResponseDone -> copy(speaker = NONE, logLines = log(event))
        is VoiceServerEvent.Error -> copy(connection = DISCONNECTED, logLines = log(event))
        is InputAudioTranscriptionCompleted -> {
            copy(
                chatMessages = addMessage(USER, event.transcript.orEmpty()),
                logLines = log(event)
            )
        }
        is ResponseOutputAudioTranscriptDelta -> {
            copy(
                speaker = ASSISTANT,
                chatMessages = addMessage(ASSISTANT, event.delta.orEmpty()),
                logLines = log(event)
            )
        }
        is ResponseTextDelta -> {
            copy(
                speaker = ASSISTANT,
                chatMessages = addMessage(ASSISTANT, event.delta.orEmpty()),
                logLines = log(event)
            )
        }
        else -> copy(logLines = log(event))
    }

    private fun updateState(block: State.() -> State) {
        state.update(block)
    }
}

private fun State.log(event: Any): List<String> =
    (logLines + event.toString()).takeLast(200)

private fun State.addMessage(
    role: VoiceViewModel.Speaker,
    text: String
): List<ChatMessage> {
    val message = chatMessages.lastOrNull()?.takeIf { it.role == role } ?: ChatMessage(role)
    val messages = if (chatMessages.lastOrNull()?.role == role) chatMessages.dropLast(1) else chatMessages
    return messages + message.copy(text = message.text + text)
}
