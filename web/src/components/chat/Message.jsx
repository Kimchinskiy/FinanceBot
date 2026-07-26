const alignClass = {
  start: 'msg-align-start',
  end: 'msg-align-end',
};

export function Message({ align = 'start', children, className = '' }) {
  return (
    <div className={`msg ${alignClass[align]} ${className}`}>
      {children}
    </div>
  );
}

export function MessageGroup({ children, className = '' }) {
  return (
    <div className={`msg-group ${className}`}>
      {children}
    </div>
  );
}

export function MessageAvatar({ children, className = '' }) {
  return (
    <div className={`msg-avatar ${className}`}>
      {children}
    </div>
  );
}

export function MessageContent({ children, className = '' }) {
  return (
    <div className={`msg-content ${className}`}>
      {children}
    </div>
  );
}

export function MessageHeader({ children, className = '' }) {
  return (
    <div className={`msg-header ${className}`}>
      {children}
    </div>
  );
}

export function MessageFooter({ children, className = '' }) {
  return (
    <div className={`msg-footer ${className}`}>
      {children}
    </div>
  );
}
