const providerManager = require("./ProviderManager");
const sessionContext = require("./SessionContextManager");
const logger = require("../utils/logger");
const NormalizedAIError = require("../utils/normalizedAIError");

class AIGateway {
  constructor() {
    this.activeRequests = new Map(); // reqId -> state
    this.queue = [];
    this.maxConcurrency = 5;
    this.runningCount = 0;
  }

  async processRequest(reqId, { messages, mode, provider: preferredProvider, options, res, sessionId }) {
    logger.info("AIGateway.request.queued", { reqId, mode, preferredProvider });
    return new Promise((resolve, reject) => {
      this.queue.push({ reqId, messages, mode, preferredProvider, options, res, sessionId, resolve, reject, queuedAt: Date.now() });
      this.next();
    });
  }

  async next() {
    if (this.runningCount >= this.maxConcurrency || this.queue.length === 0) return;

    const task = this.queue.shift();
    this.runningCount++;
    this.activeRequests.set(task.reqId, { state: "preparing", provider: null });

    try {
      await this.executeWithRetry(task);
    } catch (err) {
      task.reject(err);
    } finally {
      this.runningCount--;
      this.activeRequests.delete(task.reqId);
      this.next();
    }
  }

  async executeWithRetry(task, attempt = 0, accumulatedText = "") {
    const providerName = providerManager.getBestProvider(task.mode, task.preferredProvider);
    const adapter = providerManager.getAdapter(providerName);
    const startTime = Date.now();

    logger.info("AIGateway.execute.start", { reqId: task.reqId, provider: providerName, attempt, accumulatedLength: accumulatedText.length });

    const requestState = this.activeRequests.get(task.reqId);
    if (requestState) {
      requestState.state = attempt > 0 ? (accumulatedText ? "recovering" : "retrying") : "streaming";
      requestState.provider = providerName;
    }

    try {
      let messagesToUse = [...task.messages];
      if (accumulatedText) {
        logger.info("AIGateway.execute.recovering", { reqId: task.reqId, provider: providerName });
        // Option B: Restart generation gracefully
        messagesToUse.push({ role: "assistant", content: accumulatedText });
        messagesToUse.push({ role: "user", content: "Continue this answer naturally while preserving structure and tone." });
      }

      logger.info("AIGateway.stream.calling", { reqId: task.reqId, provider: providerName, model: task.options.model });
      const stream = await adapter.generateStream(messagesToUse, task.options);
      logger.info("AIGateway.stream.opened", { reqId: task.reqId, provider: providerName });
      
      let currentResponse = accumulatedText;
      let lastSnapshotAt = Date.now();
      let chunkCount = 0;

      const handleContent = (content) => {
        chunkCount++;
        currentResponse += content;
        task.res.write(`data: ${JSON.stringify({ content, chunkIndex: chunkCount })}\n\n`);
        
        
        // Snapshot every 2 seconds
        if (Date.now() - lastSnapshotAt > 2000 && task.sessionId) {
          sessionContext.updateSession(task.sessionId, null, currentResponse);
          lastSnapshotAt = Date.now();
        }
      };
      logger.info("AIGateway.stream.iterating", { reqId: task.reqId, provider: providerName });
      if (typeof stream[Symbol.asyncIterator] === "function") {
        for await (const chunk of stream) {
          const content = chunk?.choices?.[0]?.delta?.content || "";
          if (content) handleContent(content);
        }
      } else if (stream.getReader) {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop();

          for (const line of lines) {
            if (line.trim() === "" || line.includes("[DONE]")) continue;
            try {
              let content = "";
              if (line.startsWith("data: ")) {
                const data = JSON.parse(line.slice(6));
                content = data.choices?.[0]?.delta?.content || "";
              } else if (line.trim().startsWith("{")) {
                const data = JSON.parse(line);
                content = data.candidates?.[0]?.content?.parts?.[0]?.text || data.choices?.[0]?.delta?.content || "";
              }
              
              if (content) handleContent(content);
            } catch (e) {}
          }
        }
      }

      task.res.write("data: [DONE]\n\n");
      task.res.end();
      const latency = Date.now() - startTime;
      logger.info("AIGateway.stream.completed", { reqId: task.reqId, provider: providerName, latency, totalChunks: chunkCount });
      
      providerManager.updateMetrics(providerName, true, latency);
      
      if (task.sessionId) {
        sessionContext.updateSession(task.sessionId, task.messages, currentResponse);
      }
      task.resolve();

    } catch (err) {
      providerManager.updateMetrics(providerName, false, 0);
      logger.error(`AIGateway.request.failed`, { reqId: task.reqId, provider: providerName, error: err.message, progress: currentResponse.length });

      if (attempt < 2) {
        const wait = Math.pow(2, attempt) * 1000;
        logger.info("AIGateway.retry", { reqId: task.reqId, attempt: attempt + 1, wait, newProgress: currentResponse.length });
        await new Promise(r => setTimeout(r, wait));
        return this.executeWithRetry(task, attempt + 1, currentResponse);
      } else {
        throw new NormalizedAIError("failed", "All provider attempts failed", providerName, err);
      }
    }
  }

  getStatus(reqId) {
    return this.activeRequests.get(reqId);
  }
}

module.exports = new AIGateway();
