<script lang="ts">
  import { onMount, tick, afterUpdate } from 'svelte';

  // API Configuration
  const API_BASE = 'http://localhost:3000';

  // Types
  interface Message {
    id: string;
    conversationId: string;
    sender: 'user' | 'ai';
    text: string;
    timestamp: string;
  }

  interface Session {
    id: string;
    createdAt: string;
    updatedAt: string;
  }

  interface FAQ {
    id?: number;
    category: string;
    question: string;
    answer: string;
  }

  interface LLMLog {
    id?: number;
    conversationId: string;
    prompt: string;
    response: string;
    tokensUsed: number;
    latencyMs: number;
    timestamp?: string;
  }

  // Reactive State
  let sessions: Session[] = [];
  let activeSessionId: string = '';
  let messages: Message[] = [];
  let messageText: string = '';
  let isLoading: boolean = false;
  let errorMsg: string = '';
  let warningMsg: string = '';
  
  // Tabs & Seeded Data State
  let faqs: FAQ[] = [];
  let logs: LLMLog[] = [];
  let activeTab: 'faq' | 'debug' = 'faq';
  let logsInterval: any;

  // DOM Bindings
  let chatViewport: HTMLDivElement;

  // Lifecycle
  onMount(async () => {
    await fetchFAQs();
    await fetchSessions();
    await fetchLogs();

    // Start with a default session if there is one, otherwise create a blank state
    if (sessions.length > 0) {
      selectSession(sessions[0].id);
    } else {
      startNewChat();
    }

    // Set up polling for system logs every 5 seconds
    logsInterval = setInterval(() => {
      if (activeTab === 'debug') {
        fetchLogs();
      }
    }, 5000);

    return () => {
      clearInterval(logsInterval);
    };
  });

  // Keep chat scrolled to bottom
  afterUpdate(() => {
    scrollToBottom();
  });

  async function scrollToBottom() {
    if (chatViewport) {
      await tick();
      chatViewport.scrollTo({
        top: chatViewport.scrollHeight,
        behavior: 'smooth'
      });
    }
  }

  // --- API CALLS ---

  async function fetchSessions() {
    try {
      const res = await fetch(`${API_BASE}/api/chat/sessions`);
      if (res.ok) {
        sessions = await res.json();
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    }
  }

  async function fetchFAQs() {
    try {
      const res = await fetch(`${API_BASE}/api/chat/faqs`);
      if (res.ok) {
        faqs = await res.json();
      }
    } catch (err) {
      console.error('Failed to fetch FAQs:', err);
    }
  }

  async function fetchLogs() {
    try {
      const res = await fetch(`${API_BASE}/api/chat/logs`);
      if (res.ok) {
        logs = await res.json();
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    }
  }

  async function selectSession(sessionId: string) {
    if (!sessionId) return;
    activeSessionId = sessionId;
    errorMsg = '';
    warningMsg = '';
    
    try {
      const res = await fetch(`${API_BASE}/api/chat/sessions/${sessionId}`);
      if (res.ok) {
        messages = await res.json();
      } else {
        messages = [];
      }
    } catch (err) {
      console.error('Failed to load session history:', err);
      errorMsg = 'Failed to load conversation history. Check connection.';
    }
  }

  function startNewChat() {
    // Generate client-side temporary UUID or empty string
    // When the first message is sent, the backend will assign a new UUID if empty
    activeSessionId = crypto.randomUUID();
    messages = [];
    errorMsg = '';
    warningMsg = '';
  }

  async function sendMessage() {
    const trimmed = messageText.trim();
    if (!trimmed || isLoading) return;

    // Reset banners
    errorMsg = '';
    warningMsg = '';

    // Optimistic UI Update: push user message locally immediately
    const tempUserMsg: Message = {
      id: crypto.randomUUID(),
      conversationId: activeSessionId,
      sender: 'user',
      text: trimmed,
      timestamp: new Date().toISOString()
    };
    messages = [...messages, tempUserMsg];
    messageText = '';
    isLoading = true;

    try {
      const response = await fetch(`${API_BASE}/api/chat/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          sessionId: activeSessionId
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Server returned an error.');
      }

      // If backend created/returned a session ID, assign it
      if (data.sessionId && activeSessionId !== data.sessionId) {
        activeSessionId = data.sessionId;
      }

      // Add AI reply to history
      const tempAiMsg: Message = {
        id: crypto.randomUUID(),
        conversationId: activeSessionId,
        sender: 'ai',
        text: data.reply,
        timestamp: new Date().toISOString()
      };
      messages = [...messages, tempAiMsg];

      // Store truncation warning if present
      if (data.warning) {
        warningMsg = data.warning;
      }

      // Refresh listings
      await fetchSessions();
      await fetchLogs();

    } catch (err: any) {
      console.error('Send message error:', err);
      errorMsg = err.message || 'Could not connect to the backend server.';
      
      // Rollback last optimistic message if it failed completely
      // (Optional: let it stay so the user can see what failed)
    } finally {
      isLoading = false;
    }
  }

  // FAQ click macro: populates and sends immediately
  function triggerFAQ(faq: FAQ) {
    if (isLoading) return;
    messageText = faq.question;
    sendMessage();
  }

  // Handle enter key press on textbox
  function handleKeyPress(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  // Formatter helpers
  function formatTime(isoString: string): string {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function formatDateTime(isoString: string): string {
    try {
      const date = new Date(isoString);
      return date.toLocaleString();
    } catch {
      return isoString;
    }
  }
</script>

<div class="dashboard-container">
  <!-- 1. LEFT COLUMN: Session Manager Sidebar -->
  <aside class="pane sidebar-pane">
    <div class="pane-header">
      <h2 class="pane-title">
        <svg style="width:20px;height:20px" viewBox="0 0 24 24">
          <path fill="currentColor" d="M12,2C6.48,2 2,6.48 2,12C2,17.52 6.48,22 12,22C17.52,22 22,17.52 22,12C22,6.48 17.52,2 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,7A5,5 0 0,0 7,12A5,5 0 0,0 12,17A5,5 0 0,0 17,12A5,5 0 0,0 12,7M12,15A3,3 0 0,1 9,12A3,3 0 0,1 12,9A3,3 0 0,1 15,12A3,3 0 0,1 12,15Z" />
        </svg>
        Spur sessions
      </h2>
    </div>
    
    <div class="sidebar-content">
      <button class="new-chat-btn" on:click={startNewChat} disabled={isLoading}>
        <svg style="width:18px;height:18px" viewBox="0 0 24 24">
          <path fill="currentColor" d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z" />
        </svg>
        New Simulation
      </button>

      <div class="sessions-container">
        {#each sessions as session}
          <button 
            class="session-card" 
            class:active={activeSessionId === session.id} 
            on:click={() => selectSession(session.id)}
            disabled={isLoading}
          >
            <span class="session-id">{session.id}</span>
            <span class="session-time">Active: {formatDateTime(session.updatedAt)}</span>
          </button>
        {/each}
        {#if sessions.length === 0}
          <div class="no-data-msg">No stored conversations</div>
        {/if}
      </div>
    </div>
  </aside>

  <!-- 2. MIDDLE COLUMN: Chat Window Panel -->
  <main class="pane chat-pane">
    <div class="pane-header">
      <div class="chat-header-info">
        <div class="chat-avatar">AI</div>
        <div class="chat-status-details">
          <h2 style="font-size: 1rem; margin: 0; color: var(--text-primary);">Support Assistant</h2>
          <span class="chat-status-text">
            <span class="chat-status-dot"></span>
            Online • Resolving FAQs
          </span>
        </div>
      </div>
    </div>

    <!-- Message Viewport -->
    <div class="chat-messages-viewport" bind:this={chatViewport}>
      {#if messages.length === 0}
        <div class="welcome-screen">
          <h1 class="welcome-logo">SpurAI</h1>
          <p class="welcome-subtitle">
            Welcome to the AI Live Chat agent simulator. Ask policies about shipping rates, return terms, international shipping, or customer support hours.
          </p>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 8px;">
            Select one of the FAQs in the right panel to test the responses instantly!
          </div>
        </div>
      {:else}
        {#each messages as msg}
          <div class="message-bubble {msg.sender}">
            {msg.text}
            <span class="message-meta">{formatTime(msg.timestamp)}</span>
          </div>
        {/each}
      {/if}

      {#if isLoading}
        <div class="message-bubble ai" style="display: flex; flex-direction: column; gap: 4px;">
          <div class="typing-indicator">
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
          </div>
          <span style="font-size: 0.65rem; color: var(--text-muted);">Agent is typing...</span>
        </div>
      {/if}
    </div>

    <!-- Alert / Error Banner -->
    {#if errorMsg}
      <div style="padding: 0 24px;">
        <div class="alert-banner error">
          <span>⚠️ {errorMsg}</span>
          <button class="alert-close-btn" on:click={() => errorMsg = ''}>×</button>
        </div>
      </div>
    {/if}

    {#if warningMsg}
      <div style="padding: 0 24px;">
        <div class="alert-banner warning">
          <span>⚠️ {warningMsg}</span>
          <button class="alert-close-btn" on:click={() => warningMsg = ''}>×</button>
        </div>
      </div>
    {/if}

    <!-- Chat Input Box -->
    <div class="chat-input-area">
      <div class="chat-input-row">
        <textarea 
          class="chat-textbox"
          placeholder="Type your customer query here..." 
          bind:value={messageText}
          on:keydown={handleKeyPress}
          disabled={isLoading}
          rows="1"
        ></textarea>
        
        <button 
          class="send-btn" 
          on:click={sendMessage} 
          disabled={isLoading || !messageText.trim()}
          aria-label="Send message"
        >
          <svg style="width:20px;height:20px" viewBox="0 0 24 24">
            <path fill="currentColor" d="M2,21L23,12L2,3V10L17,12L2,14V21Z" />
          </svg>
        </button>
      </div>
      
      <div class="character-counter" class:warning={messageText.length > 900}>
        {messageText.length} / 1000
      </div>
    </div>
  </main>

  <!-- 3. RIGHT COLUMN: Control & Debug Console -->
  <aside class="pane panel-pane">
    <div class="tab-row">
      <button 
        class="tab-btn" 
        class:active={activeTab === 'faq'} 
        on:click={() => activeTab = 'faq'}
      >
        Domain Knowledge
      </button>
      <button 
        class="tab-btn" 
        class:active={activeTab === 'debug'} 
        on:click={() => activeTab = 'debug'}
      >
        Debug Audit Logs
      </button>
    </div>

    <div class="panel-content">
      <!-- FAQ View -->
      {#if activeTab === 'faq'}
        <div class="faq-list">
          <p style="font-size:0.8rem; color: var(--text-secondary); margin-bottom: 8px;">
            The store is seeded with the following database FAQs. Click on any card to automatically simulate that query in the active chat.
          </p>
          {#each faqs as faq}
            <div 
              class="faq-card" 
              role="button"
              tabindex="0"
              on:click={() => triggerFAQ(faq)}
              on:keydown={(e) => e.key === 'Enter' && triggerFAQ(faq)}
            >
              <span class="faq-category">{faq.category}</span>
              <span class="faq-question">{faq.question}</span>
              <span class="faq-answer">{faq.answer}</span>
              <span class="faq-hint">⚡ Click to simulate</span>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Debug Audit Logs View -->
      {#if activeTab === 'debug'}
        <div class="debug-logs-header">
          <span style="font-size:0.8rem; color:var(--text-secondary);">Real-time LLM Logs</span>
          <button class="refresh-logs-btn" on:click={fetchLogs}>Refresh</button>
        </div>
        <div class="logs-list">
          {#each logs as log}
            <div class="log-item">
              <div class="log-meta-row">
                <span>Latency: <span class="log-latency">{log.latencyMs}ms</span></span>
                <span>Tokens: <span class="log-tokens">{log.tokensUsed}</span></span>
              </div>
              <div class="log-body">
                <div><strong>Session:</strong> <span style="color:#a855f7">{log.conversationId.substring(0, 8)}...</span></div>
                <div><strong>Prompt:</strong></div>
                <pre class="log-prompt">{log.prompt}</pre>
                <div><strong>Response:</strong></div>
                <pre class="log-response">{log.response}</pre>
              </div>
            </div>
          {/each}
          {#if logs.length === 0}
            <div class="no-data-msg">No LLM transaction logs recorded yet. Send a message to generate logs.</div>
          {/if}
        </div>
      {/if}
    </div>
  </aside>
</div>
