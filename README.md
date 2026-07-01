# Spur AI Support Agent Hub (Simulator Dashboard)

[![Deploy to Render](https://render.com/images/deploy-to-render.button.svg)](https://render.com/deploy?repo=https://github.com/raunakdwivedi03/Spur)

Welcome! This repository contains a mini AI support agent and simulator dashboard built for the Spur Founding Full-Stack Engineer take-home assignment. 

It features a robust **Node.js/TypeScript/Express/SQLite** backend and a premium, responsive **Svelte/Vite/TypeScript** developer dashboard styled with obsidian-dark glassmorphism, glowing gradients, micro-animations, and full keyboard-accessibility.

---

## Key Features

1. **Dual LLM Provider Support**: Native integration with both **OpenAI** (using `gpt-4o-mini`) and **Anthropic** (using `claude-3-haiku-20240307`). The server dynamically detects your `.env` keys.
2. **Zero-Config Mock AI Fallback**: If no API keys are provided in the environment, the server automatically defaults to a smart local keyword-matching algorithm that queries the seeded SQLite FAQs, simulates natural typing latency, and calculates mock token stats. You can evaluate the entire application out-of-the-box without keys!
3. **Persisted History & Multiple Sessions**: Switch between different active/past chat sessions in the sidebar. All conversations and messages are persisted in SQLite.
4. **Interactive FAQs Panel**: Displays seeded domain knowledge FAQs. Clicking any FAQ card automatically triggers that inquiry in the simulator.
5. **Real-time Debug Logs Console**: A console displaying database writes, full latency metrics, raw prompts sent to the LLM, and tokens used for every transaction.
6. **Robust Input Safeguards**: Rejecting empty/whitespace messages and truncating messages exceeding 1000 characters while returning clean alerts in the UI.

---

## Project Structure

```
D:\spur-ai-chat-agent/
├── backend/
│   ├── src/
│   │   ├── index.ts      # Server entry point & graceful shutdown
│   │   ├── db.ts         # SQLite migration, database API & FAQ seed data
│   │   ├── llm.ts        # LLM providers handler (OpenAI / Claude / Mock)
│   │   └── routes.ts     # Express endpoints, validation, and truncation
│   ├── tsconfig.json
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.svelte    # Svelte Dashboard view, UI states & API triggers
│   │   ├── app.css       # Premium Glassmorphic stylesheet
│   │   └── main.ts       # Svelte compiler mounting
│   ├── index.html        # SEO Title, Metadata and Google Fonts
│   ├── vite.config.ts
│   └── package.json
├── package.json          # Root runner using concurrently
├── verify_chat.js        # Automated integration testing suite
└── chat.db               # SQLite database (auto-generated at runtime)
```

---

## Step-by-Step Local Setup & Execution

### 1. Prerequisites
- **Node.js**: `v20.0.0` or higher (tested on `v24.15.0`)
- **NPM**: `v10.0.0` or higher (tested on `v11.12.1`)

### 2. Install Dependencies
At the root directory (`D:\spur-ai-chat-agent`), run the following command to automatically install packages in the root, backend, and frontend:
```bash
npm run install:all
```

### 3. Configure Environment Variables
1. Navigate to the `backend` folder.
2. The server comes pre-configured with a `.env` file that runs in `mock` mode.
3. To test with real AI providers, edit `backend/.env` and supply your key(s):
```ini
# Server configuration
PORT=3000

# Database file path (relative or absolute)
DATABASE_URL=./chat.db

# LLM Selection (openai | anthropic | mock)
LLM_PROVIDER=openai

# LLM API Keys (fill these to use real AI, otherwise it defaults to mock mode)
OPENAI_API_KEY=your_openai_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

### 4. Running the Application
Start both the Express backend (port 3000) and the Vite frontend (port 5173) concurrently using:
```bash
npm run dev
```
Once started:
- Open your browser and navigate to **`http://localhost:5173`** to access the dashboard.
- The backend health check is accessible at **`http://localhost:3000/health`**.

### 5. Running the Automated Testing Suite
While the servers are running, you can run the integration test suite in a separate terminal:
```bash
node verify_chat.js
```
The script validates health, standard FAQ responses, session persistence, message length truncation safeguards, empty input validation, and LLM logs retrieval.

---

## Technical Architecture Overview

### Backend Architecture
The backend is structured into four distinct modules:
- **Index Server Layer (`index.ts`)**: Initializes the database, registers middleware (CORS, JSON parsers), binds routes, and catches SIGINT/SIGTERM to cleanly terminate the SQLite database.
- **Router Layer (`routes.ts`)**: Standardizes input validation (trimming whitespace, 400 Bad Request on empty body), truncates messages longer than 1000 characters with warning flags, and fetches/commits user & assistant messages to the DB.
- **LLM Service Wrapper (`llm.ts`)**: Cleanly encapsulates the LLM integration. It implements OpenAI, Anthropic, and Mock models, computes standard token counts, tracks query latencies, formats prompt history, and records transaction logs.
- **Database Persistence Layer (`db.ts`)**: Direct SQLite management via the `sqlite3` library. The manager implements a promise-based query system, boots DB tables on startup, and automatically seeds domain knowledge if empty.

---

## LLM Integration & Prompt Design

### Prompt Engineering
We use structured system prompts containing the seeded FAQ records pulled dynamically from the database. This ensures the model is always anchored with the latest store policies.

**System Prompt Structure:**
```
You are a helpful, professional, and friendly customer support agent for "SpurShop", a premium online store.
Your goal is to answer user inquiries accurately and concisely.

STORE KNOWLEDGE & POLICIES:
- Category: Shipping
  Question: What are your shipping rates and times?
  Answer: Standard shipping (3-5 business days) is free on orders over $50...
[Other FAQs...]

CRITICAL RULES:
1. ONLY answer questions based on the STORE KNOWLEDGE & POLICIES provided above.
2. If you are asked about topics outside of these policies (e.g. general knowledge, writing code, unrelated companies, products we don't sell), politely state that you can only assist with SpurShop's shipping, returns, support hours, and store inquiries, and direct them to email support@spurshop.com.
3. Be concise and keep answers under 3-4 sentences.
4. Remain friendly and professional at all times.
```

### Context History Window
To prevent prompt token bloating while preserving conversation context:
- The backend retrieves all messages in the conversation but slices and sends only the **last 10 messages** (`MAX_HISTORY_MESSAGES = 10`) to the LLM.
- System prompt rules restrict completion outputs to a maximum of 150 tokens.

---

## Trade-offs & "If I had more time..."

1. **Database Client Choice**: We used raw `sqlite3` wrapped in standard Promises. This avoided potential node-gyp native compilation errors on Windows (which commonly occurs with `better-sqlite3` or Prisma on newer Node versions). If we had more time, we could migrate to Kysely + SQLite or PostgreSQL for stronger compile-time SQL safety.
2. **LLM Temperature and Splicing**: Currently, temperature is fixed at `0.3` to ensure deterministic, factual policy answers. In production, we'd add support for dynamically adjustable temperatures or system prompt editing via the front-end dashboard.
3. **Advanced RAG (Retrieval-Augmented Generation)**: Right now, we stuff all FAQ records directly into the LLM context. While this works beautifully for a small store with under 50 FAQs, it would fail for a store with hundreds of policies. In a production version, we would implement vector embedding search (e.g., pgvector) to retrieve only the top 3-5 most relevant policies before compiling the prompt.
4. **WebSocket/SSE Streaming**: Currently, we use standard HTTP POST requests. Real-time channels would benefit from Server-Sent Events (SSE) or WebSockets to stream the response word-by-word.
