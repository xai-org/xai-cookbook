package ai.x.voiceapiandroidexample

/**
 * AuthService is responsible for providing authentication tokens for the Voice API.
 *
 * The getEphemeralToken() method should return a short-lived token obtained from your
 * backend service. This design guides integrators away from hardcoding long-lived API
 * keys directly in the client app, which is insecure. Instead, the client requests an
 * ephemeral token from a trusted server that holds the real credentials.
 */
class AuthService {
    suspend fun getEphemeralToken(): String = BuildConfig.XAI_API_KEY
}
