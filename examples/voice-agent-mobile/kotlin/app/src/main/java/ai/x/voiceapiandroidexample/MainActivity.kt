package ai.x.voiceapiandroidexample

import ai.x.voiceapiandroidexample.ui.ApiKeyRequiredOverlay
import ai.x.voiceapiandroidexample.ui.ChatMessageList
import ai.x.voiceapiandroidexample.ui.ControlPanel
import ai.x.voiceapiandroidexample.ui.LogView
import ai.x.voiceapiandroidexample.ui.MessageInput
import ai.x.voiceapiandroidexample.ui.theme.VoiceApiAndroidExampleTheme
import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            VoiceApiAndroidExampleTheme {
                VoiceScreen()
            }
        }
    }

    override fun onStart() {
        super.onStart()
        window.setBackgroundDrawable(null)
    }
}

@Composable
fun VoiceScreen(viewModel: VoiceViewModel = viewModel()) {
    val state by viewModel.state.collectAsState()

    MicPermissionHandler(
        requestMic = state.requestMic,
        onResult = viewModel::onMicPermissionResult,
    )

    DisconnectOnStop(onStop = viewModel::disconnect)

    val pagerState = rememberPagerState(pageCount = { 2 })
    val scope = rememberCoroutineScope()

    Scaffold(modifier = Modifier
        .fillMaxSize()
        .imePadding()) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 16.dp)
        ) {
            Tabs(
                selectedIndex = pagerState.currentPage,
                onSelect = { scope.launch { pagerState.animateScrollToPage(it) } },
            )

            HorizontalPager(state = pagerState, modifier = Modifier.weight(1f)) { page ->
                when (page) {
                    0 -> ChatMessageList(state.chatMessages)
                    1 -> LogView(state.logLines)
                }
            }

            ControlPanel(
                connection = state.connection,
                speaker = state.speaker,
                micActive = state.effectiveMicActive,
                speakerEnabled = state.speakerEnabled,
                selectedVoice = state.sessionConfig.voice.orEmpty(),
                onSelectVoice = viewModel::setVoice,
                onToggleMic = viewModel::toggleMic,
                onToggleSpeaker = viewModel::toggleSpeaker,
                onConnect = viewModel::connect,
                onDisconnect = viewModel::disconnect,
            )

            MessageInput(onSend = viewModel::sendTextMessage)
        }

        if (!state.isApiKeyConfigured) {
            ApiKeyRequiredOverlay()
        }
    }
}

@Composable
private fun MicPermissionHandler(
    requestMic: Boolean,
    onResult: (Boolean) -> Unit,
) {
    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
        onResult = onResult,
    )

    val context = LocalContext.current
    LaunchedEffect(requestMic) {
        if (requestMic) {
            launcher.launch(Manifest.permission.RECORD_AUDIO)
        } else {
            val granted = ContextCompat.checkSelfPermission(
                context, Manifest.permission.RECORD_AUDIO
            ) == PackageManager.PERMISSION_GRANTED
            onResult(granted)
        }
    }
}

@Composable
private fun DisconnectOnStop(onStop: () -> Unit) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) onStop()
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
}

@Composable
private fun Tabs(selectedIndex: Int, onSelect: (Int) -> Unit) {
    PrimaryTabRow(selectedTabIndex = selectedIndex) {
        Tab(
            selected = selectedIndex == 0,
            onClick = { onSelect(0) },
            text = { Text("Chat") },
        )
        Tab(
            selected = selectedIndex == 1,
            onClick = { onSelect(1) },
            text = { Text("Log") },
        )
    }
}
