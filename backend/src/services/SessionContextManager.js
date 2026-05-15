const logger = require("../utils/logger");

class SessionContextManager {
  constructor() {
    this.sessions = new Map(); // sessionId -> { messages, lastPartialResponse, lastSnapshotAt }
  }

  getOrCreateSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        messages: [],
        lastPartialResponse: "",
        lastSnapshotAt: 0,
      });
    }
    return this.sessions.get(sessionId);
  }

  updateSession(sessionId, messages, partialResponse = "") {
    const session = this.getOrCreateSession(sessionId);
    if (messages) session.messages = messages;
    if (partialResponse) {
      session.lastPartialResponse = partialResponse;
      session.lastSnapshotAt = Date.now();
    }
  }

  clearSession(sessionId) {
    this.sessions.delete(sessionId);
  }

  getSnapshot(sessionId) {
    return this.sessions.get(sessionId);
  }
}

module.exports = new SessionContextManager();
