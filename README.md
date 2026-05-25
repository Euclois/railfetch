# CLI Trains 🚄 💻

A hyper-fast, zero-bloat Progressive Web App (PWA) designed to instantly show train departures, delays, platforms, and network alerts, bypassing the slow, ad-heavy interfaces of commercial applications.

Styled in a retro terminal CLI aesthetic (monospace layout with scanlines and pixel outline train graphics), it delivers sub-second rendering for key Manchester rail corridors and customized route search.

---

## 🏗️ Technical Stack & Architecture

- **Frontend Shell**: Vanilla HTML5, CSS3 (styled with curated pitch-black visual palettes and custom keyframe ticker animations), Vanilla JavaScript.
- **Modern Typography**: Integrated Helena Zhang's Helena-designed `Departure Mono` font.
- **Backend API Proxy**: Node.js serverless functions running on Vercel Edge.
- **Primary Data Source**: Realtime Trains API (RTT) for departures, operators, and platforms.
- **Secondary Data Source**: Huxley 2 National Rail API proxy for Network Disruptions and Alerts.
- **Caching Scheme**: Automated edge-caching headers (`s-maxage=30` for trains, `s-maxage=120` for alerts) preventing National Rail/RTT rate limits on spammed refreshes.
- **Service Worker**: PWA Caching sandboxes (`sw.js`) storing standard assets for lightning-fast loads and complete offline reliability.
- **Offline Ticket Vault**: Integrated local filesystem `FileReader` that caches base64-encoded screenshots of commuter tickets in `localStorage` for offline ticket checks.

---

## 🗂️ Project File Structure

```text
cli-trains/
├── vercel.json           # Vercel Serverless router configurations
├── package.json          # Node package manifest and CLI dev scripts
├── .gitignore            # Git exclusion rules
├── api/
│   ├── trains.js         # Realtime Trains live departure fetcher proxy
│   └── alerts.js         # Huxley 2 NRCC disruption alert fetcher proxy
├── public/
│   ├── index.html        # HTML PWA application shell
│   ├── style.css         # Master monospace terminal stylesheet
│   ├── app.js            # Core client-side controller logic
│   ├── sw.js             # Service Worker offline asset cache sandbox
│   ├── manifest.json     # Progressive Web App configuration file
│   ├── icon.svg          # Infinitely scalable vector console icon
│   └── stations.json     # Static autocomplete datalist containing ~2,920 UK stations
└── scripts/
    └── generate_stations.py # Autocomplete database scraper python script
```

---

## 🔧 Local Setup & Installation

### Prerequisites
- Node.js (v18 or higher recommended)
- Python 3 (only if you want to rebuild the station database)

### Installation
1. Clone your repository:
   ```bash
   git clone <your-repository-url>
   cd C026_Train
   ```

2. Install development tools:
   ```bash
   npm install
   ```

3. Launch the local Vercel development server:
   ```bash
   npm run dev
   ```
   This will host your application locally at `http://localhost:3000`.

> [!NOTE]
> **Mock Mode Verification**: If you run the app locally without environment credentials, the backend proxy automatically detects the missing keys and injects a simulated, high-fidelity mock stream of departures and alerts. This ensures the app is immediately testable and beautiful out-of-the-box!

---

## 🚀 Deployment to Vercel

Follow these steps to deploy your application to a live edge server on Vercel:

### 1. Rebuild and Verify Station Database
If you ever need to fetch the latest station codes and update the datalist, execute:
```bash
npm run generate-stations
```

### 2. Push to GitHub
Create a new repository on GitHub and link it locally:
```bash
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

### 3. Connect to Vercel
1. Log in to your [Vercel Dashboard](https://vercel.com).
2. Click **New Project** and import your GitHub repository.
3. In the **Environment Variables** section, inject your Realtime Trains API keys:
   - **`RTT_USERNAME`**: Your RTT API username (usually `rttapi_...`).
   - **`RTT_PASSWORD`**: Your RTT API password (a hexadecimal string).
4. Click **Deploy**. Vercel will build the shell and deploy the API edge handlers.

---

## 🛟 Safe & Secure Offline Ticket Vault

Commuters frequently lose signal when entering deep underground platforms or boarding trains. The CLI Ticket Vault is engineered to bypass this limitation:
1. **Upload**: Select `LOAD_TICKET_FILE` and choose a screenshot or photo of your e-ticket.
2. **Local Storage**: The file is read using the HTML5 `FileReader` API, parsed into an optimized Base64 DataURL, and saved locally inside your browser's private `localStorage` sandbox.
3. **Offline Retrieval**: When you open the PWA offline, the Service Worker serves the application shell, and `app.js` immediately loads and decodes the ticket image from `localStorage`.
4. **Purging**: Press `PURGE_TICKET` to permanently destroy the base64 ticket string from your browser storage.
