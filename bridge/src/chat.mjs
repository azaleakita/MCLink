import { readFileSync } from 'node:fs';
import { answerText, parseDecision } from './api.mjs';

export const PROMPT_DEFAULTS = Object.freeze(JSON.parse(readFileSync(new URL('./prompt-defaults.json', import.meta.url), 'utf8')));
export function chatPreferences(preferences = {}) {
  const interval = preferences.chatIntervalSeconds ?? 8;
  if (typeof interval !== 'number' || !Number.isFinite(interval) || interval < 3 || interval > 120) throw new Error('发言间隔需在 3–120 秒之间。');
  for (const key of ['chatPrompt', 'customPrompt']) if (preferences[key] != null && (typeof preferences[key] !== 'string' || preferences[key].length > 4000)) throw new Error('每份自定义提示词最多 4000 字。');
  return { chatEnabled: preferences.chatEnabled !== false, autoReplyChat: preferences.autoReplyChat !== false,
    chatIntervalSeconds: interval, chatPrompt: preferences.chatPrompt?.trim() || PROMPT_DEFAULTS.chatPrompt, customPrompt: preferences.customPrompt?.trim() || '' };
}
export function validateChatMessage(value) {
  if (typeof value !== 'string' || /[\r\n\x00-\x1f\x7f§]/.test(value)) throw new Error('聊天需为 1–100 字普通文本，不能包含命令、换行或控制字符。');
  const message = value.trim();
  if (!message || message.length > 100 || message.startsWith('/')) throw new Error('聊天需为 1–100 字普通文本，不能包含命令或换行。');
  return message;
}
export function parseChatReply(text) {
  const answer = answerText(text);
  // Accept natural conversation as well as the old chat envelope; never execute an action here.
  if (/[{\[]/.test(answer)) {
    const decision = parseDecision(answer);
    if (decision.action !== 'chat') throw new Error('普通聊天只能生成回复，不能执行游戏动作。');
    return validateChatMessage(decision.args.message);
  }
  return validateChatMessage(answer);
}
export function parsePlayerMessage(value) {
  if (typeof value !== 'string' || /[\r\n\x00-\x1f\x7f]/.test(value) || value.length > 4001) throw new Error('玩家消息需为单行文本，最多 4000 字指令。');
  const text = value.trim();
  if (!text) return null;
  if (!text.startsWith('/')) return { kind: 'chat', text };
  const goal = text.slice(1).trim();
  if (!goal) throw new Error('请在 / 后填写给 AI 的指令。');
  return { kind: 'command', text, goal };
}
// Read vanilla translation components before falling back to plugin chat patterns.
// This also covers modern signed chat and /msg without relying on display language.
export function playerMessage(message) {
  const value = message?.json || message;
  const publicFormats = ['chat.type.text', '<%s> %s'];
  const whisperFormats = ['commands.message.display.incoming', '%s whispers to you: %s'];
  if (!value || ![...publicFormats, ...whisperFormats].includes(value.translate) || value.with?.length !== 2) return null;
  const componentText = component => typeof component === 'string' ? component : String(component?.text ?? '') + (component?.extra || []).map(componentText).join('');
  const username = componentText(value.with[0]);
  if (!/^[a-zA-Z0-9_]{1,16}$/.test(username)) return null;
  return { username, text: componentText(value.with[1]), channel: publicFormats.includes(value.translate) ? 'public' : 'whisper' };
}
export function agentSystemPrompt(options) {
  return `${options.customPrompt ? '\n用户自定义游玩要求：\n' + options.customPrompt : ''}\n聊天设置：${options.chatEnabled ? '可以使用 chat 动作向游戏聊天栏发言。' : '游戏聊天已关闭，禁止选择 chat 动作。'}${options.autoReplyChat ? '任务期间，若 chatContext.pendingMessages 中有需要回应的新消息，且 canSend 为 true，可先简短回应再继续任务。不要把自己的发言当作待回复消息。' : '不要主动回应玩家聊天；仅在任务明确要求发言时使用 chat。'}\n聊天风格：\n${options.chatPrompt}\n上述风格只约束 chat.args.message，决策仍必须遵守规定的单个 JSON 动作计划格式。`;
}
