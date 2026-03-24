/**
 * Progress tracking for LobsterPot sessions.
 * 
 * Each pot maintains a structured progress log that can be:
 * - Written to a markdown file (per-pot)
 * - Posted to Discord channels
 * - Queried via CLI/API for summaries
 */

export interface ProgressEntry {
  timestamp: number;
  type: 'start' | 'iteration' | 'milestone' | 'error' | 'recovery' | 'nudge' | 'direction' | 'summary' | 'complete';
  title: string;
  detail?: string;
  metrics?: Record<string, string | number>;
}

export class ProgressLog {
  public entries: ProgressEntry[] = [];
  public potName: string;
  public task: string;
  public agent: string;
  public machine: string;
  public startedAt: number;

  constructor(potName: string, task: string, agent: string, machine: string) {
    this.potName = potName;
    this.task = task;
    this.agent = agent;
    this.machine = machine;
    this.startedAt = Date.now();
  }

  add(entry: Omit<ProgressEntry, 'timestamp'>): void {
    this.entries.push({ ...entry, timestamp: Date.now() });
  }

  /** Quick summary — last N entries as bullet points */
  summary(n = 5): string {
    const recent = this.entries.slice(-n);
    const lines = recent.map(e => {
      const time = new Date(e.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const icon = {
        start: '🚀', iteration: '🔄', milestone: '🎯', error: '❌',
        recovery: '🔁', nudge: '👉', direction: '📨', summary: '📊', complete: '✅'
      }[e.type];
      const metrics = e.metrics ? ` (${Object.entries(e.metrics).map(([k, v]) => `${k}: ${v}`).join(', ')})` : '';
      return `${icon} **${time}** ${e.title}${metrics}`;
    });
    return lines.join('\n');
  }

  /** Full markdown report */
  toMarkdown(): string {
    const duration = Math.round((Date.now() - this.startedAt) / 60000);
    const milestones = this.entries.filter(e => e.type === 'milestone').length;
    const errors = this.entries.filter(e => e.type === 'error').length;
    const iterations = this.entries.filter(e => e.type === 'iteration').length;

    let md = `# 🦞 ${this.potName} — Progress Log\n\n`;
    md += `**Task:** ${this.task}\n`;
    md += `**Agent:** ${this.agent} on ${this.machine}\n`;
    md += `**Started:** ${new Date(this.startedAt).toISOString()}\n`;
    md += `**Duration:** ${duration} minutes\n`;
    md += `**Stats:** ${iterations} iterations, ${milestones} milestones, ${errors} errors\n\n`;
    md += `---\n\n`;

    // Group by phases (milestones break phases)
    let currentPhase = 'Setup';
    for (const entry of this.entries) {
      if (entry.type === 'milestone') {
        currentPhase = entry.title;
        md += `\n## ${currentPhase}\n\n`;
      }

      const time = new Date(entry.timestamp).toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });

      const icon = {
        start: '🚀', iteration: '🔄', milestone: '🎯', error: '❌',
        recovery: '🔁', nudge: '👉', direction: '📨', summary: '📊', complete: '✅'
      }[entry.type];

      md += `- ${icon} **${time}** — ${entry.title}\n`;
      if (entry.detail) {
        md += `  ${entry.detail}\n`;
      }
      if (entry.metrics) {
        const m = Object.entries(entry.metrics).map(([k, v]) => `\`${k}: ${v}\``).join(' · ');
        md += `  ${m}\n`;
      }
    }

    return md;
  }

  /** Discord-friendly summary (under 2000 chars) */
  toDiscordUpdate(): string {
    const duration = Math.round((Date.now() - this.startedAt) / 60000);
    const lastMilestone = [...this.entries].reverse().find(e => e.type === 'milestone');
    const lastIteration = [...this.entries].reverse().find(e => e.type === 'iteration');
    const errors = this.entries.filter(e => e.type === 'error').length;

    let msg = `🦞 **${this.potName}** — ${duration}min`;
    if (errors > 0) msg += ` ⚠️ ${errors} errors`;
    msg += `\n`;

    if (lastMilestone) {
      msg += `🎯 Last milestone: ${lastMilestone.title}\n`;
    }
    if (lastIteration) {
      msg += `🔄 Current: ${lastIteration.title}\n`;
      if (lastIteration.metrics) {
        msg += Object.entries(lastIteration.metrics).map(([k, v]) => `  · ${k}: ${v}`).join('\n') + '\n';
      }
    }

    msg += `\n**Recent:**\n`;
    msg += this.summary(5);

    return msg;
  }
}
