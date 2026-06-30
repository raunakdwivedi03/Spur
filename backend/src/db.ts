import sqlite3 from 'sqlite3';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const dbPath = process.env.DATABASE_URL || './chat.db';
const absoluteDbPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(process.cwd(), dbPath);

// Define type interfaces
export interface Conversation {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: string;
}

export interface FAQ {
  id?: number;
  category: string;
  question: string;
  answer: string;
}

export interface LLMLog {
  id?: number;
  conversationId: string;
  prompt: string;
  response: string;
  tokensUsed: number;
  latencyMs: number;
  timestamp?: string;
}

class DatabaseManager {
  private db!: sqlite3.Database;

  public init(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`Connecting to SQLite database at: ${absoluteDbPath}`);
      this.db = new sqlite3.Database(absoluteDbPath, (err) => {
        if (err) {
          console.error('Failed to connect to database:', err);
          return reject(err);
        }
        this.runMigrations()
          .then(() => this.seedFAQs())
          .then(() => resolve())
          .catch(reject);
      });
    });
  }

  private run(query: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(query, params, function (err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private get<T>(query: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(query, params, (err, row) => {
        if (err) reject(err);
        else resolve(row as T);
      });
    });
  }

  private all<T>(query: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows as T[]);
      });
    });
  }

  private async runMigrations(): Promise<void> {
    // 1. Conversations table
    await this.run(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Messages table
    await this.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversationId TEXT REFERENCES conversations(id) ON DELETE CASCADE,
        sender TEXT CHECK(sender IN ('user', 'ai')),
        text TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. FAQ Knowledge table
    await this.run(`
      CREATE TABLE IF NOT EXISTS faq_knowledge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL
      )
    `);

    // 4. LLM Logs table
    await this.run(`
      CREATE TABLE IF NOT EXISTS llm_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversationId TEXT,
        prompt TEXT,
        response TEXT,
        tokensUsed INTEGER,
        latencyMs INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  private async seedFAQs(): Promise<void> {
    const existing = await this.all<FAQ>('SELECT * FROM faq_knowledge LIMIT 1');
    if (existing.length > 0) {
      return; // Already seeded
    }

    console.log('Seeding store FAQs (domain knowledge)...');
    const faqs: FAQ[] = [
      {
        category: 'Shipping',
        question: 'What are your shipping rates and times?',
        answer: 'Standard shipping (3-5 business days) is free on orders over $50. Otherwise, it costs $5.99. Express shipping (1-2 business days) is available for $14.99.'
      },
      {
        category: 'Shipping',
        question: 'Do you ship to USA and other countries?',
        answer: 'Yes, we ship to the United States, Canada, United Kingdom, and Australia. Standard international shipping takes 7-14 business days.'
      },
      {
        category: 'Returns',
        question: 'What is your return policy?',
        answer: 'We offer a 30-day return policy. Items must be unused, in their original packaging, with tags attached. Refunds are processed within 5-7 business days of receipt. The customer covers return shipping fees unless the item arrived damaged or defective.'
      },
      {
        category: 'Returns',
        question: 'How do I request a refund?',
        answer: 'To request a refund, please contact support@spurshop.com with your order number and reason for return. Once approved, we will issue a return label.'
      },
      {
        category: 'Support Hours',
        question: 'What are your support hours?',
        answer: 'Our customer support is available Monday to Friday from 9:00 AM to 6:00 PM Eastern Standard Time (EST). Typical email response time is under 2 hours during these hours.'
      },
      {
        category: 'About Shop',
        question: 'Where is SpurShop located?',
        answer: 'We are an online e-commerce brand based out of New York, USA, specializing in curation of premium, high-quality everyday essentials.'
      }
    ];

    for (const faq of faqs) {
      await this.run(
        'INSERT INTO faq_knowledge (category, question, answer) VALUES (?, ?, ?)',
        [faq.category, faq.question, faq.answer]
      );
    }
    console.log('FAQs successfully seeded.');
  }

  // --- CRUD API ---

  public async createConversation(id?: string): Promise<string> {
    const cid = id || uuidv4();
    await this.run(
      'INSERT INTO conversations (id) VALUES (?) ON CONFLICT(id) DO UPDATE SET updatedAt = CURRENT_TIMESTAMP',
      [cid]
    );
    return cid;
  }

  public async getConversations(): Promise<Conversation[]> {
    return this.all<Conversation>('SELECT * FROM conversations ORDER BY updatedAt DESC');
  }

  public async getMessages(conversationId: string): Promise<Message[]> {
    return this.all<Message>(
      'SELECT * FROM messages WHERE conversationId = ? ORDER BY timestamp ASC',
      [conversationId]
    );
  }

  public async saveMessage(conversationId: string, sender: 'user' | 'ai', text: string): Promise<Message> {
    const id = uuidv4();
    // Ensure conversation exists
    await this.createConversation(conversationId);
    
    // Save message
    await this.run(
      'INSERT INTO messages (id, conversationId, sender, text) VALUES (?, ?, ?, ?)',
      [id, conversationId, sender, text]
    );

    // Update conversation updatedAt
    await this.run(
      'UPDATE conversations SET updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
      [conversationId]
    );

    const saved = await this.get<Message>('SELECT * FROM messages WHERE id = ?', [id]);
    if (!saved) throw new Error('Failed to retrieve saved message');
    return saved;
  }

  public async getFAQs(): Promise<FAQ[]> {
    return this.all<FAQ>('SELECT * FROM faq_knowledge');
  }

  public async logLLMCall(log: LLMLog): Promise<void> {
    await this.run(
      'INSERT INTO llm_logs (conversationId, prompt, response, tokensUsed, latencyMs) VALUES (?, ?, ?, ?, ?)',
      [log.conversationId, log.prompt, log.response, log.tokensUsed, log.latencyMs]
    );
  }

  public async getLLMLogs(limit: number = 20): Promise<LLMLog[]> {
    return this.all<LLMLog>('SELECT * FROM llm_logs ORDER BY timestamp DESC LIMIT ?', [limit]);
  }
}

export const dbManager = new DatabaseManager();
