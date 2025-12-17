/**
 * Agent Broadcast Service
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Real-time event broadcasting for agent workflow visualization.
 * Uses Server-Sent Events (SSE) to stream agent logs to connected clients.
 */

import { EventEmitter } from 'events';

// Global event emitter for agent broadcasts
class AgentBroadcaster extends EventEmitter {
  constructor() {
    super();
    this.clients = new Set();
    this.currentSession = null;
    this.sessionLogs = [];
    this.sessionState = {};
    this.setMaxListeners(100);
  }

  /**
   * Start a new agent session
   */
  startSession(sessionId, metadata = {}) {
    this.currentSession = sessionId;
    this.sessionLogs = [];
    this.sessionState = {
      sessionId,
      startTime: Date.now(),
      status: 'running',
      currentAgent: 'master',
      metadata,
      agents: {
        master: { status: 'pending', logs: [] },
        sales: { status: 'pending', logs: [] },
        technical: { status: 'pending', logs: [] },
        pricing: { status: 'pending', logs: [] }
      }
    };
    
    this.broadcast('session_start', {
      sessionId,
      timestamp: new Date().toISOString(),
      metadata
    });
  }

  /**
   * Log an agent message and broadcast it
   */
  log(agent, message, data = {}) {
    const logEntry = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      agent: agent,
      message: message,
      data: data,
      sessionId: this.currentSession
    };
    
    this.sessionLogs.push(logEntry);
    
    // Update agent state
    if (this.sessionState.agents[agent.toLowerCase()]) {
      this.sessionState.agents[agent.toLowerCase()].logs.push(logEntry);
      this.sessionState.agents[agent.toLowerCase()].status = 'running';
      this.sessionState.currentAgent = agent.toLowerCase();
    }
    
    this.broadcast('agent_log', logEntry);
    
    return logEntry;
  }

  /**
   * Mark an agent as complete
   */
  completeAgent(agent, output = {}) {
    if (this.sessionState.agents[agent.toLowerCase()]) {
      this.sessionState.agents[agent.toLowerCase()].status = 'completed';
      this.sessionState.agents[agent.toLowerCase()].output = output;
    }
    
    this.broadcast('agent_complete', {
      agent,
      timestamp: new Date().toISOString(),
      output: summarizeOutput(output)
    });
  }

  /**
   * Update session state with structured data
   */
  updateState(key, value) {
    this.sessionState[key] = value;
    
    this.broadcast('state_update', {
      key,
      value: summarizeOutput(value),
      timestamp: new Date().toISOString()
    });
  }

  /**
   * End the current session
   */
  endSession(result = {}) {
    this.sessionState.status = 'completed';
    this.sessionState.endTime = Date.now();
    this.sessionState.duration = this.sessionState.endTime - this.sessionState.startTime;
    this.sessionState.result = summarizeOutput(result);
    
    this.broadcast('session_end', {
      sessionId: this.currentSession,
      duration: this.sessionState.duration,
      logsCount: this.sessionLogs.length,
      result: this.sessionState.result,
      timestamp: new Date().toISOString()
    });
    
    // Keep session data for a while for late joiners
    setTimeout(() => {
      if (this.currentSession === result.sessionId) {
        this.currentSession = null;
      }
    }, 60000);
  }

  /**
   * Broadcast event to all connected clients
   */
  broadcast(eventType, data) {
    const message = {
      type: eventType,
      data: data,
      timestamp: Date.now()
    };
    
    this.emit('broadcast', message);
    
    // Send to all SSE clients
    const sseMessage = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    
    for (const client of this.clients) {
      try {
        client.write(sseMessage);
      } catch (err) {
        this.clients.delete(client);
      }
    }
  }

  /**
   * Add SSE client
   */
  addClient(res) {
    this.clients.add(res);
    
    // Send current state to new client
    if (this.currentSession) {
      res.write(`event: session_state\ndata: ${JSON.stringify(this.sessionState)}\n\n`);
      
      // Send recent logs
      for (const log of this.sessionLogs.slice(-50)) {
        res.write(`event: agent_log\ndata: ${JSON.stringify(log)}\n\n`);
      }
    }
    
    res.on('close', () => {
      this.clients.delete(res);
    });
  }

  /**
   * Get current session state
   */
  getState() {
    return {
      ...this.sessionState,
      logs: this.sessionLogs,
      clientCount: this.clients.size
    };
  }

  /**
   * Get session logs
   */
  getLogs() {
    return this.sessionLogs;
  }
}

/**
 * Summarize output to prevent huge payloads
 */
function summarizeOutput(obj) {
  if (!obj) return null;
  if (typeof obj !== 'object') return obj;
  
  const summary = {};
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      summary[key] = `[Array: ${value.length} items]`;
    } else if (typeof value === 'object' && value !== null) {
      summary[key] = '{...}';
    } else if (typeof value === 'string' && value.length > 100) {
      summary[key] = value.substring(0, 100) + '...';
    } else {
      summary[key] = value;
    }
  }
  return summary;
}

// Singleton instance
export const agentBroadcaster = new AgentBroadcaster();

export default agentBroadcaster;











