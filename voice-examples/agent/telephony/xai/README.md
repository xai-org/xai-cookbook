# Minimalist Voice Bot with Twilio & XAI Realtime

> **IMPORTANT DISCLAIMER**  
> **These are example implementations for learning and development purposes only.**  
> **NOT PRODUCTION-READY WITHOUT ADDITIONAL HARDENING.**  

This project demonstrates how to integrate [Twilio's Programmable Voice API](https://www.twilio.com/docs/voice) with XAI's real-time streaming API to enable real-time voice agents. Users can make voice calls via Twilio and the system proxies the audio with XAI's Realtime API.

## How it Works

- The `/twiml` endpoint responds to Twilio's incoming call webhook with the TwiML noun [`<Stream/>`](https://www.twilio.com/docs/voice/twiml/stream)
- A [Media Stream](https://www.twilio.com/docs/voice/media-streams) is established with the app's websocket endpoint.
- Audio packets from the voice call are forwarded to XAI's Realtime API.
- XAI responds with audio packets, which are forwarded to Twilio.

## Get Started

### 0. Prerequisites

- [Twilio account](https://www.twilio.com/try-twilio) with a [phone number](https://help.twilio.com/articles/223135247-How-to-Search-for-and-Buy-a-Twilio-Phone-Number-from-Console)
- [XAI Platform Account](https://accounts.x.ai/sign-up?redirect=grok-com) and `XAI_API_KEY`
- [nGrok installed globally](https://ngrok.com/docs/getting-started/)

### 1. Clone Repo

```bash
# Clone the repository
git clone <your-repo-url>
cd examples/agent/telephony/xai
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start Ngrok Tunnel

The application needs to know the domain (`HOSTNAME`) it is deployed to in order to function correctly. This domain is set in the `HOSTNAME` environment variable and it must be configured before starting the app.

Start ngrok by running this command.

```bash
ngrok http 3000
```

Then copy the domain

<img src="./docs/ngrok.png"/>

_Note: ngrok provides [static domains for all ngrok users](https://ngrok.com/blog-post/free-static-domains-ngrok-users). You can avoid updating the `HOSTNAME` every time by provisioning your own static domain._

### 4. Add Environment Variables

```bash
XAI_API_KEY=your-xai-api-key
```

```bash
HOSTNAME=your-ngrok-domain.ngrok.app
```

### 5. Run the App

This command will start the Express server which handles incoming Twilio webhook requests and media streams.

```bash
npm run dev
```

### 6. Configure Twilio Phone Number Webhooks

Go to your [Twilio Console](https://console.twilio.com/) and configure the Voice webhooks for your Twilio phone number:

- <b>Incoming Call Webhook</b>: Select `POST` and set url to: `https://your-ngrok-domain.ngrok.app/twiml`
- <b>Call Status Update Webhook</b>: Select `POST` and set url to: `https://your-ngrok-domain.ngrok.app/call-status-update`

### 7. Place a Call to Your Twilio Phone Number

You're all set. Place a call to your Twilio Phone Number and you should see the real-time transcript logged to your local terminal.

## Outbound Calls

This example also supports making outbound calls where the AI agent initiates the conversation.

### Additional Environment Variables for Outbound Calls

Add these to your `.env` file:

```bash
# Twilio credentials for outbound calls
TWILIO_ACCOUNT_SID=your-twilio-account-sid
TWILIO_AUTH_TOKEN=your-twilio-auth-token
TWILIO_PHONE_NUMBER=+1234567890  # Your Twilio phone number

# The phone number to call
TARGET_PHONE_NUMBER=+1234567890
```

### Making an Outbound Call

With the server running (`npm run dev`), open a new terminal and run:

```bash
npm run outbound
```

This will:
1. Initiate a call from your Twilio phone number to the target phone number
2. Connect the call to the XAI voice agent
3. The agent will speak first, introducing itself and explaining the Grok Voice Agent API

The agent is configured to proactively start the conversation since it's making an outbound call.
