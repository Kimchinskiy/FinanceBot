export function Bubble({ children, className = '' }) {
  return (
    <div className={`bubble ${className}`}>
      {children}
    </div>
  );
}

export function BubbleContent({ children, className = '' }) {
  return (
    <div className={`bubble-content ${className}`}>
      {children}
    </div>
  );
}
