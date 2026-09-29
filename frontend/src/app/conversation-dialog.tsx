"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChatIcon } from "./chat-icons";

export function ConversationDialog({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="conversation-dialog"
      aria-labelledby="details-title"
      onCancel={onClose}
      onClose={onClose}
    >
      <div className="dialog-heading">
        <div>
          <h2 id="details-title">Your conversation</h2>
          <p>A few things we&apos;ve picked up along the way.</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close conversation details"
          onClick={onClose}
        >
          <ChatIcon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
