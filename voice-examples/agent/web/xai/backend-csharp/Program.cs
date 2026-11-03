using System.Text.Json;
using System.Text.Json.Serialization;
using AspNetCoreRateLimit;
using Microsoft.AspNetCore.Mvc;

var builder = WebApplication.CreateBuilder(args);

// Load configuration
var xaiApiKey = Environment.GetEnvironmentVariable("XAI_API_KEY") ?? "";
var port = int.TryParse(Environment.GetEnvironmentVariable("PORT"), out var p) ? p : 8000;
var voice = Environment.GetEnvironmentVariable("VOICE") ?? "ara";
var instructions = Environment.GetEnvironmentVariable("INSTRUCTIONS")
    ?? "You are a helpful voice assistant. You are speaking to a user in real-time over audio. Keep your responses conversational and concise since they will be spoken aloud.";
var allowedOrigins = (Environment.GetEnvironmentVariable("ALLOWED_ORIGINS")
    ?? "http://localhost:3000,http://localhost:5173,http://localhost:8080").Split(',');

const string SessionRequestUrl = "https://api.x.ai/v1/realtime/client_secrets";

// Configure services
builder.Services.AddMemoryCache();
builder.Services.Configure<IpRateLimitOptions>(options =>
{
    options.GeneralRules = new List<RateLimitRule>
    {
        new RateLimitRule { Endpoint = "POST:/session", Period = "1m", Limit = 10 }
    };
});
builder.Services.AddInMemoryRateLimiting();
builder.Services.AddSingleton<IRateLimitConfiguration, RateLimitConfiguration>();
builder.Services.AddHttpClient();

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins(allowedOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

var app = builder.Build();

app.UseIpRateLimiting();
app.UseCors();

var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
};

// Root endpoint
app.MapGet("/", () => Results.Json(new
{
    Service = "XAI Voice Web Backend (C#)",
    Provider = "XAI",
    Version = "2.0.0",
    Status = "running",
    Endpoints = new { Health = "/health", Session = "/session" }
}, jsonOptions));

// Health check endpoint
app.MapGet("/health", () => Results.Json(new
{
    Status = "healthy",
    Provider = "XAI",
    Timestamp = DateTime.UtcNow.ToString("o")
}, jsonOptions));

// Create session endpoint
app.MapPost("/session", async (IHttpClientFactory httpClientFactory) =>
{
    Console.WriteLine("📝 Creating ephemeral session...");

    try
    {
        var client = httpClientFactory.CreateClient();
        client.DefaultRequestHeaders.Add("Authorization", $"Bearer {xaiApiKey}");

        var requestBody = JsonSerializer.Serialize(new { expires_after = new { seconds = 300 } });
        var content = new StringContent(requestBody, System.Text.Encoding.UTF8, "application/json");

        var response = await client.PostAsync(SessionRequestUrl, content);
        var responseBody = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            Console.WriteLine($"❌ Failed to get ephemeral token: {(int)response.StatusCode} {responseBody}");
            return Results.Json(new { Error = "Failed to create session", Details = responseBody }, jsonOptions);
        }

        using var doc = JsonDocument.Parse(responseBody);
        var root = doc.RootElement;
        var value = root.GetProperty("value").GetString();
        var expiresAt = root.GetProperty("expires_at").GetInt64();

        Console.WriteLine("✅ Ephemeral session created");

        return Results.Json(new
        {
            ClientSecret = new { Value = value, ExpiresAt = expiresAt },
            Voice = voice,
            Instructions = instructions
        }, jsonOptions);
    }
    catch (Exception ex)
    {
        Console.WriteLine($"❌ Error creating session: {ex.Message}");
        return Results.Json(new { Error = "Failed to create session", Details = ex.Message }, jsonOptions);
    }
});

// Startup logging
app.Lifetime.ApplicationStarted.Register(() =>
{
    Console.WriteLine(new string('=', 60));
    Console.WriteLine("🚀 XAI Voice Web Backend (C#) Starting");
    Console.WriteLine(new string('=', 60));
    Console.WriteLine($"🌐 Port: {port}");
    Console.WriteLine($"🔑 API Key: {(string.IsNullOrEmpty(xaiApiKey) ? "❌ Missing" : "Configured")}");
    Console.WriteLine($"🎙️  Voice: {voice}");
    Console.WriteLine($"📝 Instructions: {(instructions.Length > 50 ? instructions[..50] + "..." : instructions)}");
    Console.WriteLine($"🔒 CORS Origins: {string.Join(", ", allowedOrigins)}");
    Console.WriteLine(new string('=', 60));

    if (string.IsNullOrEmpty(xaiApiKey))
    {
        Console.WriteLine("⚠️  WARNING: XAI_API_KEY not configured!");
    }
});

app.Lifetime.ApplicationStopping.Register(() =>
{
    Console.WriteLine("\n👋 Shutting down XAI Voice Web Backend");
});

app.Run();

