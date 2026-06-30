import { OpenAI } from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { dbManager, Message, FAQ } from './db';

// Cap conversation history to keep prompt tokens under control (e.g., last 10 messages)
const MAX_HISTORY_MESSAGES = 10;

export interface LLMResponse {
  reply: string;
  provider: 'openai' | 'anthropic' | 'mock';
  latencyMs: number;
  tokensUsed: number;
}

class LLMService {
  private openai: OpenAI | null = null;
  private anthropic: Anthropic | null = null;

  constructor() {
    this.initClients();
  }

  private initClients() {
    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (openaiKey && openaiKey.trim() !== '' && !openaiKey.includes('your_openai_api_key_here')) {
      console.log('Initializing OpenAI client...');
      this.openai = new OpenAI({ apiKey: openaiKey });
    }

    if (anthropicKey && anthropicKey.trim() !== '' && !anthropicKey.includes('your_anthropic_api_key_here')) {
      console.log('Initializing Anthropic client...');
      this.anthropic = new Anthropic({ apiKey: anthropicKey });
    }
  }

  /**
   * Generates a reply using OpenAI, Anthropic, or Mock service
   */
  public async generateReply(
    conversationId: string,
    history: Message[],
    userMessage: string
  ): Promise<LLMResponse> {
    // Re-initialize clients in case keys were added after startup
    this.initClients();

    const providerSetting = (process.env.LLM_PROVIDER || 'mock').toLowerCase();
    
    // Choose active provider based on configuration and availability
    let activeProvider: 'openai' | 'anthropic' | 'mock' = 'mock';
    if (providerSetting === 'openai' && this.openai) {
      activeProvider = 'openai';
    } else if (providerSetting === 'anthropic' && this.anthropic) {
      activeProvider = 'anthropic';
    } else if (this.openai) {
      activeProvider = 'openai';
    } else if (this.anthropic) {
      activeProvider = 'anthropic';
    }

    const startTime = Date.now();
    const faqs = await dbManager.getFAQs();
    const systemPrompt = this.buildSystemPrompt(faqs);
    const slicedHistory = history.slice(-MAX_HISTORY_MESSAGES);

    console.log(`Generating reply using LLM Provider: ${activeProvider}`);

    try {
      if (activeProvider === 'openai' && this.openai) {
        return await this.callOpenAI(conversationId, systemPrompt, slicedHistory, userMessage, startTime);
      } else if (activeProvider === 'anthropic' && this.anthropic) {
        return await this.callAnthropic(conversationId, systemPrompt, slicedHistory, userMessage, startTime);
      } else {
        return await this.callMock(conversationId, faqs, slicedHistory, userMessage, startTime);
      }
    } catch (error: any) {
      console.error(`LLM Error with provider ${activeProvider}:`, error);
      
      // Graceful degradation and user-friendly error formatting
      let userFriendlyMessage = 'I apologize, but I encountered an unexpected error processing your message. Please try again in a moment.';
      
      if (error.status === 401 || error.message?.includes('API key') || error.message?.includes('auth')) {
        userFriendlyMessage = 'System Error: The AI service is currently misconfigured (Invalid API Key). Please notify the system administrator.';
      } else if (error.status === 429 || error.message?.includes('Rate limit')) {
        userFriendlyMessage = 'I am currently receiving too many messages. Please wait a few seconds before trying again.';
      } else if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
        userFriendlyMessage = 'The request timed out. Please check your internet connection and try again.';
      }

      throw new Error(userFriendlyMessage);
    }
  }

  /**
   * Constructs system prompt containing persona and FAQs
   */
  private buildSystemPrompt(faqs: FAQ[]): string {
    let faqText = 'STORE KNOWLEDGE & POLICIES:\n';
    faqs.forEach((faq) => {
      faqText += `- Category: ${faq.category}\n  Question: ${faq.question}\n  Answer: ${faq.answer}\n\n`;
    });

    return `You are a helpful, professional, and friendly customer support agent for "SpurShop", a premium online store.
Your goal is to answer user inquiries accurately and concisely.

${faqText}
CRITICAL RULES:
1. ONLY answer questions based on the STORE KNOWLEDGE & POLICIES provided above.
2. If you are asked about topics outside of these policies (e.g. general knowledge, writing code, unrelated companies, products we don't sell), politely state that you can only assist with SpurShop's shipping, returns, support hours, and store inquiries, and direct them to email support@spurshop.com.
3. Be concise and keep answers under 3-4 sentences.
4. Remain friendly and professional at all times.`;
  }

  /**
   * Calls OpenAI Chat Completion API
   */
  private async callOpenAI(
    conversationId: string,
    systemPrompt: string,
    history: Message[],
    userMessage: string,
    startTime: number
  ): Promise<LLMResponse> {
    if (!this.openai) throw new Error('OpenAI client not initialized');

    const messages: any[] = [{ role: 'system', content: systemPrompt }];

    // Append history
    history.forEach((msg) => {
      messages.push({
        role: msg.sender === 'user' ? 'user' : 'assistant',
        content: msg.text,
      });
    });

    // Append latest message
    messages.push({ role: 'user', content: userMessage });

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      max_tokens: 150,
      temperature: 0.3,
    });

    const reply = response.choices[0]?.message?.content || 'I apologize, but I could not formulate a response.';
    const tokensUsed = response.usage?.total_tokens || 0;
    const latencyMs = Date.now() - startTime;

    // Log query in background
    dbManager.logLLMCall({
      conversationId,
      prompt: JSON.stringify(messages),
      response: reply,
      tokensUsed,
      latencyMs,
    }).catch(console.error);

    return {
      reply,
      provider: 'openai',
      latencyMs,
      tokensUsed,
    };
  }

  /**
   * Calls Anthropic Messages API
   */
  private async callAnthropic(
    conversationId: string,
    systemPrompt: string,
    history: Message[],
    userMessage: string,
    startTime: number
  ): Promise<LLMResponse> {
    if (!this.anthropic) throw new Error('Anthropic client not initialized');

    const messages: any[] = [];

    // Append history (Anthropic requires strict user/assistant alternation)
    history.forEach((msg) => {
      messages.push({
        role: msg.sender === 'user' ? 'user' : 'assistant',
        content: msg.text,
      });
    });

    // Append latest message
    messages.push({ role: 'user', content: userMessage });

    const response = await this.anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 150,
      system: systemPrompt,
      messages: messages,
      temperature: 0.3,
    });

    const reply = response.content[0].type === 'text' ? response.content[0].text : 'I apologize, but I could not formulate a response.';
    // Anthropic token usage fields
    const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
    const latencyMs = Date.now() - startTime;

    // Log query in background
    dbManager.logLLMCall({
      conversationId,
      prompt: `System: ${systemPrompt}\nMessages: ${JSON.stringify(messages)}`,
      response: reply,
      tokensUsed,
      latencyMs,
    }).catch(console.error);

    return {
      reply,
      provider: 'anthropic',
      latencyMs,
      tokensUsed,
    };
  }

  /**
   * Fallback mock agent that parses questions locally
   */
  private async callMock(
    conversationId: string,
    faqs: FAQ[],
    history: Message[],
    userMessage: string,
    startTime: number
  ): Promise<LLMResponse> {
    // Simulate natural LLM delay
    await new Promise((resolve) => setTimeout(resolve, 800));

    const msgLower = userMessage.toLowerCase();
    let reply = '';

    // Simple keyword/intent mapping
    if (msgLower.includes('shipping') || msgLower.includes('ship') || msgLower.includes('delivery') || msgLower.includes('days')) {
      if (msgLower.includes('usa') || msgLower.includes('us') || msgLower.includes('america') || msgLower.includes('countries') || msgLower.includes('international')) {
        const faq = faqs.find(f => f.question.includes('USA')) || faqs[1];
        reply = faq.answer;
      } else {
        const faq = faqs.find(f => f.question.includes('rates')) || faqs[0];
        reply = faq.answer;
      }
    } else if (msgLower.includes('return') || msgLower.includes('refund') || msgLower.includes('cancel') || msgLower.includes('exchange')) {
      if (msgLower.includes('how') || msgLower.includes('request') || msgLower.includes('process')) {
        const faq = faqs.find(f => f.question.includes('refund?')) || faqs[3];
        reply = faq.answer;
      } else {
        const faq = faqs.find(f => f.question.includes('return policy')) || faqs[2];
        reply = faq.answer;
      }
    } else if (msgLower.includes('hours') || msgLower.includes('time') || msgLower.includes('support') || msgLower.includes('contact') || msgLower.includes('email')) {
      const faq = faqs.find(f => f.question.includes('hours')) || faqs[4];
      reply = faq.answer;
    } else if (msgLower.includes('where') || msgLower.includes('location') || msgLower.includes('spurshop') || msgLower.includes('located')) {
      const faq = faqs.find(f => f.question.includes('located')) || faqs[5];
      reply = faq.answer;
    } else if (msgLower.includes('hello') || msgLower.includes('hi') || msgLower.includes('hey')) {
      reply = "Hello! I am SpurShop's automated support agent. How can I help you today? You can ask me about our shipping rates, returns, or support hours.";
    } else {
      reply = "I apologize, but I couldn't find specific policies addressing that in our domain knowledge. For detailed inquiries, please contact our support team at support@spurshop.com (available Mon-Fri 9:00 AM - 6:00 PM EST).";
    }

    const latencyMs = Date.now() - startTime;
    const tokensUsed = Math.floor(userMessage.length / 4) + Math.floor(reply.length / 4) + 120; // Estimated mock token count

    // Log query in background
    dbManager.logLLMCall({
      conversationId,
      prompt: `[MOCK MODE] User Query: ${userMessage}`,
      response: reply,
      tokensUsed,
      latencyMs,
    }).catch(console.error);

    return {
      reply,
      provider: 'mock',
      latencyMs,
      tokensUsed,
    };
  }
}

export const llmService = new LLMService();
