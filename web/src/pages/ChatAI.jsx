import { useEffect, useState, useRef } from 'react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { Message, MessageAvatar, MessageContent, MessageHeader, MessageFooter, MessageGroup } from '../components/chat/Message.jsx';
import { Bubble, BubbleContent } from '../components/chat/Bubble.jsx';

function Avatar({ children }) {
  return (
    <div className="msg-avatar-circle">
      {children}
    </div>
  );
}

function WelcomeScreen() {
  return (
    <div className="chat-welcome">
      <div className="chat-welcome-icon">🧠</div>
      <p className="chat-welcome-title">Спросите о ваших финансах</p>
      <div className="chat-welcome-hints">
        <p>«Могу ли я купить робот-пылесос за 7000?»</p>
        <p>«Где я больше всего трачу?»</p>
        <p>«Сколько у меня осталось до зарплаты?»</p>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <Message align="start">
      <MessageAvatar>
        <Avatar>🧠</Avatar>
      </MessageAvatar>
      <MessageContent>
        <MessageHeader>Финансовый AI</MessageHeader>
        <Bubble>
          <BubbleContent>
            <span className="typing">· · ·</span>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

function ChatMessage({ message }) {
  const isUser = message.role === 'user';
  return (
    <Message align={isUser ? 'end' : 'start'}>
      {!isUser && (
        <MessageAvatar>
          <Avatar>🧠</Avatar>
        </MessageAvatar>
      )}
      <MessageContent>
        <MessageHeader>
          {isUser ? 'Вы' : 'Финансовый AI'}
        </MessageHeader>
        <Bubble>
          <BubbleContent>{message.content}</BubbleContent>
        </Bubble>
        {message.source && (
          <MessageFooter>
            <span className="msg-source-badge">{message.source === 'rules' ? 'базовый режим' : 'AI'}</span>
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
}

export default function ChatAI() {
  const { state, update } = useStore();
  const messages = state.chatMessages;
  const setMessages = (updater) => update({ chatMessages: typeof updater === 'function' ? updater(messages) : updater });
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setSending(true);
    try {
      const res = await api('POST', '/ai/chat', { message: text, history });
      setMessages(prev => [...prev, { role: 'assistant', content: res.reply || '…', source: res.source }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Ошибка связи. Попробуйте позже.' }]);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div className="panel chat-panel">
      <div className="panel-header">
        <span>🤖 Финансовый AI-помощник</span>
        <span className="text-muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
          анализирует всё: доходы, расходы, долги, кредитки
        </span>
      </div>

      <div className="msg-scroller">
        {messages.length === 0 && !sending && <WelcomeScreen />}

        <div className="msg-list">
          {messages.map((m, i) => (
            <ChatMessage key={i} message={m} />
          ))}
          {sending && <TypingIndicator />}
        </div>
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-bar">
        <input
          type="text"
          className="input-field"
          placeholder="Напишите вопрос…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
        />
        <button className="btn-primary chat-send-btn" onClick={send} disabled={sending || !input.trim()}>
          {sending ? '…' : '→'}
        </button>
      </div>
    </div>
  );
}
