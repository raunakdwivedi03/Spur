import { Router, Request, Response } from 'express';
import { dbManager } from './db';
import { llmService } from './llm';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Max character limit for single user messages
const MAX_MESSAGE_LENGTH = 1000;

/**
 * @route   POST /chat/message (and aliased to /api/chat/message)
 * @desc    Receive a message from the client, fetch historical context, query LLM, and persist conversation.
 * @access  Public
 */
router.post(['/chat/message', '/api/chat/message'], async (req: Request, res: Response) => {
  try {
    const { message, sessionId } = req.body;

    // 1. Validate Input
    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Message content cannot be empty.'
      });
    }

    // Handle very long messages sensibly (truncate and log a warning, but still process)
    let processedMessage = message.trim();
    let warning: string | undefined;

    if (processedMessage.length > MAX_MESSAGE_LENGTH) {
      console.warn(`[WARNING] Input message length (${processedMessage.length}) exceeded limit. Truncating.`);
      processedMessage = processedMessage.substring(0, MAX_MESSAGE_LENGTH) + '... [truncated for length]';
      warning = `Your message was truncated as it exceeded the ${MAX_MESSAGE_LENGTH} character limit.`;
    }

    // 2. Resolve Session
    const activeSessionId = sessionId && typeof sessionId === 'string' && sessionId.trim() !== '' 
      ? sessionId 
      : uuidv4();

    // Ensure conversation exists in DB
    await dbManager.createConversation(activeSessionId);

    // 3. Fetch past messages for context
    const history = await dbManager.getMessages(activeSessionId);

    // 4. Save user message to database
    const userMsg = await dbManager.saveMessage(activeSessionId, 'user', processedMessage);

    // 5. Call LLM service with history context
    let llmResult;
    try {
      llmResult = await llmService.generateReply(activeSessionId, history, processedMessage);
    } catch (llmError: any) {
      // Catch LLM specific errors and surface them cleanly
      return res.status(502).json({
        error: 'AI Provider Error',
        message: llmError.message || 'The AI service failed to generate a response.',
        sessionId: activeSessionId
      });
    }

    // 6. Save AI reply to database
    await dbManager.saveMessage(activeSessionId, 'ai', llmResult.reply);

    // 7. Return reply
    return res.json({
      reply: llmResult.reply,
      sessionId: activeSessionId,
      provider: llmResult.provider,
      latencyMs: llmResult.latencyMs,
      tokensUsed: llmResult.tokensUsed,
      ...(warning ? { warning } : {})
    });

  } catch (error: any) {
    console.error('API Error in /chat/message:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'A critical server error occurred. Please try again later.'
    });
  }
});

/**
 * @route   GET /api/chat/sessions
 * @desc    Get all conversations
 */
router.get(['/sessions', '/api/chat/sessions'], async (req: Request, res: Response) => {
  try {
    const sessions = await dbManager.getConversations();
    return res.json(sessions);
  } catch (error: any) {
    console.error('Error fetching sessions:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

/**
 * @route   GET /api/chat/sessions/:sessionId
 * @desc    Get message history of a conversation
 */
router.get(['/sessions/:sessionId', '/api/chat/sessions/:sessionId'], async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const messages = await dbManager.getMessages(sessionId);
    return res.json(messages);
  } catch (error: any) {
    console.error('Error fetching conversation history:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

/**
 * @route   GET /api/chat/faqs
 * @desc    Get list of seeded FAQs
 */
router.get(['/faqs', '/api/chat/faqs'], async (req: Request, res: Response) => {
  try {
    const faqs = await dbManager.getFAQs();
    return res.json(faqs);
  } catch (error: any) {
    console.error('Error fetching FAQs:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

/**
 * @route   GET /api/chat/logs
 * @desc    Get debug LLM audit logs
 */
router.get(['/logs', '/api/chat/logs'], async (req: Request, res: Response) => {
  try {
    const logs = await dbManager.getLLMLogs();
    return res.json(logs);
  } catch (error: any) {
    console.error('Error fetching LLM logs:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

export default router;
