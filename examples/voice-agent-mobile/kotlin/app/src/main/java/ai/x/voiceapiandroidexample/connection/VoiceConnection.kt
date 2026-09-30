package ai.x.voiceapiandroidexample.connection

import ai.x.voiceapiandroidexample.model.UnknownEventSerializer
import ai.x.voiceapiandroidexample.model.VoiceClientEvent
import ai.x.voiceapiandroidexample.model.VoiceServerEvent
import android.util.Base64
import android.util.Log
import java.io.IOException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.channels.trySendBlocking
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.retryWhen
import kotlinx.coroutines.launch
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.modules.SerializersModule
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString

class VoiceConnection(
    private val apiKey: String,
) : Connection {

    private val okHttpClient = OkHttpClient.Builder()
        .addInterceptor { chain ->
            val request = chain.request().newBuilder()
                .header("Authorization", "Bearer $apiKey")
                .build()
            chain.proceed(request)
        }
        .build()

    override val binaryFrames = Channel<ByteArray>()

    private val outgoing = Channel<Any>(capacity = 64)

    override suspend fun send(event: VoiceClientEvent) {
        outgoing.send(event)
    }

    override suspend fun send(data: ByteArray) {
        outgoing.send(data)
    }

    override fun connect(url: String): Flow<Connection.Event> {
        val request = Request.Builder().url(url)
            .header("Authorization", "Bearer $apiKey")
            .build()

        val json = Json {
            ignoreUnknownKeys = true
            serializersModule = SerializersModule {
                polymorphicDefaultDeserializer(VoiceServerEvent::class) {
                    UnknownEventSerializer
                }
            }
        }

        return callbackFlow {
            val listener = Listener(
                scope = this,
                json = json,
                outgoing = outgoing,
                sendEvent = channel::trySend,
                onBinaryFrame = binaryFrames::trySendBlocking,
                onClosed = ::close,
            )

            val ws = okHttpClient.newWebSocket(request, listener)

            awaitClose { ws.close(NORMAL_CLOSURE_CODE, NORMAL_CLOSURE_REASON) }
        }
            .withReconnect()
            .onStart { emit(Connection.Event.Connecting) }
            .onCompletion { outgoing.close() }
    }

    companion object {
        internal const val TAG = "VoiceConnection"
        internal const val MAX_RECONNECT_ATTEMPTS = 5
    }
}

private const val NORMAL_CLOSURE_CODE = 1000
private const val NORMAL_CLOSURE_REASON = "Server closed connection normally"
private const val INACTIVITY_CLOSURE_CODE = 1001
private val IDLE_TIERS = longArrayOf(5_000L, 10_000L, 15_000L)

private class NormalCloseException(message: String) : IOException(message)

private class Listener(
    private val scope: CoroutineScope,
    private val json: Json,
    private val outgoing: Channel<Any>,
    private val sendEvent: (Connection.Event) -> Unit,
    private val onBinaryFrame: (ByteArray) -> Unit,
    private val onClosed: (Throwable) -> Unit,
) : WebSocketListener() {

    private var outgoingJob: Job? = null
        set(value) {
            field?.cancel()
            field = value
        }

    override fun onOpen(webSocket: WebSocket, response: Response) {
        sendEvent(Connection.Event.Connected)
        resetIdleWatchdog(webSocket)
        outgoingJob = scope.launch {
            for (frame in outgoing) {
                when (frame) {
                    is VoiceClientEvent -> {
                        val text = json.encodeToString(VoiceClientEvent.serializer(), frame)
                        webSocket.send(text)
                    }
                    is ByteArray -> webSocket.send(frame.toByteString())
                }
            }
        }
    }

    override fun onMessage(webSocket: WebSocket, text: String) {
        resetIdleWatchdog(webSocket)
        try {
            val event = json.decodeFromString(VoiceServerEvent.serializer(), text)
            webSocket.handlePing(event)
            if (event is VoiceServerEvent.ResponseOutputAudioDelta) {
                event.delta?.let { onBinaryFrame(Base64.decode(it, Base64.NO_WRAP)) }
            } else {
                sendEvent(Connection.Event.Realtime(event))
            }
        } catch (e: SerializationException) {
            Log.w(VoiceConnection.TAG, "Failed to deserialize: ${e.message}")
        }
    }

    override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
        resetIdleWatchdog(webSocket)
        onBinaryFrame(bytes.toByteArray())
    }

    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
        Log.d(VoiceConnection.TAG, "WebSocket closing: code=$code, reason=$reason")
        webSocket.close(code, reason)
    }

    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        Log.d(VoiceConnection.TAG, "WebSocket closed: code=$code, reason=$reason")
        idleWatchdog = null
        outgoingJob = null
        when (code) {
            NORMAL_CLOSURE_CODE -> onClosed(NormalCloseException(NORMAL_CLOSURE_REASON))
            INACTIVITY_CLOSURE_CODE -> onClosed(NormalCloseException("Conversation timed out due to inactivity"))
            else -> onClosed(IOException("WebSocket closed: code=$code, reason=$reason"))
        }
    }

    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        Log.w(VoiceConnection.TAG, "WebSocket failure: ${t.message}")
        idleWatchdog = null
        outgoingJob = null
        onClosed(t)
    }

    private var idleWatchdog: Job? = null
        set(value) {
            field?.cancel()
            field = value
        }

    private fun resetIdleWatchdog(webSocket: WebSocket) {
        idleWatchdog = scope.launch {
            var prev = 0L
            for ((index, threshold) in IDLE_TIERS.withIndex()) {
                delay(threshold - prev)
                prev = threshold
                val tier = index + 1
                if (tier < IDLE_TIERS.size) {
                    Log.d(VoiceConnection.TAG, "Idle tier $tier reached (${threshold / 1000}s)")
                    sendEvent(Connection.Event.Idle(tier))
                } else {
                    Log.w(VoiceConnection.TAG, "Idle tier $tier reached (${threshold / 1000}s), closing")
                    webSocket.cancel()
                }
            }
        }
    }

    private fun WebSocket.handlePing(event: VoiceServerEvent) {
        if (event is VoiceServerEvent.Ping) {
            val timestamp = event.timestamp ?: return
            send("""{ "type" : "pong", "ping_timestamp" : $timestamp }""")
        }
    }
}

private fun Flow<Connection.Event>.withReconnect(): Flow<Connection.Event> {
    var delayMs = 1_000L

    return this
        .onEach {
            if (it is Connection.Event.Connected) {
                delayMs = 1_000L
                Log.d(VoiceConnection.TAG, "Connected")
            }
        }
        .retryWhen { cause, attempt ->
            when {
                cause is NormalCloseException -> {
                    emit(Connection.Event.Disconnected(attempt.toInt(), null))
                    Log.d(VoiceConnection.TAG, "Server closed connection normally")
                    false
                }
                attempt >= VoiceConnection.MAX_RECONNECT_ATTEMPTS -> {
                    emit(Connection.Event.Disconnected(attempt.toInt(), cause))
                    Log.w(VoiceConnection.TAG, "Max reconnect attempts reached")
                    false
                }
                else -> {
                    emit(Connection.Event.Reconnecting(attempt.toInt(), cause))
                    Log.d(
                        VoiceConnection.TAG,
                        "Reconnecting (attempt $attempt/${VoiceConnection.MAX_RECONNECT_ATTEMPTS})",
                    )
                    delay(delayMs)
                    delayMs = (delayMs * 2).coerceAtMost(30_000L)
                    true
                }
            }
        }
}
