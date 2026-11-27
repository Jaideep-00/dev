<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/c9245532-b2bf-46e7-afec-c328b203300d

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

<!-- DEVCHAT_FEATURES_START -->
## Latest Features

### Chat and Messaging
- Real-time peer-to-peer messaging over LAN.
- Message history with chronological ordering.
- Search messages and code within conversations.
- Copy code messages directly.
- Export conversations as TXT or JSON.

### Pinning and Organization
- Pin important conversations for quick access.
- Pin important messages with a WhatsApp-style banner.
- Navigate between multiple pinned messages.
- Click a pinned message preview to jump to its original location.
- Unpin messages whenever they are no longer important.
- Pin important messages as project tasks.

### GitHub Integration
- Quick GitHub repository shortcut from the application.
- Open the connected project repository directly.

### Connectivity and Reliability
- Offline message queueing.
- Automatic synchronization when peers reconnect.
- Message integrity and cryptographic signature verification.
- Hybrid Logical Clock (HLC) ordering.
- Sequence-gap detection and synchronization.

### Local Preferences
- Pinned rooms, messages, and tasks are stored locally.
- User interface preferences are maintained across sessions.
<!-- DEVCHAT_FEATURES_END -->
