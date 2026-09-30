/**
 * Session management for WebRTC connections
 */

import type { Session } from "./types";
import * as crypto from "crypto";

export class SessionManager {
  private sessions: Map<string, Session> = new Map();

  /**
   * Generate a cryptographically secure session ID
   */
  generateSessionId(): string {
    return `session_${crypto.randomBytes(16).toString('hex')}`;
  }

  /**
   * Create a new session
   */
  createSession(sampleRate: number = 24000): Session {
    const sessionId = this.generateSessionId();
    const session: Session = {
      id: sessionId,
      created_at: new Date().toISOString(),
      status: "created",
      sample_rate: sampleRate,
    };
    this.sessions.set(sessionId, session);
    console.log(`[${sessionId}] 📝 Session created with sample rate ${sampleRate}Hz`);
    return session;
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Update session status
   */
  updateSessionStatus(sessionId: string, status: Session["status"]): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
      console.log(`[${sessionId}] 🔄 Session status: ${status}`);
    }
  }

  /**
   * Update session stats
   */
  updateSessionStats(sessionId: string, stats: Session["webrtcStats"]): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.webrtcStats = stats;
    }
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): boolean {
    const deleted = this.sessions.delete(sessionId);
    if (deleted) {
      console.log(`[${sessionId}] 🗑️  Session deleted`);
    }
    return deleted;
  }

  /**
   * Get all sessions
   */
  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }
}

