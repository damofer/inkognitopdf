import { useEffect, useRef } from "react";

/**
 * A short confirmation ("Saved.") that goes away by itself (spec 009, CA12),
 * instead of a notice that takes a whole row.
 */
export function Toast({
  message,
  onDone,
  ms = 2500,
}: {
  message: string;
  onDone: () => void;
  ms?: number;
}) {
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    const id = setTimeout(() => done.current(), ms);
    return () => clearTimeout(id);
  }, [message, ms]);
  return (
    <div className="toast" role="status" data-testid="toast">
      {message}
    </div>
  );
}
